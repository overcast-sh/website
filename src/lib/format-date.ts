/**
 * One date formatter for the whole site.
 *
 * Dates are baked at build time, so the server has no idea who is reading. The
 * pair below is the whole contract:
 *
 * - `formatDate` renders the build-time text. It pins a locale and UTC on
 *   purpose — without them the output depends on whatever locale and timezone
 *   the build machine happens to have, so the same commit built in Auckland and
 *   in CI could stamp different days on the same release.
 * - `toIsoDate` supplies the machine-readable value for `<time datetime>`, which
 *   the inline script in SiteLayout re-renders in the reader's own locale and
 *   timezone. The SSR text is the no-JS fallback and is never wrong, only
 *   foreign.
 *
 * Every rendered date on the site goes through both.
 */

const BUILD_LOCALE = "en-GB";
const OPTIONS: Intl.DateTimeFormatOptions = { dateStyle: "medium", timeZone: "UTC" };

export function formatDate(value: string | Date | null | undefined): string {
  const date = toDate(value);
  return date ? new Intl.DateTimeFormat(BUILD_LOCALE, OPTIONS).format(date) : "";
}

export function toIsoDate(value: string | Date | null | undefined): string | undefined {
  const date = toDate(value);
  return date ? date.toISOString() : undefined;
}

function toDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
