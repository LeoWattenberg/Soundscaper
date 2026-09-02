/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AutomationWriteModeV21 } from './automation-write-mode-v21.ts';

export const TRACK_AUTOMATION_MODES = Object.freeze([
	'read', 'trim', 'touch', 'latch', 'write',
] as const satisfies readonly AutomationWriteModeV21[]);

export type TrackAutomationMode = typeof TRACK_AUTOMATION_MODES[number];

export interface TrackAutomationRuntimeSnapshot {
	readonly mode: TrackAutomationMode;
	readonly laneId: string | null;
	readonly gestureActive: boolean;
}

/**
 * Product-neutral live automation port shared by timeline, mixer, and effect
 * controls. The owning workspace keeps the snapshot reactive and owns tokens.
 */
export interface TrackAutomationRuntime {
	readonly snapshot: TrackAutomationRuntimeSnapshot;
	setMode(mode: TrackAutomationMode, laneId: string | null): unknown;
	beginGesture?(laneId: string, controlValue: number): unknown;
	previewGesture?(token: unknown, controlValue: number): unknown;
	releaseGesture?(token: unknown, controlValue?: number): unknown;
	cancelGesture?(token?: unknown): unknown;
}

export function normalizeTrackAutomationMode(value: unknown): TrackAutomationMode {
	return TRACK_AUTOMATION_MODES.includes(value as TrackAutomationMode)
		? value as TrackAutomationMode
		: 'read';
}

export function trackAutomationModeForLane(
	runtime: Readonly<TrackAutomationRuntime> | null | undefined,
	laneId: string | null | undefined,
): TrackAutomationMode {
	if (!laneId || runtime?.snapshot.laneId !== laneId) return 'read';
	return normalizeTrackAutomationMode(runtime.snapshot.mode);
}
