/* SPDX-License-Identifier: AGPL-3.0-only */
import { normalizeMotionCompositionOffer, type MotionCompositionOffer } from './motion-link-protocol.ts';
import { freezeMotionValue, motionBoolean, motionRecord } from './motion-values.ts';

export interface MotionCompositionLinkState {
	readonly accepted: MotionCompositionOffer;
	readonly pending: MotionCompositionOffer | null;
	readonly paused: boolean;
}
const issued = new WeakSet<MotionCompositionLinkState>();
function issue(accepted: MotionCompositionOffer, pending: MotionCompositionOffer | null, paused: boolean): MotionCompositionLinkState {
	const state = freezeMotionValue({ accepted, pending, paused }); issued.add(state); return state;
}
function assertIssued(state: MotionCompositionLinkState): void {
	if (!issued.has(state)) throw new TypeError('Motion composition link state must be issued by its transition helpers.');
}
function assertIdentity(state: MotionCompositionLinkState, offer: MotionCompositionOffer): void {
	if (offer.revision.projectId !== state.accepted.revision.projectId || offer.compositionId !== state.accepted.compositionId) throw new RangeError('Motion composition update changes its external identity.');
	for (const known of [state.accepted, state.pending]) {
		if (known && known.revision.revision === offer.revision.revision && known.revision.digest !== offer.revision.digest) throw new RangeError('Motion composition revision number conflicts with its known digest.');
	}
}
function newest(state: MotionCompositionLinkState): MotionCompositionOffer {
	return state.pending && state.pending.revision.revision > state.accepted.revision.revision ? state.pending : state.accepted;
}
function compatible(first: MotionCompositionOffer, second: MotionCompositionOffer): boolean {
	return JSON.stringify(first.output) === JSON.stringify(second.output) && first.revision.project.sampleRate === second.revision.project.sampleRate;
}

/** Call only once the receiver durably owns this verified revision and its complete asset closure. */
export function createMotionCompositionLinkState(value: unknown): MotionCompositionLinkState {
	return issue(normalizeMotionCompositionOffer(value), null, false);
}

/** Persisted pause and pending intent retain their authority across offline reopen. */
export function normalizeMotionCompositionLinkState(value: unknown): MotionCompositionLinkState {
	const record = motionRecord(value, ['accepted', 'pending', 'paused'], 'motion composition link state');
	const state = issue(normalizeMotionCompositionOffer(record.accepted), null, motionBoolean(record.paused, 'link pause'));
	if (record.pending === null) return state;
	const pending = normalizeMotionCompositionOffer(record.pending); assertIdentity(state, pending);
	if (pending.revision.revision <= state.accepted.revision.revision) throw new RangeError('Motion pending revision must be newer than its accepted revision.');
	return issue(state.accepted, pending, state.paused);
}

/** Each accepted transition is one history action; pending deliveries do not replace render authority. */
export function receiveMotionCompositionUpdate(state: MotionCompositionLinkState, value: unknown): MotionCompositionLinkState {
	assertIssued(state); const offer = normalizeMotionCompositionOffer(value); assertIdentity(state, offer);
	if (offer.revision.revision <= newest(state).revision.revision) return state;
	if (!state.paused && compatible(state.accepted, offer)) return issue(offer, null, false);
	return issue(state.accepted, offer, state.paused);
}

/** Explicit output conform changes render authority while retaining an existing Undo pause. */
export function conformMotionCompositionLink(state: MotionCompositionLinkState): MotionCompositionLinkState {
	assertIssued(state); return state.pending ? issue(state.pending, null, state.paused) : state;
}

/** Resume accepts only a compatible pending output; incompatible output still requires Conform. */
export function resumeMotionCompositionLink(state: MotionCompositionLinkState): MotionCompositionLinkState {
	assertIssued(state);
	if (state.pending && compatible(state.accepted, state.pending)) return issue(state.pending, null, false);
	return state.paused ? issue(state.accepted, state.pending, false) : state;
}

/** History owns the restored closure. Retain the newest known offer without allowing Undo to be overwritten. */
export function restoreMotionCompositionLink(state: MotionCompositionLinkState, historicalValue: unknown): MotionCompositionLinkState {
	assertIssued(state); const offer = normalizeMotionCompositionOffer(historicalValue); assertIdentity(state, offer);
	const latest = newest(state);
	if (offer.revision.revision > latest.revision.revision) throw new RangeError('Motion composition history cannot restore an unknown future revision.');
	return issue(offer, latest.revision.revision > offer.revision.revision ? latest : null, true);
}
