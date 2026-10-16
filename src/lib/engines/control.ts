/**
 * Bridge between the UI and whichever engine is currently active.
 *
 * The engines live inside <PlayerHost> and are deliberately not exposed through
 * the store (they hold iframes and DOM nodes, which have no business in
 * serialisable state). The UI therefore registers a tiny imperative surface
 * here instead, keeping seek reachable without threading engine refs through
 * context.
 */
export interface EngineControl {
  seek(fraction: number): void;
}

let active: EngineControl | null = null;

export function registerEngineControl(control: EngineControl | null): void {
  active = control;
}

export function seekTo(fraction: number): void {
  active?.seek(fraction);
}