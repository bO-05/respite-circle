import type { Role } from "@/server/auth/policy";

/**
 * A person's sign-in link, as a coordinator copies it.
 *
 * The app has no passwords and no accounts: a person's access token, stored on
 * their own person row, is the whole credential. This module does not mint,
 * rotate, or store one. It only turns the token that already belongs to a
 * person into the single URL that signs that person in, and describes where the
 * link lands.
 *
 * The link is copied and handed over by a person. Nothing here sends an email,
 * an SMS, or a notification, and no copy may imply that it does.
 */

/**
 * One plain sentence for the invite screen: the coordinator sends the link the
 * way they already reach the family. It says who sends it and promises nothing
 * the app does not do.
 */
export const ACCESS_LINK_SEND_LINE =
  "You send this link yourself, the way you already reach them — a text message, a printed note, or a phone call.";

/**
 * Where a copied link points when the request carries no usable host. The app
 * runs on 3130 everywhere (architecture.md §5), so this is the documented
 * address rather than a guess.
 */
export const ACCESS_LINK_FALLBACK_ORIGIN = "http://localhost:3130";

/** What each role's own home is called, in one short line under the link. */
export const ACCESS_LINK_HOME_LINE: Record<Role, string> = {
  caregiver: "Opens the family's own ask page.",
  coordinator: "Opens the coordinator desk.",
  deputy: "Opens the coordinator desk.",
  volunteer: "Opens the neighbour board and their own claims.",
  pastor: "Opens the read-only church numbers page.",
};

/**
 * A host that cannot be part of a link we hand to someone: whitespace, a path,
 * a query, a fragment, or an embedded credential would move the copied URL to
 * a different place than the page the coordinator is reading.
 */
const UNSAFE_HOST = /[\s/\\?#@]/;

function firstValue(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const first = value.split(",")[0]?.trim() ?? "";
  return first || null;
}

/** `https://host[:port]`, or null when the value is not an http(s) address. */
function normaliseOrigin(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;

  const trimmed = value.trim();
  if (!trimmed) return null;

  const candidate = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `http://${trimmed}`;

  try {
    const url = new URL(candidate);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (!url.host || UNSAFE_HOST.test(url.host)) return null;
    return `${url.protocol}//${url.host}`;
  } catch {
    return null;
  }
}

export type AccessLinkOriginInput = {
  /** The `host` request header. */
  host?: string | null;
  /** The `x-forwarded-host` header a proxy adds in front of the app. */
  forwardedHost?: string | null;
  /** The `x-forwarded-proto` header a proxy adds in front of the app. */
  forwardedProto?: string | null;
  /** The configured public address, used only when the request has no host. */
  configuredUrl?: string | null;
  /** True where the runtime is known to serve HTTPS (Vercel sets this). */
  httpsOnly?: boolean;
};

/**
 * The origin a copied link names.
 *
 * A coordinator copies the link while looking at this app, so the request's
 * own host is the truthful origin: the link opens where they are. A proxy that
 * forwards the original host and scheme wins over the internal one, and a host
 * that could steer the URL elsewhere is ignored in favour of the configured
 * address.
 */
export function resolveAccessLinkOrigin(
  input: AccessLinkOriginInput,
): string {
  const host = firstValue(input.forwardedHost) ?? firstValue(input.host);
  const configured = normaliseOrigin(input.configuredUrl);
  const forwardedProto = firstValue(input.forwardedProto)?.toLowerCase();

  if (host && !UNSAFE_HOST.test(host)) {
    const scheme =
      forwardedProto === "https" || forwardedProto === "http"
        ? forwardedProto
        : input.httpsOnly
          ? "https"
          : "http";
    return `${scheme}://${host}`;
  }

  return configured ?? ACCESS_LINK_FALLBACK_ORIGIN;
}

/** The entry route for one token, or null when there is no token. */
export function accessLinkPath(accessToken: string): string | null {
  const token = typeof accessToken === "string" ? accessToken.trim() : "";
  if (!token) return null;
  return `/enter/${encodeURIComponent(token)}`;
}

/**
 * The full URL a coordinator copies. Null means the person has no token to
 * copy; the caller refuses rather than inventing a link.
 */
export function accessLinkUrl(
  origin: string,
  accessToken: string,
): string | null {
  const path = accessLinkPath(accessToken);
  if (!path) return null;

  const base = normaliseOrigin(origin) ?? ACCESS_LINK_FALLBACK_ORIGIN;
  return `${base}${path}`;
}
