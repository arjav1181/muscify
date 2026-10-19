/**
 * Shorts and other non-song results.
 *
 * YouTube has no "music only" switch, and search mixes songs with Shorts, live
 * reaction clips, tutorial uploads and hour-long compilations. Shorts are the
 * worst of them for a music player: vertical, fifteen seconds, and never a
 * recording of a song. Someone searching "pritam" should not get a sixty-second
 * vertical reel in the results.
 *
 * The filters below are ordered by how much they can be trusted, because none of
 * them is certain and guessing in the wrong direction is costly in both
 * directions: too aggressive and real songs vanish, too timid and the shelf is
 * still rubbish.
 */

/** What a search result looks like, as far as filtering is concerned. */
export interface FilterableItem {
  title?: string;
  description?: string;
  channelTitle?: string;
  /** ISO 8601, e.g. "PT4M13S" or "PT45S". */
  duration?: string;
  thumbnails?: Record<string, { url?: string; width?: number; height?: number } | undefined>;
}

const SHORT_SECONDS = 61;

/** ISO 8601 duration → seconds. Returns undefined when it cannot be read. */
export function parseDuration(iso: string | undefined): number | undefined {
  if (!iso) return undefined;
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso.trim());
  if (!m) return undefined;
  const [, h, min, s] = m;
  if (h === undefined && min === undefined && s === undefined) return undefined;
  return Number(h ?? 0) * 3600 + Number(min ?? 0) * 60 + Number(s ?? 0);
}

/**
 * The widest thumbnail's aspect ratio, or undefined when there are none.
 *
 * `maxres` first because that is the largest and so the least noisy to measure;
 * falling back keeps this working when a video only has small thumbnails.
 */
function aspectRatio(item: FilterableItem): number | undefined {
  const names = ["maxres", "standard", "high", "medium", "default"];
  for (const name of names) {
    const t = item.thumbnails?.[name];
    if (t?.width && t?.height && t.height > 0) return t.width / t.height;
  }
  return undefined;
}

/** True when a thumbnail is portrait or square, which normal video is not. */
function isPortraitOrSquare(item: FilterableItem): boolean {
  const ratio = aspectRatio(item);
  // 16:9 is 1.78. Anything at or below 1.15 is vertical or square.
  return ratio !== undefined && ratio <= 1.15;
}

/** Shorts put their marker in the title more often than anywhere else. */
function hasShortMarker(text: string | undefined): boolean {
  if (!text) return false;
  return /(^|\s)#(shorts?|fyp|foryou|trending)\b/i.test(text);
}

/**
 * Why an item was rejected, for tests and for explaining a thin result set.
 *
 * Returning the reason rather than a bare boolean means a caller can tell
 * "we filtered three Shorts" from "the search genuinely found nothing", which
 * are very different situations to show someone.
 */
export type RejectReason =
  | "short-marker"
  | "portrait"
  | "too-short"
  | "live-stream"
  | "not-official";

export function rejectReason(item: FilterableItem): RejectReason | null {
  const title = item.title ?? "";
  const blob = `${title} ${item.description ?? ""}`;

  // 1. An explicit marker. Never wrong, so it goes first.
  if (hasShortMarker(blob)) return "short-marker";

  // 2. A live stream or premiere is not a recording someone wants to play.
  if (/\b(live now|livestream|\blive\b.*\b(on|at)\b)/i.test(title)) return "live-stream";

  // 3. A portrait thumbnail is the structural signature of a Short. This is the
  //    strongest *structural* signal available, because YouTube renders Shorts
  //    vertically and normal uploads are 16:9.
  const seconds = parseDuration(item.duration);
  if (isPortraitOrSquare(item)) {
    // A vertical upload that is also short is a Short. A vertical one that runs
    // for six minutes is a normal music video filmed sideways, and is kept.
    if (seconds === undefined || seconds <= SHORT_SECONDS) return "portrait";
  }

  // 4. Under a minute with no portrait signal. Deliberately last and
  //    deliberately narrow: real songs get clipped, 30-second intros exist, and
  //    a jingle is not a track. Only reject when nothing else already did, and
  //    never on a portrait-shaped upload of unknown length.
  if (seconds !== undefined && seconds > 0 && seconds < 30 && !isPortraitOrSquare(item)) {
    return "too-short";
  }

  return null;
}

export function isShort(item: FilterableItem): boolean {
  return rejectReason(item) !== null;
}

/** Keeps the songs, drops the rest. */
export function withoutShorts<T extends FilterableItem>(items: T[]): T[] {
  return items.filter((item) => rejectReason(item) === null);
}