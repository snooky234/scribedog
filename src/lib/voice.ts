import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export type VoiceModelStatus = {
  downloaded: boolean;
  downloading: boolean;
};

export type VoiceModelDownloadProgress = {
  downloadedBytes: number;
  totalBytes: number | null;
};

export const VOICE_MODEL_SIZE_MB = 465;

export function getVoiceModelStatus(): Promise<VoiceModelStatus> {
  return invoke<VoiceModelStatus>("voice_model_status");
}

export function downloadVoiceModel(): Promise<void> {
  return invoke("download_voice_model");
}

export function startVoiceRecording(): Promise<void> {
  return invoke("start_voice_recording");
}

export function stopVoiceRecording(language: string | null): Promise<string> {
  return invoke<string>("stop_voice_recording", { language });
}

export function cancelVoiceRecording(): Promise<void> {
  return invoke("cancel_voice_recording");
}

export function listenToVoiceModelDownloadProgress(
  handler: (progress: VoiceModelDownloadProgress) => void
): Promise<() => void> {
  return listen<VoiceModelDownloadProgress>("scribedog-voice-model-download-progress", (event) =>
    handler(event.payload)
  );
}

// Fires ~every 80 ms while a recording runs; payload is the RMS loudness of
// the latest microphone chunk (0 = silence, speech typically 0.02–0.2).
export function listenToVoiceLevel(handler: (rms: number) => void): Promise<() => void> {
  return listen<number>("scribedog-voice-level", (event) => handler(event.payload));
}

// Whisper takes ISO-639-1 codes; the app locales are already exactly that
// ("de", "ja", …), so the UI language doubles as the dictation-language hint.
export function whisperLanguageFromLocale(locale: string | undefined): string | null {
  const language = locale?.split("-")[0]?.toLowerCase() ?? "";
  return /^[a-z]{2}$/.test(language) ? language : null;
}
