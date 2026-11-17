import { messagesByLocale } from "@/messages.generated";
import { ApiError } from "./api-client";

// Reads copy from the generated message catalogue (conventions §9, UX-22): `copy("<module>.<key>")` returns a lookup that
// falls back to the key itself and fills {placeholders}.
export type Copy = (key: string, vars?: Record<string, string | number>) => string;

export function copy(namespace: string, locale = "en"): Copy {
  const messages = messagesByLocale[locale]?.[namespace] ?? {};
  return (key, vars) => {
    const value = messages[key];
    const text = typeof value === "string" ? value : key;
    return vars
      ? text.replace(/\{(\w+)\}/g, (_m, name: string) => String(vars[name] ?? `{${name}}`))
      : text;
  };
}

/** `errors.<code>` from the catalogue when it exists, else the server's message, else a generic line. */
export function errorText(t: Copy, e: unknown): string {
  if (e instanceof ApiError) {
    const specific = t(`errors.${e.code}`);
    return specific !== `errors.${e.code}`
      ? specific
      : e.status >= 500
        ? t("errors.generic")
        : e.message;
  }
  return t("errors.generic");
}

/** Only same-site paths may be used as a post-sign-in target (no open redirect). */
export function safeNext(
  value: string | null | undefined,
  fallback = "/settings/connections",
): string {
  return value && value.startsWith("/") && !value.startsWith("//") && !value.startsWith("/\\")
    ? value
    : fallback;
}
