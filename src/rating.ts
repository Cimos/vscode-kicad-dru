/**
 * PURE decision logic for the one-off "enjoying this extension? rate it"
 * toast. No dependency on `vscode`; exercised by `node --test` via
 * `dist/rating.mjs`. The adapter in `src/extension.ts` persists
 * {@link RatingState} in `context.globalState` and shows the toast.
 *
 * Policy (deliberately quiet — the toast must never feel like nagging):
 *  - count one "activation" per VS Code window in which a `.kicad_dru` file
 *    was opened (that is what `onLanguage:kicad-dru` activation measures);
 *  - prompt only after {@link MIN_ACTIVATIONS} activations AND at least
 *    {@link MIN_AGE_MS} since the first one, so a one-day trial never sees it;
 *  - "Later" snoozes for {@link SNOOZE_MS}; "Don't ask again" and "Rate" both
 *    end it for good.
 */

export const REVIEW_URL =
  'https://marketplace.visualstudio.com/items?itemName=cimos.kicad-dru&ssr=false#review-details';

export const MIN_ACTIVATIONS = 5;
export const MIN_AGE_MS = 3 * 24 * 60 * 60 * 1000; // 3 days
export const SNOOZE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export interface RatingState {
  /** Number of extension activations seen so far. */
  activations: number;
  /** Epoch ms of the first activation. */
  firstSeen: number;
  /** Epoch ms before which the prompt is suppressed ("Later"). */
  snoozedUntil?: number;
  /** Set once the user rated or opted out; the prompt never returns. */
  done?: boolean;
}

export type RatingChoice = 'rate' | 'later' | 'never';

/** Fold one activation into the stored state (creating it on first run). */
export function recordActivation(state: RatingState | undefined, now: number): RatingState {
  if (!state) return { activations: 1, firstSeen: now };
  return { ...state, activations: state.activations + 1 };
}

/** True when the quiet-period thresholds are met and the user hasn't opted out. */
export function shouldPrompt(state: RatingState, now: number): boolean {
  if (state.done) return false;
  if (state.snoozedUntil !== undefined && now < state.snoozedUntil) return false;
  if (state.activations < MIN_ACTIVATIONS) return false;
  return now - state.firstSeen >= MIN_AGE_MS;
}

/** Next state after the user picked a toast button (or dismissed it). */
export function applyChoice(state: RatingState, choice: RatingChoice | undefined, now: number): RatingState {
  switch (choice) {
    case 'rate':
    case 'never':
      return { ...state, done: true, snoozedUntil: undefined };
    case 'later':
    default:
      // Dismissing the toast (Esc / timeout) counts as "later": one snooze,
      // never a re-prompt in the same session.
      return { ...state, snoozedUntil: now + SNOOZE_MS };
  }
}
