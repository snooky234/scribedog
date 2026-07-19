//! Local voice input: microphone capture (cpal) + offline transcription
//! (whisper.cpp via whisper-rs). Nothing leaves the device — the only network
//! access in this module is the explicit, user-confirmed one-time model
//! download.

use std::{
    fs,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, AtomicU32, Ordering},
        mpsc, Arc, Mutex,
    },
    thread::JoinHandle,
};

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use tauri::{AppHandle, Emitter, Manager, State};
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

const MODEL_FILE_NAME: &str = "ggml-small.bin";
const MODEL_DOWNLOAD_URL: &str =
    "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin";
// The published ggml-small.bin is ~465 MB; anything much smaller than this is
// a truncated download or an HTML error page and must not be loaded as model.
const MODEL_MIN_PLAUSIBLE_BYTES: u64 = 400 * 1024 * 1024;
const DOWNLOAD_PROGRESS_EVENT: &str = "scribedog-voice-model-download-progress";
const VOICE_LEVEL_EVENT: &str = "scribedog-voice-level";
const WHISPER_SAMPLE_RATE: u32 = 16_000;

struct ActiveRecording {
    stop_tx: mpsc::Sender<()>,
    join: JoinHandle<()>,
    samples: Arc<Mutex<Vec<f32>>>,
    sample_rate: Arc<AtomicU32>,
}

#[derive(Default)]
pub struct VoiceState {
    recording: Mutex<Option<ActiveRecording>>,
    // The loaded model is kept alive across dictations: loading ~465 MB from
    // disk takes seconds, while creating a per-run whisper state is cheap.
    whisper: Arc<Mutex<Option<WhisperContext>>>,
    download_in_progress: AtomicBool,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceModelStatus {
    downloaded: bool,
    downloading: bool,
}

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct DownloadProgress {
    downloaded_bytes: u64,
    total_bytes: Option<u64>,
}

fn model_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("voice-models");

    Ok(dir.join(MODEL_FILE_NAME))
}

fn model_is_downloaded(path: &PathBuf) -> bool {
    fs::metadata(path)
        .map(|meta| meta.is_file() && meta.len() >= MODEL_MIN_PLAUSIBLE_BYTES)
        .unwrap_or(false)
}

#[tauri::command]
pub fn voice_model_status(
    app: AppHandle,
    state: State<'_, VoiceState>,
) -> Result<VoiceModelStatus, String> {
    let path = model_path(&app)?;

    Ok(VoiceModelStatus {
        downloaded: model_is_downloaded(&path),
        downloading: state.download_in_progress.load(Ordering::SeqCst),
    })
}

#[tauri::command]
pub async fn download_voice_model(app: AppHandle) -> Result<(), String> {
    let state = app.state::<VoiceState>();

    if state
        .download_in_progress
        .swap(true, Ordering::SeqCst)
    {
        return Err("download already in progress".to_string());
    }

    let result = download_voice_model_inner(&app).await;

    app.state::<VoiceState>()
        .download_in_progress
        .store(false, Ordering::SeqCst);

    result
}

async fn download_voice_model_inner(app: &AppHandle) -> Result<(), String> {
    let path = model_path(app)?;

    if model_is_downloaded(&path) {
        return Ok(());
    }

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }

    let partial_path = path.with_extension("bin.partial");

    let mut response = tauri_plugin_http::reqwest::Client::new()
        .get(MODEL_DOWNLOAD_URL)
        .send()
        .await
        .map_err(|error| error.to_string())?
        .error_for_status()
        .map_err(|error| error.to_string())?;

    let total_bytes = response.content_length();
    let mut file = fs::File::create(&partial_path).map_err(|error| error.to_string())?;
    let mut downloaded_bytes: u64 = 0;
    let mut last_emitted_bytes: u64 = 0;

    loop {
        let chunk = match response.chunk().await {
            Ok(Some(chunk)) => chunk,
            Ok(None) => break,
            Err(error) => {
                drop(file);
                let _ = fs::remove_file(&partial_path);
                return Err(error.to_string());
            }
        };

        use std::io::Write;

        if let Err(error) = file.write_all(&chunk) {
            drop(file);
            let _ = fs::remove_file(&partial_path);
            return Err(error.to_string());
        }

        downloaded_bytes += chunk.len() as u64;

        // Emitting on every network chunk would flood the IPC bridge; every
        // ~4 MB keeps the progress bar smooth enough.
        if downloaded_bytes - last_emitted_bytes >= 4 * 1024 * 1024 {
            last_emitted_bytes = downloaded_bytes;
            let _ = app.emit(
                DOWNLOAD_PROGRESS_EVENT,
                DownloadProgress {
                    downloaded_bytes,
                    total_bytes,
                },
            );
        }
    }

    drop(file);

    if downloaded_bytes < MODEL_MIN_PLAUSIBLE_BYTES {
        let _ = fs::remove_file(&partial_path);
        return Err("model download was incomplete".to_string());
    }

    fs::rename(&partial_path, &path).map_err(|error| error.to_string())?;

    let _ = app.emit(
        DOWNLOAD_PROGRESS_EVENT,
        DownloadProgress {
            downloaded_bytes,
            total_bytes,
        },
    );

    Ok(())
}

