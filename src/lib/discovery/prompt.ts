/**
 * Prompted playlist generation.
 *
 * The product spec describes an "AI Playlist" that takes a natural-language
 * prompt and refines it over follow-up turns. What that needs, underneath, is
 * a structured query: this turns free text into one.
 *
 * It is a parser, not a model. It reads the vocabulary a listener actually
 * uses — moods, eras, languages, genres, tempo, energy, artists they name —
 * and emits a scored intent plus the search queries to run. What it cannot do
 * is understand a request outside that vocabulary, and it says so rather than
 * returning something plausible-looking that misses what was asked.
 *
 * Pure, so the mapping can be tested against real phrasings.
 */

export type Mood =
  | "chill"
  | "focus"
  | "workout"
  | "party"
  | "sleep"
  | "commute"
  | "nostalgia"
  | "focus_morning";

export interface PromptIntent {
  /** Detected moods, strongest first. */
  moods: Mood[];
  /** Free-text fragments suitable for a search query. */
  terms: string[];
  /** Named artists, when the prompt says something like "like Arijit Singh". */
  artists: string[];
  /** Years mentioned, e.g. "90s" or "2015". */
  years: number[];
  /** Languages, matched loosely — "hindi" also implies the bhansra angle. */
  languages: string[];
  /** 0..1, or null when the prompt said nothing about tempo. */
  minTempo: number | null;
  maxTempo: number | null;
  /** 0..1, or null when unspecified. */
  minEnergy: number | null;
  maxEnergy: number | null;
  /**
   * 0..1 — how much of the prompt was actually understood.
   *
   * The UI surfaces this. A prompt that parsed to almost nothing is reported
   * as unrecognised rather than answered with a generic playlist.
   */
  coverage: number;
  /** Words we could not map, offered back as search terms. */
  unmatched: string[];
}

/** Mood vocabulary. Order matters: the first match on a phrase wins. */
const MOOD_WORDS: { mood: Mood; words: string[]; hint: string }[] = [
  {
    mood: "sleep",
    words: ["sleep", "sleepy", "bedtime", "lullaby", "insomnia", "night", "dream", "calm down", "wind down"],
    hint: "slow, quiet, low energy",
  },
  {
    mood: "focus",
    words: ["focus", "focused", "concentrate", "study", "work", "deep work", "reading", "coding"],
    hint: "instrumental-leaning, steady",
  },
  {
    mood: "workout",
    words: ["workout", "gym", "run", "running", "cardio", "exercise", "training", "sprint", "pump"],
    hint: "high tempo, high energy",
  },
  {
    mood: "party",
    words: ["party", "dance", "dancing", "club", "clubbing", "rave", "bash", "celebration", "party time"],
    hint: "high energy",
  },
  {
    mood: "commute",
    words: ["commute", "drive", "driving", "travel", "journey", "road trip"],
    hint: "mid tempo, familiar",
  },
  {
    mood: "nostalgia",
    words: ["nostalgia", "nostalgic", "throwback", "old", "classic", "retro", "yesterday", "miss"],
    hint: "older releases",
  },
  {
    mood: "chill",
    words: ["chill", "chillout", "chilled", "relax", "relaxing", "easy", "smooth", "laid back", "mellow", "vibe"],
    hint: "mid tempo, mid energy",
  },
];

/** Tempo and energy expectations per mood, used when the prompt is silent. */
const MOOD_TARGETS: Record<Mood, { tempo: [number, number]; energy: [number, number] }> = {
  sleep: { tempo: [50, 85], energy: [0, 0.3] },
  focus: { tempo: [85, 120], energy: [0.25, 0.6] },
  focus_morning: { tempo: [90, 125], energy: [0.3, 0.65] },
  workout: { tempo: [128, 200], energy: [0.65, 1] },
  party: { tempo: [120, 200], energy: [0.7, 1] },
  commute: { tempo: [100, 140], energy: [0.45, 0.8] },
  nostalgia: { tempo: [90, 145], energy: [0.3, 0.75] },
  chill: { tempo: [80, 118], energy: [0.25, 0.6] },
};

const LANGUAGE_WORDS: Record<string, string[]> = {
  hindi: ["hindi", "bharati", "bollywood", "filmi", "semitone"],
  punjabi: ["punjabi", "punjab", "bhangra", "giddha"],
  tamil: ["tamil", "kollywood"],
  telugu: ["telugu", "tollywood"],
  bengali: ["bengali", "bangla"],
  malayalam: ["malayalam", "mollywood"],
  kannada: ["kannada"],
  marathi: ["marathi"],
  english: ["english", "western", "international"],
  urdu: ["urdu"],
  korean: ["korean", "kpop", "k-pop"],
  japanese: ["japanese", "jpop", "j-pop", "anime"],
};

