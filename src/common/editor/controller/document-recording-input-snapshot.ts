/* SPDX-License-Identifier: AGPL-3.0-only */

import type { SoundActivationPolicySnapshot } from './sound-activation-policy-service.ts';

export interface DocumentRecordingInputState {
	readonly recordingDevices: readonly unknown[];
	readonly recordingRouting: Readonly<{
		readonly routes: unknown;
		readonly offsets: unknown;
	}>;
	readonly recordingRouteHealth: Readonly<Record<string, unknown>>;
	readonly recordingPoolSources: readonly unknown[];
	readonly preferences: Readonly<{
		readonly recording: Readonly<{ readonly retainInputs: boolean }>;
	}>;
}

/** Build one immutable recording-input projection including per-source gate state. */
export function createDocumentRecordingInputSnapshot(
	state: DocumentRecordingInputState,
	soundActivation: SoundActivationPolicySnapshot,
) {
	return Object.freeze({
		devices: Object.freeze(state.recordingDevices),
		routes: state.recordingRouting.routes,
		offsets: state.recordingRouting.offsets,
		health: Object.freeze({ ...state.recordingRouteHealth }),
		sources: Object.freeze(state.recordingPoolSources),
		retainInputs: state.preferences.recording.retainInputs,
		hasOpenInputs: state.recordingPoolSources.length > 0,
		soundActivation,
	});
}