// Averages interleaved frames down to mono. Whisper expects a single channel.
fn frames_to_mono(input: &[f32], channels: usize) -> Vec<f32> {
    if channels <= 1 {
        return input.to_vec();
    }

    input
        .chunks_exact(channels)
        .map(|frame| frame.iter().sum::<f32>() / channels as f32)
        .collect()
}

// Linear interpolation is plenty for speech feeding a recognizer — this is
// not a playback path where resampling artifacts would be audible.
fn resample_to_whisper_rate(input: &[f32], source_rate: u32) -> Vec<f32> {
    if source_rate == WHISPER_SAMPLE_RATE || input.is_empty() {
        return input.to_vec();
    }

    let ratio = source_rate as f64 / WHISPER_SAMPLE_RATE as f64;
    let output_len = (input.len() as f64 / ratio).floor() as usize;

    (0..output_len)
        .map(|index| {
            let position = index as f64 * ratio;
            let base = position as usize;
            let fraction = (position - base as f64) as f32;
            let current = input[base.min(input.len() - 1)];
            let next = *input.get(base + 1).unwrap_or(&current);
            current + (next - current) * fraction
        })
        .collect()
}

// Streams the input loudness to the UI (throttled) so it can visualize that
// speech is actually being picked up while recording.
struct LevelReporter {
    app: AppHandle,
    last_emit: std::time::Instant,
}

impl LevelReporter {
    fn new(app: AppHandle) -> Self {
        Self {
            app,
            last_emit: std::time::Instant::now(),
        }
    }

    fn report(&mut self, mono: &[f32]) {
        if mono.is_empty() || self.last_emit.elapsed().as_millis() < 80 {
            return;
        }

        self.last_emit = std::time::Instant::now();

        let rms =
            (mono.iter().map(|sample| sample * sample).sum::<f32>() / mono.len() as f32).sqrt();

        let _ = self.app.emit(VOICE_LEVEL_EVENT, rms);
    }
}

fn record_until_stopped(
    app: AppHandle,
    samples: Arc<Mutex<Vec<f32>>>,
    sample_rate: Arc<AtomicU32>,
    ready_tx: mpsc::Sender<Result<(), String>>,
    stop_rx: mpsc::Receiver<()>,
) {
    let device = match cpal::default_host().default_input_device() {
        Some(device) => device,
        None => {
            let _ = ready_tx.send(Err("no microphone found".to_string()));
            return;
        }
    };

    let config = match device.default_input_config() {
        Ok(config) => config,
        Err(error) => {
            let _ = ready_tx.send(Err(error.to_string()));
            return;
        }
    };

    sample_rate.store(config.sample_rate().0, Ordering::SeqCst);

    let channels = config.channels() as usize;
    let stream_samples = Arc::clone(&samples);
    let mut level_reporter = LevelReporter::new(app);
    let error_callback = |_error: cpal::StreamError| {};

    let stream = match config.sample_format() {
        cpal::SampleFormat::F32 => device.build_input_stream(
            &config.into(),
            move |data: &[f32], _: &cpal::InputCallbackInfo| {
                let mono = frames_to_mono(data, channels);
                level_reporter.report(&mono);

                if let Ok(mut buffer) = stream_samples.lock() {
                    buffer.extend(mono);
                }
            },
            error_callback,
            None,
        ),
        cpal::SampleFormat::I16 => device.build_input_stream(
            &config.into(),
            move |data: &[i16], _: &cpal::InputCallbackInfo| {
                let converted: Vec<f32> = data.iter().map(|&s| s as f32 / i16::MAX as f32).collect();
                let mono = frames_to_mono(&converted, channels);
                level_reporter.report(&mono);

                if let Ok(mut buffer) = stream_samples.lock() {
                    buffer.extend(mono);
                }
            },
            error_callback,
            None,
        ),
        cpal::SampleFormat::U16 => device.build_input_stream(
            &config.into(),
            move |data: &[u16], _: &cpal::InputCallbackInfo| {
                let converted: Vec<f32> = data
                    .iter()
                    .map(|&s| (s as f32 - u16::MAX as f32 / 2.0) / (u16::MAX as f32 / 2.0))
                    .collect();
                let mono = frames_to_mono(&converted, channels);
                level_reporter.report(&mono);

                if let Ok(mut buffer) = stream_samples.lock() {
                    buffer.extend(mono);
                }
            },
            error_callback,
            None,
        ),
        other => {
            let _ = ready_tx.send(Err(format!("unsupported sample format: {other}")));
            return;
        }
    };

    let stream = match stream {
        Ok(stream) => stream,
        Err(error) => {
            let _ = ready_tx.send(Err(error.to_string()));
            return;
        }
    };

    if let Err(error) = stream.play() {
        let _ = ready_tx.send(Err(error.to_string()));
        return;
    }

    let _ = ready_tx.send(Ok(()));

    // Blocks until stop_voice_recording/cancel_voice_recording sends (or the
    // sender is dropped). The cpal stream is !Send, so it has to live and die
    // on this thread — which is exactly what this wait accomplishes.
    let _ = stop_rx.recv();
    drop(stream);
}

