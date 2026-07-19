import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  cancelVoiceRecording,
  getVoiceModelStatus,
  listenToVoiceLevel,
  startVoiceRecording,
  stopVoiceRecording,
  whisperLanguageFromLocale
} from "@/lib/voice";

export type VoiceInputStatus = "idle" | "starting" | "recording" | "transcribing";

type UseVoiceInputOptions = {
  onTranscript: (text: string) => void;
  onError: (message: string) => void;
};

function extractMessage(error: unknown): string {
  if (typeof error === "string") {
    return error;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

// Drives one voice-input target (the AI prompt field or the editor itself):
// model check → record → transcribe, plus the "model not downloaded yet"
// dialog trigger. The recording itself lives on the Rust side; this hook only
// tracks which phase the UI is in.
export function useVoiceInput({ onTranscript, onError }: UseVoiceInputOptions) {
  const { i18n } = useTranslation();
  const [status, setStatus] = useState<VoiceInputStatus>("idle");
  const [isModelDialogOpen, setIsModelDialogOpen] = useState(false);
  // 0..1 loudness of the running recording, for visual "the mic hears you"
  // feedback (0 when not recording).
  const [level, setLevel] = useState(0);
  const statusRef = useRef(status);
  statusRef.current = status;

  useEffect(() => {
    if (status !== "recording") {
      setLevel(0);
      return;
    }

    let unlisten: (() => void) | null = null;
    let disposed = false;

    void listenToVoiceLevel((rms) => {
      // Speech RMS rarely exceeds ~0.15 on typical mics. The exponent < 1
      // compresses the range so quiet speech already moves the glow
      // noticeably, while loud speech still tops out at 1.
      setLevel(Math.min(1, Math.pow(rms * 12, 0.55)));
    }).then((stopListening) => {
      if (disposed) {
        stopListening();
      } else {
        unlisten = stopListening;
      }
    });

    return () => {
      disposed = true;
      unlisten?.();
      setLevel(0);
    };
  }, [status]);

  const begin = useCallback(async () => {
    setStatus("starting");

    try {
      const modelStatus = await getVoiceModelStatus();

      if (!modelStatus.downloaded) {
        setStatus("idle");
        setIsModelDialogOpen(true);
        return;
      }

      await startVoiceRecording();
      setStatus("recording");
    } catch (error) {
      setStatus("idle");
      onError(extractMessage(error));
    }
  }, [onError]);

  const stop = useCallback(async () => {
    if (statusRef.current !== "recording") {
      return;
    }

    setStatus("transcribing");

    try {
      const transcript = await stopVoiceRecording(whisperLanguageFromLocale(i18n.language));
      setStatus("idle");

      if (transcript) {
        onTranscript(transcript);
      }
    } catch (error) {
      setStatus("idle");
      onError(extractMessage(error));
    }
  }, [i18n.language, onTranscript, onError]);

  const cancel = useCallback(() => {
    if (statusRef.current === "recording") {
      void cancelVoiceRecording();
    }

    setStatus("idle");
    setIsModelDialogOpen(false);
  }, []);

  const toggle = useCallback(() => {
    if (statusRef.current === "recording") {
      void stop();
    } else if (statusRef.current === "idle") {
      void begin();
    }
  }, [begin, stop]);

  const closeModelDialog = useCallback(() => setIsModelDialogOpen(false), []);

  const handleModelDownloaded = useCallback(() => {
    setIsModelDialogOpen(false);
    void begin();
  }, [begin]);

  // A recording must not outlive its target (dialog closed, file switched,
  // component unmounted) — discard it instead of leaving the mic open.
  useEffect(() => {
    return () => {
      if (statusRef.current === "recording") {
        void cancelVoiceRecording();
      }
    };
  }, []);

  return {
    status,
    level,
    toggle,
    stop,
    cancel,
    isModelDialogOpen,
    closeModelDialog,
    handleModelDownloaded
  };
}
