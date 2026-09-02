/* SPDX-License-Identifier: AGPL-3.0-only */

export interface TrackAutomationControlTargetIdentity {
	readonly key: string;
	readonly disabledReason: string | null;
	readonly lane?: Readonly<{ readonly id: string }> | null;
}

export type TrackAutomationControlsState = Readonly<Record<string, string>>;

export function createTrackAutomationControlsState(): TrackAutomationControlsState {
	return Object.freeze({});
}

export function toggleTrackAutomationControls(
	state: TrackAutomationControlsState,
	trackId: string,
	targets: readonly TrackAutomationControlTargetIdentity[],
): TrackAutomationControlsState {
	if (Object.hasOwn(state, trackId)) {
		return frozenEntries(Object.entries(state).filter(([candidate]) => candidate !== trackId));
	}
	const target = firstAvailableTarget(targets);
	if (!target) return state;
	return Object.freeze({ ...state, [trackId]: target.key });
}

export function selectTrackAutomationTarget(
	state: TrackAutomationControlsState,
	trackId: string,
	targetKey: string,
	targets: readonly TrackAutomationControlTargetIdentity[],
): TrackAutomationControlsState {
	const target = targets.find(({ key }) => key === targetKey);
	if (!target || target.disabledReason) {
		throw new RangeError('The requested automation target is not available.');
	}
	if (state[trackId] === target.key) return state;
	return Object.freeze({ ...state, [trackId]: target.key });
}

export function reconcileTrackAutomationControlsState(
	state: TrackAutomationControlsState,
	targetsByTrackId: ReadonlyMap<string, readonly TrackAutomationControlTargetIdentity[]>,
): TrackAutomationControlsState {
	const entries: [string, string][] = [];
	for (const [trackId, selectedKey] of Object.entries(state)) {
		const targets = targetsByTrackId.get(trackId);
		if (!targets) continue;
		const selected = targets.find(({ key, disabledReason }) => (
			key === selectedKey && !disabledReason
		));
		const target = selected ?? firstAvailableTarget(targets);
		if (target) entries.push([trackId, target.key]);
	}
	const reconciled = frozenEntries(entries);
	return sameState(state, reconciled) ? state : reconciled;
}

/** Whether a live lane remains the selected target on any visible track. */
export function trackAutomationSelectionContainsLane(
	state: TrackAutomationControlsState,
	targetsByTrackId: ReadonlyMap<string, readonly TrackAutomationControlTargetIdentity[]>,
	laneId: string | null | undefined,
): boolean {
	if (!laneId) return false;
	return Object.entries(state).some(([trackId, targetKey]) => (
		targetsByTrackId.get(trackId)?.some((target) => (
			target.key === targetKey && !target.disabledReason && target.lane?.id === laneId
		)) === true
	));
}

function firstAvailableTarget(
	targets: readonly TrackAutomationControlTargetIdentity[],
): TrackAutomationControlTargetIdentity | null {
	return targets.find(({ disabledReason }) => !disabledReason) ?? null;
}

function frozenEntries(entries: readonly (readonly [string, string])[]): TrackAutomationControlsState {
	return Object.freeze(Object.fromEntries(entries));
}

function sameState(left: TrackAutomationControlsState, right: TrackAutomationControlsState): boolean {
	const leftEntries = Object.entries(left);
	const rightEntries = Object.entries(right);
	return leftEntries.length === rightEntries.length
		&& leftEntries.every(([key, value]) => right[key] === value);
}
