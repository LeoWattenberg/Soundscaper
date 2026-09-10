/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizeRecordingRouting } from '../recording-routing.js';
import type { ControllerRuntimeHistory, ControllerRuntimeProject } from './project-runtime.ts';
import {
	createControllerRecordingState,
	type ControllerRecordingRouting,
	type ControllerRecordingState,
} from './recording-state.ts';
import { createControllerTransportState } from './transport-state.ts';
import { createOwnedStateAccess } from './owned-state.ts';
import {
	createEditorControllerState,
	type EditorControllerStateOptions,
} from './state.ts';
import type { TrackAudioRecordingStatePort } from './track-audio-composition-types.ts';

export type ControllerOwnedStateCompositionOptions<Preferences, EffectPresets,
	Project = ControllerRuntimeProject,
	History extends { readonly present: Project } = ControllerRuntimeHistory & { readonly present: Project },
> = Omit<EditorControllerStateOptions<Preferences, ControllerRecordingRouting, EffectPresets, Project, History>,
	'recording' | 'recordingRouting' | 'transport'
>;

type RecordingRoutingOwner = Pick<ControllerRecordingState<ControllerRecordingRouting>,
	| 'preferredInputChannelCount' | 'preferredInputDeviceId' | 'recordingDevices'
	| 'recordingPoolSources' | 'recordingRouteHealth' | 'recordingRouting'
>;

/** Build the controller's explicit state owners and their narrowly writable views. */
export function createControllerOwnedStateComposition<Preferences, EffectPresets,
	Project = ControllerRuntimeProject,
	History extends { readonly present: Project } = ControllerRuntimeHistory & { readonly present: Project },
>(options: ControllerOwnedStateCompositionOptions<Preferences, EffectPresets, Project, History>) {
	const recordingRouting = normalizeRecordingRouting();
	const recordingState = createControllerRecordingState({
		recordingRouting,
		recordingInputGain: options.recordingInputGain,
		preferredInputDeviceId: options.preferredInputDeviceId,
	});
	const transportState = createControllerTransportState();
	const state = createEditorControllerState({
		...options,
		recordingRouting,
		recording: recordingState,
		transport: transportState,
	});
	return Object.freeze({
		state,
		recordingAccess: createOwnedStateAccess(state, recordingState),
		transportAccess: createOwnedStateAccess(state, transportState),
		recordingPort: createTrackAudioRecordingStatePort(recordingState),
		reconcileRecordingRouting: (tracks: NonNullable<Parameters<typeof normalizeRecordingRouting>[1]>) => (
			reconcileControllerRecordingRouting(recordingState, tracks)
		),
	});
}

/** Expose the recording fields needed by track operations as methods on the owner. */
export function createTrackAudioRecordingStatePort(
	state: RecordingRoutingOwner,
): TrackAudioRecordingStatePort {
	return Object.freeze({
		getRouting: () => state.recordingRouting,
		setRouting: (routing) => { state.recordingRouting = routing; },
		getPreferredDeviceId: () => state.preferredInputDeviceId,
		getPreferredChannelCount: () => state.preferredInputChannelCount,
		getDevices: () => state.recordingDevices,
		getPoolSources: () => state.recordingPoolSources,
		setRouteHealth: (trackId, health) => { state.recordingRouteHealth[trackId] = health; },
	});
}

/** Reconcile document changes into the recording owner and prune stale health rows. */
export function reconcileControllerRecordingRouting(
	state: Pick<RecordingRoutingOwner, 'recordingRouteHealth' | 'recordingRouting'>,
	tracks: NonNullable<Parameters<typeof normalizeRecordingRouting>[1]>,
): boolean {
	const normalized = normalizeRecordingRouting(state.recordingRouting, tracks);
	if (JSON.stringify(normalized) === JSON.stringify(state.recordingRouting)) return false;
	state.recordingRouting = normalized;
	for (const trackId of Object.keys(state.recordingRouteHealth)) {
		if (!normalized.routes[trackId]) delete state.recordingRouteHealth[trackId];
	}
	return true;
}
