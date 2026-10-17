/**
 * Track-switch planning.
 *
 * Extracted from the player host because the switch decision is where the
 * worst playback bug lived, and it was invisible to review: an early return
 * that looked like a harmless optimisation.
 *
 * The rule the switch effect got wrong was comparing *source*, not *track*.
 * Going from one YouTube track to another YouTube track leaves the source
 * unchanged, so the guard fired and `engine.load()` was never reached — the
 * player simply stayed on the old song with no error anywhere.
 *
 * Pure, so that case is a test rather than something a human has to notice.
 */

export type SourceId = "youtube" | "deezer" | "soundcloud" | "radio";

export interface SwitchPlan {
  /** Sources whose `stop()` must run before the new one loads. */
  stopSources: SourceId[];
  /** The source that should own playback afterwards. */
  claim: SourceId | null;
  /** Whether the incoming engine must load the track. */
  load: boolean;
  /** Whether playback should be (re)started after loading. */
  play: boolean;
  /** True when the track changed within the same source. */
  sameSource: boolean;
  /** True when there is nothing to play. */
  idle: boolean;
}

export interface SwitchInput {
  /** Source of the incoming track, null when the queue is empty. */
  target: SourceId | null;
  /** Source currently holding playback, null when nothing is loaded. */
  active: SourceId | null;
  /** All sources that have a mounted engine. */
  all: SourceId[];
  /** Key of the incoming track, so an identical re-render can be ignored. */
  targetKey: string | null;
  /** Key of the track currently loaded. */
  activeKey: string | null;
  /** Whether the transport should be running. */
  isPlaying: boolean;
}

/**
 * Decides what a track change requires.
 *
 * The load is unconditional once the track actually differs. Tearing down the
 * other engines is conditional, because that only needs to happen when
 * ownership of playback moves.
 */
export function planSwitch(input: SwitchInput): SwitchPlan {
  const { target, active, all, targetKey, activeKey, isPlaying } = input;

  if (!target || targetKey === null) {
    return {
      stopSources: all.filter((s) => s !== active),
      claim: null,
      load: false,
      play: false,
      sameSource: false,
      idle: true,
    };
  }

  // Re-rendering with the same track is not a switch. The source is part of
  // the identity too: keys are normally `source:id`, but if ownership and key
  // ever disagree, the source wins, because loading into the wrong engine is
  // worse than reloading.
  if (targetKey === activeKey && target === active) {
    return {
      stopSources: [],
      claim: active,
      load: false,
      play: false,
      sameSource: target === active,
      idle: false,
    };
  }

  const sameSource = target === active;

  return {
    // Only when ownership moves do the other engines need stopping. Stopping
    // them unnecessarily is what made playback die during teardown races.
    stopSources: sameSource ? [] : all.filter((s) => s !== target),
    claim: target,
    // Always. This is the case that was being skipped.
    load: true,
    play: isPlaying,
    sameSource,
    idle: false,
  };
}