#[tauri::command]
pub fn start_voice_recording(app: AppHandle, state: State<'_, VoiceState>) -> Result<(), String> {
    if !model_is_downloaded(&model_path(&app)?) {
        return Err("voice model is not downloaded".to_string());
    }

    let mut recording = state
        .recording
        .lock()
        .map_err(|_| "voice state is unavailable".to_string())?;

    if recording.is_some() {
        return Err("a recording is already running".to_string());
    }

    let samples = Arc::new(Mutex::new(Vec::new()));
    let sample_rate = Arc::new(AtomicU32::new(WHISPER_SAMPLE_RATE));
    let (stop_tx, stop_rx) = mpsc::channel();
    let (ready_tx, ready_rx) = mpsc::channel();

    let thread_samples = Arc::clone(&samples);
    let thread_sample_rate = Arc::clone(&sample_rate);
    let thread_app = app.clone();

    let join = std::thread::spawn(move || {
        record_until_stopped(thread_app, thread_samples, thread_sample_rate, ready_tx, stop_rx);
    });

    match ready_rx.recv() {
        Ok(Ok(())) => {}
        Ok(Err(error)) => {
            let _ = join.join();
            return Err(error);
        }
        Err(_) => {
            let _ = join.join();
            return Err("could not start the recording".to_string());
        }
    }

    *recording = Some(ActiveRecording {
        stop_tx,
        join,
        samples,
        sample_rate,
    });

    Ok(())
}

fn take_recording(state: &VoiceState) -> Result<ActiveRecording, String> {
    state
        .recording
        .lock()
        .map_err(|_| "voice state is unavailable".to_string())?
        .take()
        .ok_or_else(|| "no recording is running".to_string())
}

fn finish_recording(recording: ActiveRecording) -> (Vec<f32>, u32) {
    let _ = recording.stop_tx.send(());
    let _ = recording.join.join();

    let samples = recording
        .samples
        .lock()
        .map(|buffer| buffer.clone())
        .unwrap_or_default();

    (samples, recording.sample_rate.load(Ordering::SeqCst))
}

#[tauri::command]
pub fn cancel_voice_recording(state: State<'_, VoiceState>) -> Result<(), String> {
    if let Ok(recording) = take_recording(&state) {
        let _ = finish_recording(recording);
    }

    Ok(())
}

#[tauri::command]
pub async fn stop_voice_recording(
    app: AppHandle,
    language: Option<String>,
) -> Result<String, String> {
    let (samples, source_rate) = {
        let state = app.state::<VoiceState>();
        let recording = take_recording(&state)?;
        finish_recording(recording)
    };

    let mut audio = resample_to_whisper_rate(&samples, source_rate);

    // whisper.cpp rejects inputs shorter than about a second — pad very short
    // dictations with silence instead of failing them.
    let min_samples = (WHISPER_SAMPLE_RATE as usize) * 11 / 10;

    if audio.len() < min_samples {
        audio.resize(min_samples, 0.0);
    }

    let model_path = model_path(&app)?;
    let whisper = Arc::clone(&app.state::<VoiceState>().whisper);

    tauri::async_runtime::spawn_blocking(move || transcribe(&whisper, &model_path, &audio, language))
        .await
        .map_err(|error| error.to_string())?
}

fn transcribe(
    whisper: &Mutex<Option<WhisperContext>>,
    model_path: &PathBuf,
    audio: &[f32],
    language: Option<String>,
) -> Result<String, String> {
    let mut context_slot = whisper
        .lock()
        .map_err(|_| "voice state is unavailable".to_string())?;

    if context_slot.is_none() {
        let context = WhisperContext::new_with_params(
            &model_path.to_string_lossy(),
            WhisperContextParameters::default(),
        )
        .map_err(|error| error.to_string())?;

        *context_slot = Some(context);
    }

    let context = context_slot.as_ref().expect("context was just initialized");
    let mut state = context.create_state().map_err(|error| error.to_string())?;

    let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
    params.set_translate(false);
    params.set_print_special(false);
    params.set_print_progress(false);
    params.set_print_realtime(false);
    params.set_print_timestamps(false);

    if let Some(language) = language.as_deref() {
        params.set_language(Some(language));
    }

    state.full(params, audio).map_err(|error| error.to_string())?;

    let segment_count = state.full_n_segments().map_err(|error| error.to_string())?;
    let mut text = String::new();

    for index in 0..segment_count {
        text.push_str(
            &state
                .full_get_segment_text(index)
                .map_err(|error| error.to_string())?,
        );
    }

    Ok(text.trim().to_string())
}
