// Turns a raw browser user-agent string into a short label like "Android · Chrome".
export function deviceLabel(userAgent: string | null | undefined): string {
  if (!userAgent) return "Unknown device";

  const os = /Android/i.test(userAgent)
    ? "Android"
    : /iPhone|iPad|iPod/i.test(userAgent)
      ? "iPhone"
      : /Windows/i.test(userAgent)
        ? "Windows"
        : /Mac OS X|Macintosh/i.test(userAgent)
          ? "Mac"
          : /Linux/i.test(userAgent)
            ? "Linux"
            : null;

  const browser = /Edg\//i.test(userAgent)
    ? "Edge"
    : /OPR\/|Opera/i.test(userAgent)
      ? "Opera"
      : /Firefox\//i.test(userAgent)
        ? "Firefox"
        : /Chrome\//i.test(userAgent)
          ? /; wv\)/.test(userAgent)
            ? "REEF app"
            : "Chrome"
          : /Safari\//i.test(userAgent)
            ? "Safari"
            : null;

  const label = [os, browser].filter(Boolean).join(" · ");
  return label || userAgent;
}
