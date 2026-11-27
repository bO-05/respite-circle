/**
 * The origin the app is served from, used as `metadataBase` so share tags can
 * carry relative paths and still resolve to absolute URLs.
 *
 * Production sets `NEXT_PUBLIC_APP_URL` to the Vercel origin. The two Vercel
 * system variables are fallbacks for a build that has not been given the
 * public one yet. A local build falls back to the documented port, so a
 * developer sees working share tags without any extra setup.
 */
export function deploymentUrl(
  env: Record<string, string | undefined> = process.env,
): URL {
  const candidates = [
    env.NEXT_PUBLIC_APP_URL,
    env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL}`
      : undefined,
    env.VERCEL_URL ? `https://${env.VERCEL_URL}` : undefined,
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const url = new URL(candidate);
      if (url.protocol === "http:" || url.protocol === "https:") return url;
    } catch {
      // A malformed override must not take the build down; the next source
      // (or the local default) still gives a usable origin.
    }
  }

  return new URL("http://localhost:3130");
}
