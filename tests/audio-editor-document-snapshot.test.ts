import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createEditorDocumentSnapshot,
	type EditorDocumentSnapshotState,
	type SnapshotProject,
} from '../src/common/editor/controller/document-snapshot.ts';
import { createInitialStorageCapacitySnapshot } from '../src/common/editor/controller/storage-capacity-service.ts';

test('document snapshots expose durability, scheduling, history, and compatibility semantically', () => {
	const project: SnapshotProject = {
		id: 'project',
		selection: { startFrame: 10, endFrame: 20 },
	};
	const state = stateFixture({
		projects: [{ id: 'older' }, { id: 'project' }],
		recentProjectIds: ['project', 'missing'],
		timedRecording: { startTimeMs: 1_700_000_000_000, options: { trackId: 'track' } },
		recordingPreviews: [null, { frames: 4 }],
		history: { undoStack: ['old', 'new'], redoStack: ['redo'] },
		clipboard: { sourceIds: [] },
	});
	const snapshot = createEditorDocumentSnapshot({
		state,
		product: { id: 'soundscaper' },
		productId: 'soundscaper',
		capabilities: { recording: true },
		locale: 'en',
		getCurrentProject: () => project,
		getProjectTabs: () => [{
			projectId: 'project', title: 'Project', dirty: true, readOnly: false,
		}],
		getCurrentTabMetadata: () => ({
			aup4CompatibilityReport: { direction: 'import' },
			aup4CompatibilityReportDismissed: true,
			featureRequirementsReport: { compatible: false, items: [{ featureId: 'unknown' }] },
		}),
		recordingPreviewSnapshot: (preview) => preview,
		getAudioDevicesSnapshot: () => ({ inputSupported: true }),
		sampleEditingAvailable: () => true,
		canUndo: () => true,
		canRedo: () => true,
		historyEntrySummary: (entry) => `summary:${String(entry)}`,
		getStorageStatus: () => ({
			state: 'memory-ephemeral', backend: 'memory', persistent: false,
			ephemeral: true, degradedReason: 'indexeddb-unavailable',
		}),
		getRackEffectTypes: () => [{ type: 'gain' }],
		getVideoEffectTypes: () => [{ type: 'fade' }],
		getSelectionEffectTypes: () => [{ type: 'normalize' }],
		getSelectionEffectParams: () => ({ amount: 1 }),
		getSelectionEffectDefinition: () => ({ type: 'normalize' }),
		getEffectPresets: () => [{ id: 'preset' }],
	});

	assert.equal(snapshot.selection, project.selection);
	assert.deepEqual(snapshot.recentProjects, [{ id: 'project' }]);
	assert.deepEqual(snapshot.projectTabs, [{
		id: 'project', title: 'Project', dirty: true, readOnly: false,
	}]);
	assert.deepEqual(snapshot.scheduledRecording, {
		startTimeMs: 1_700_000_000_000,
		startTime: '2023-11-14T22:13:20.000Z',
		trackId: 'track',
	});
	assert.equal(snapshot.recording, false);
	assert.deepEqual(snapshot.recordingPreviews, [{ frames: 4 }]);
	assert.deepEqual(snapshot.history.undoEntries, ['summary:new', 'summary:old']);
	assert.equal(snapshot.storage.ephemeral, true);
	assert.deepEqual(snapshot.aup4Compatibility, {
		report: { direction: 'import' }, dismissed: true,
	});
	assert.deepEqual(snapshot.featureRequirementsCompatibility, {
		compatible: false, items: [{ featureId: 'unknown' }],
	});
	assert.equal(Object.isFrozen(snapshot), true);
	assert.equal(Object.isFrozen(snapshot.effects), true);
});

test('document snapshots hide collapsed selections and prepared recorders', () => {
	const state = stateFixture({
		recorder: { state: 'ready' },
		timedRecording: null,
		timedRecordingCancelling: true,
	});
	const snapshot = createEditorDocumentSnapshot({
		state,
		product: null,
		productId: 'soundscaper',
		capabilities: null,
		locale: 'de',
		getCurrentProject: () => ({
			id: 'project', selection: { startFrame: 12, endFrame: 12 },
		}),
		getProjectTabs: () => [],
		getCurrentTabMetadata: () => ({}),
		recordingPreviewSnapshot: () => null,
		getAudioDevicesSnapshot: () => ({}),
		sampleEditingAvailable: () => false,
		canUndo: () => false,
		canRedo: () => false,
		historyEntrySummary: (entry) => entry,
		getStorageStatus: () => ({
			state: 'indexeddb', backend: 'indexeddb', persistent: true,
			ephemeral: false, degradedReason: null,
		}),
		getRackEffectTypes: () => [],
		getVideoEffectTypes: () => [],
		getSelectionEffectTypes: () => [],
		getSelectionEffectParams: () => ({}),
		getSelectionEffectDefinition: () => null,
		getEffectPresets: () => [],
	});

	assert.equal(snapshot.selection, null);
	assert.equal(snapshot.recording, false);
	assert.equal(snapshot.locale, 'de');
});

function stateFixture(
	overrides: Partial<EditorDocumentSnapshotState> = {},
): EditorDocumentSnapshotState {
	return {
		phase: 'ready', projects: [], recentProjectIds: [],
		preferences: { playback: { playAtSpeedMode: 'naive' }, recording: { retainInputs: false } },
		preferencesReadOnly: false, selectedTrackId: null, selectedClipId: null,
		transportState: 'stopped', projectBinPreview: null, playAtSpeedRate: 1,
		playAtSpeedAbort: null, readOnly: false, projectLock: null, importing: false,
		recordingStarting: false, timedRecordingPreparing: false, timedRecording: null,
		timedRecordingCancelling: false, recorder: null, recordingPreview: null,
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
		effectPresets: {}, nyquistAbort: null, nyquistResult: null, monitoring: false,
		microphoneMetering: false, latencyOffsetMs: 0, recordingPaused: false,
		leadInRecording: false, metronomeEnabled: false, recordingInputGain: 1,
		selectionFollowsLoop: false, missingSourceIds: new Set(), disposed: false,
		...overrides,
	};
}