/** Words that describe the request rather than the music. */
const FILLER = new Set([
  "make", "me", "a", "an", "playlist", "play", "list", "with", "some", "of", "songs", "song", "tracks",
  "track", "music", "give", "put", "find", "want", "need", "please", "for", "my", "that", "like", "sounds",
  "good", "stuff", "things", "similar", "vibe", "mix", "and", "or", "in", "to", "but", "not", "without",
  "can", "you", "i", "im", "lets", "let", "something", "anything", "stuff", "whatever", "only", "just",
]);

const STOP = new Set(["a", "an", "the", "of", "in", "on", "at", "to", "and", "or", "with", "for", "me", "my"]);

/** Explicit tempo phrases take priority over mood inference. */
const TEMPO_PHRASES: { re: RegExp; min: number; max: number }[] = [
  { re: /\bslow(?:er)?\b/, min: 60, max: 95 },
  { re: /\bfast(?:er)?\b/, min: 135, max: 190 },
  { re: /\bupbeat\b/, min: 118, max: 180 },
  { re: /\bspeed\s*up\b/, min: 130, max: 190 },
  { re: /\bhalf\s*speed\b/, min: 55, max: 85 },
];

const ENERGY_PHRASES: { re: RegExp; min: number; max: number }[] = [
  { re: /\bhigh\s*energy\b/, min: 0.7, max: 1 },
  { re: /\blow\s*energy\b/, min: 0, max: 0.35 },
  { re: /\bchill(?:ing)?\s*out\b/, min: 0.1, max: 0.5 },
];

