type VoiceRecordingBannerProps = {
  // 0..1 speech loudness while recording — drives the outward glow.
  level: number;
  isRecording: boolean;
  message: string;
  className?: string;
};

// The one recording indicator used everywhere (editor dictation and the AI
// dialog): a red-dot banner whose outward glow follows the measured speech
// level, so it's obvious the microphone is picking up audio.
export function VoiceRecordingBanner({ level, isRecording, message, className }: VoiceRecordingBannerProps) {
  return (
    <div
      className={
        className ? `editor-view__feedback editor-view__feedback--voice ${className}` : "editor-view__feedback editor-view__feedback--voice"
      }
      // Inward glow (inset) instead of outward: surrounding containers clip
      // anything drawn outside the banner, so an outer glow gets cut off.
      style={
        isRecording
          ? {
              boxShadow: `inset 0 0 ${12 + level * 48}px ${2 + level * 16}px rgba(239, 68, 68, ${
                0.3 + level * 0.55
              }), inset 0 0 ${5 + level * 16}px ${1 + level * 6}px rgba(255, 130, 130, ${0.35 + level * 0.5})`
            }
          : undefined
      }
      aria-live="polite"
    >
      <span className="editor-view__feedback-message">{message}</span>
    </div>
  );
}
