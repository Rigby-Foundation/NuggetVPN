import type { Profile } from "@/types";

function decode(value: string) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const next = decodeURIComponent(value);
      if (next === value) break;
      value = next;
    } catch {
      break;
    }
  }
  return value;
}

function description(value: string) {
  value = decode(value);
  if (value.length > 16384) return "";
  try {
    const bytes = Uint8Array.from(
      atob(value.replace(/-/g, "+").replace(/_/g, "/")),
      (char) => char.charCodeAt(0),
    );
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (!/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text)) return text.trim();
  } catch {
    /* Some providers send plain text. */
  }
  return value.trim();
}

function label(value: string) {
  const marker = /[?&]serverDescription=([^&]*)/i;
  const original = value;
  const decoded = decode(value);
  if (!marker.test(value)) value = decoded;
  const match = marker.exec(value);
  const query = value.indexOf("?");
  return match
    ? {
        name: decode(
          value.slice(
            0,
            query >= 0 && query < match.index ? query : match.index,
          ),
        ).trim(),
        description: description(match[1]),
      }
    : { name: original, description: "" };
}

// Also handles saved profiles returned by an app binary predating this field.
export function withProfileMetadata(profile: Profile): Profile {
  const metadata = label(profile.name);
  let detail = profile.description;
  if (!detail) {
    try {
      const url = new URL(profile.config_link);
      detail = label(url.hash.slice(1)).description;
      if (!detail) {
        const match = /(?:^|&)serverDescription=([^&]*)/i.exec(
          url.search.slice(1),
        );
        if (match) detail = description(match[1]);
      }
    } catch {
      /* A JSON profile has no URL metadata. */
    }
  }
  detail ||= metadata.description;
  return { ...profile, name: metadata.name, description: detail || undefined };
}