/** Capitalised runs that are not sentence-initial are almost always artist names. */
function extractArtists(text: string, lower: string): string[] {
  const out = new Set<string>();
  const explicit = /\b(?:like|similar to|in the style of|some)\s+([a-z][\w'&.\- ]{2,40}?)(?=\s*(?:,|$|\band\b|\bbut\b|\bwith\b|\bsongs?\b|\btracks?\b|\bmusic\b|\bfor\b))/gi;
  for (const m of text.matchAll(explicit)) {
    const name = m[1].trim();
    if (name.length > 2) out.add(name);
  }

  // Capitalised mid-sentence tokens. Skipped when the whole string is lower
  // case, because then capitalisation carries no signal at all.
  if (text !== lower) {
    for (const m of text.matchAll(/(?<!^)(?<![.!?]\s)(?<![\w'])\b([A-Z][\w'&.\-]{1,}(?:\s+[A-Z][\w'&.\-]{1,}){0,2})\b/g)) {
      const name = m[1].trim();
      if (name.length > 2 && !STOP.has(name.toLowerCase())) out.add(name);
    }
  }
  return [...out];
}

function extractYears(text: string): number[] {
  const years: number[] = [];
  const now = new Date().getFullYear();

  // Full years first: 1950–2049.
  for (const m of text.matchAll(/\b(19[5-9]\d|20[0-4]\d)\b/g)) years.push(Number(m[1]));

  // Decade with a stated century: "1990s", "2000s", "2015s".
  for (const m of text.matchAll(/\b((?:19|20)\d{2})s\b/g)) years.push(Number(m[1]));

  // Bare decade: "90s" → 1990, "00s" → 2000.
  for (const m of text.matchAll(/\b(\d{2})s\b/g)) {
    const n = Number(m[1]);
    if (n >= 50) years.push(1900 + n);
    else if (n <= 25) years.push(2000 + n);
  }

  return [...new Set(years)].filter((y) => y <= now);
}

/**
 * Parses a prompt into a structured intent.
 *
 * `coverage` counts how many meaningful words were actually consumed. Words
 * that map to nothing become `unmatched`, which the caller can offer back as
 * search terms instead of silently dropping.
 */
export function parsePrompt(raw: string): PromptIntent {
  const text = (raw ?? "").trim();
  const lower = text.toLowerCase();
  const consumed = new Set<string>();

  // Moods are ordered by where they appear in the prompt, not by the order of
  // the vocabulary table. "chill lofi beats to study" leads with chill because
  // that is what was asked for first, even though "study" maps to a mood
  // earlier in the table. Ordering by position keeps the leading mood — which
  // supplies the tempo and energy defaults below — faithful to the request.
  const hits: { mood: Mood; at: number; word: string }[] = [];
  for (const { mood, words } of MOOD_WORDS) {
    for (const word of words) {
      const at = lower.indexOf(word);
      if (at === -1) continue;
      // Prefer the earliest, longest matching phrase for this mood.
      const existing = hits.find((h) => h.mood === mood);
      if (existing && (existing.at < at || existing.word.length >= word.length)) continue;
      if (existing) {
        existing.at = at;
        existing.word = word;
      } else {
        hits.push({ mood, at, word });
      }
      break;
    }
  }
  hits.sort((a, b) => a.at - b.at);
  const moods = hits.map((h) => h.mood);
  for (const hit of hits) for (const part of hit.word.split(" ")) consumed.add(part);

  const languages: string[] = [];
  for (const [lang, words] of Object.entries(LANGUAGE_WORDS)) {
    if (words.some((w) => lower.includes(w))) {
      languages.push(lang);
      for (const w of words) consumed.add(w);
    }
  }

  let minTempo: number | null = null;
  let maxTempo: number | null = null;
  for (const { re, min, max } of TEMPO_PHRASES) {
    if (re.test(lower)) {
      minTempo = minTempo === null ? min : Math.max(minTempo, min);
      maxTempo = maxTempo === null ? max : Math.min(maxTempo, max);
      consumed.add(re.source.replace(/\\b|\b/g, "").replace(/[()]/g, ""));
    }
  }

  let minEnergy: number | null = null;
  let maxEnergy: number | null = null;
  for (const { re, min, max } of ENERGY_PHRASES) {
    if (re.test(lower)) {
      minEnergy = minEnergy === null ? min : Math.max(minEnergy, min);
      maxEnergy = maxEnergy === null ? max : Math.min(maxEnergy, max);
      consumed.add("energy");
    }
  }

  // Fall back to the mood's expected range only where the prompt was silent.
  if (moods.length > 0 && minTempo === null) {
    const [lo, hi] = MOOD_TARGETS[moods[0]].tempo;
    minTempo = lo;
    maxTempo = hi;
  }
  if (moods.length > 0 && minEnergy === null) {
    const [lo, hi] = MOOD_TARGETS[moods[0]].energy;
    minEnergy = lo;
    maxEnergy = hi;
  }

  const years = extractYears(text);
  const artists = extractArtists(text, lower);

  // Remaining words are free-text search terms.
  const leftovers = lower
    .split(/[^a-z0-9'\-]+/)
    .filter((w) => w.length > 2 && !STOP.has(w) && !FILLER.has(w) && !consumed.has(w))
    .filter((w) => !languages.some((l) => LANGUAGE_WORDS[l].includes(w)))
    .filter((w) => !/^\d+s?$/.test(w));

  for (const a of artists) {
    for (const w of a.toLowerCase().split(/[^a-z0-9'\-]+/)) if (w.length > 2) consumed.add(w);
  }

  const meaningful = lower.split(/[^a-z0-9'\-]+/).filter((w) => w.length > 2 && !FILLER.has(w));
  const matched = meaningful.filter((w) =>
    consumed.has(w) || artists.some((a) => a.toLowerCase().includes(w)),
  ).length;
  const coverage = meaningful.length === 0 ? 0 : Math.min(1, matched / meaningful.length);

  return {
    moods,
    terms: [...new Set(leftovers)],
    artists,
    years,
    languages,
    minTempo,
    maxTempo,
    minEnergy,
    maxEnergy,
    coverage,
    unmatched: [...new Set(leftovers)].slice(0, 6),
  };
}

/**
 * Turns an intent into concrete search queries.
 *
 * Separate queries rather than one long string: the sources score a short,
 * specific query far better than a soup of every modifier mentioned.
 */
export function intentToQueries(intent: PromptIntent, limit = 4): string[] {
  const queries: string[] = [];

  // A named artist is the strongest signal, so it leads.
  for (const artist of intent.artists.slice(0, 2)) queries.push(artist);

  const moodQuery = [...intent.terms.slice(0, 3), ...intent.languages.slice(0, 1)];
  if (moodQuery.length) queries.push(moodQuery.join(" "));

  if (intent.years.length) {
    const year = intent.years[0];
    queries.push(`${intent.terms.slice(0, 2).join(" ")} ${year}`.trim());
  }
  if (intent.moods.length) {
    const words = intent.moods.flatMap((m) => m.split("_"));
    queries.push([...words, ...intent.languages.slice(0, 1)].join(" "));
  }

  return [...new Set(queries.map((q) => q.trim()).filter(Boolean))].slice(0, limit);
}

/** Human-readable summary of what was understood, shown above the results. */
export function describeIntent(intent: PromptIntent): string {
  if (intent.coverage < 0.15) {
    return "I didn't recognise much in that — try naming a mood, a language or an artist.";
  }
  const bits: string[] = [];
  if (intent.moods.length) bits.push(intent.moods.map((m) => m.replace("_", " ")).join(", "));
  if (intent.languages.length) bits.push(intent.languages.join(", "));
  if (intent.artists.length) bits.push(`in the style of ${intent.artists.join(", ")}`);
  if (intent.years.length) bits.push(`from ${intent.years.join(", ")}`);
  if (intent.minTempo !== null) bits.push(`${Math.round(intent.minTempo)}–${Math.round(intent.maxTempo!)} BPM`);
  return bits.length ? `Understood: ${bits.join(" · ")}` : "Not much to go on there.";
}