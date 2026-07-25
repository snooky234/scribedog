const UNITS: Array<{ unit: Intl.RelativeTimeFormatUnit; ms: number }> = [
  { unit: "year", ms: 365 * 24 * 60 * 60 * 1000 },
  { unit: "month", ms: 30 * 24 * 60 * 60 * 1000 },
  { unit: "day", ms: 24 * 60 * 60 * 1000 },
  { unit: "hour", ms: 60 * 60 * 1000 },
  { unit: "minute", ms: 60 * 1000 },
  { unit: "second", ms: 1000 }
];

/** "vor 5 Minuten" / "5 minutes ago", in the currently active UI language. */
export function formatRelativeTimestamp(timestamp: number, language: string): string {
  const deltaMs = timestamp - Date.now();
  const absoluteDeltaMs = Math.abs(deltaMs);

  try {
    const formatter = new Intl.RelativeTimeFormat(language, { numeric: "auto" });

    for (const { unit, ms } of UNITS) {
      if (absoluteDeltaMs >= ms || unit === "second") {
        return formatter.format(Math.round(deltaMs / ms), unit);
      }
    }
  } catch {
    // Fall through to the absolute timestamp below.
  }

  return formatAbsoluteTimestamp(timestamp, language);
}

export function formatAbsoluteTimestamp(timestamp: number, language: string): string {
  try {
    return new Intl.DateTimeFormat(language, {
      dateStyle: "medium",
      timeStyle: "short"
    }).format(new Date(timestamp));
  } catch {
    return new Date(timestamp).toISOString();
  }
}
