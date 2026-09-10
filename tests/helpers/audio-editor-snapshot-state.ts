/* SPDX-License-Identifier: AGPL-3.0-only */

import type { EditorDocumentSnapshotState } from '../../src/common/editor/controller/document/document-snapshot.ts';
import { createInitialStorageCapacitySnapshot } from '../../src/common/editor/controller/shared/storage-capacity-service.ts';

export function stateFixture(
	overrides: Partial<EditorDocumentSnapshotState> = {},
): EditorDocumentSnapshotState {
	return {
		phase: 'ready', projects: [], recentProjectIds: [],
		preferences: { playback: { playAtSpeedMode: 'naive' }, recording: { retainInputs: false } },
		preferencesReadOnly: false, selectedTrackId: null, selectedClipId: null,
		selectedAnnotationId: null,
		transportState: 'stopped', projectBinPreview: null, playAtSpeedRate: 1,
		playAtSpeedAbort: null, readOnly: false, projectLock: null, importing: false,
		recordingStarting: false, timedRecordingPreparing: false, timedRecording: null,
		timedRecordingCancelling: false, recorder: null, recordingPreview: null,
		recordingKind: null, takeCycleRecovery: null,
		recordingPreviews: [], recordingDevices: [],
		recordingRouting: { routes: {}, offsets: {} }, recordingRouteHealth: {},
		recordingPoolSources: [], audacityEffectProcessing: false, exportAbort: null,
		timelineView: 'waveform', showRms: false, showVerticalRulers: true,
		updateDisplayWhilePlaying: true, pinnedPlayhead: false, playbackOnRulerClick: true,
		pixelsPerSecond: 120, timelineWidth: 1_200, autoFitTrackHeight: true,
		sampleEditMode: null, sampleEditProcessing: false, history: null, clipboard: null,
		status: { message: 'Ready', state: 'info' }, saveState: 'saved',
		storageEstimate: createInitialStorageCapacitySnapshot(), analysisResult: null,
		analysisVisuals: null, analysisReport: null, analysisProcessing: false,
		exportProgress: 0, exportOutput: null, effectClipboard: null,
		audacityEffectType: 'normalize', audacityControlTrackId: null,
		audacityNoiseProfile: null, lastAudacityEffect: null, audacityPreviewSource: null,
		effectPresets: {}, effectMacros: { schemaVersion: 1, macros: [] },
		nyquistAbort: null, nyquistResult: null, monitoring: false,
		microphoneMetering: false, latencyOffsetMs: 0, recordingPaused: false,
		leadInRecording: false, metronomeEnabled: false, recordingInputGain: 1,
		selectionFollowsLoop: false, missingSourceIds: new Set(), disposed: false,
		...overrides,
	};
}
