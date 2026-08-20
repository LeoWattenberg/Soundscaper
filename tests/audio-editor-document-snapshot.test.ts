import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createEditorDocumentSnapshot,
	type EditorDocumentSnapshotState,
	type SnapshotProject,
} from '../src/common/editor/controller/document-snapshot.ts';
import { createInitialStorageCapacitySnapshot } from '../src/common/editor/controller/storage-capacity-service.ts';
import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';
import { DEFAULT_SOUND_ACTIVATION_PREFERENCES } from '../src/common/editor/sound-activation-preferences.ts';

const SOUND_ACTIVATION_SNAPSHOT = Object.freeze({
	preferences: DEFAULT_SOUND_ACTIVATION_PREFERENCES,
	preferenceMutationBlocked: false,
	preferenceMutationBlockReason: null,
	sources: Object.freeze([]),
});
const CAPTURE_SNAPSHOT = Object.freeze({
	phase: 'recording' as const,
	availability: Object.freeze({ status: 'available' as const, sourceRoles: Object.freeze(['microphone'] as const) }),
	requestedRoles: Object.freeze(['microphone'] as const), sources: Object.freeze([]), sourcesFrozen: true,
	destination: 'both' as const, countdownMs: 0, permissionRequestGeneration: 1, failure: null,
	devices: Object.freeze([]), selectedDeviceIds: Object.freeze({}), displaySelectionMode: null,
	displaySources: Object.freeze([]), selectedDisplaySourceToken: null,
	monitoring: false, inputGain: 1, elapsedTimeMs: 1_250, metrics: Object.freeze([]),
});

test('document snapshots expose durability, scheduling, history, and compatibility semantically', () => {
	const project: SnapshotProject = {
		id: 'project',
		selection: { startFrame: 10, endFrame: 20 },
	};
	const videoPreviewProject = Object.freeze({ ...project, transientVideoFallback: true });
	const state = stateFixture({
		projects: [{ id: 'older' }, { id: 'project' }],
		recentProjectIds: ['project', 'missing'],
		selectedAnnotationId: 'annotation',
		timedRecording: { startTimeMs: 1_700_000_000_000, options: { trackId: 'track' } },
		recordingPreviews: [null, { frames: 4 }],
		history: { undoStack: ['old', 'new'], redoStack: ['redo'] },
		clipboard: { sourceIds: [] },
		recordingKind: 'take-cycle',
		archiveManifest: { manifest: { members: [{ id: 'project.json' }] }, unavailable: null },
		takeCycleRecovery: Object.freeze({
			kind: 'take-cycle-pending-open-recovery', projectId: 'project',
			publicationGeneration: 4, recoveryToken: 'recover-4', draftCount: 2,
			requiresDecision: true,
		}),
	});
	const snapshot = createEditorDocumentSnapshot({
		state,
		product: { id: 'soundscaper' },
		productId: 'soundscaper',
		capabilities: { recording: true },
		locale: 'en',
		getCurrentProject: () => project,
		projectForPlayback: () => videoPreviewProject,
		getProjectTabs: () => [{
			projectId: 'project', title: 'Project', dirty: true, readOnly: false,
		}],
		getCurrentTabMetadata: () => ({
			aup4CompatibilityReport: { direction: 'import' },
			aup4CompatibilityReportDismissed: true,
			featureRequirementsReport: { compatible: false, items: [{ featureId: 'unknown' }] },
			featureRequirementsAudioEffectPlaybackBypass: {
				schemaVersion: 1,
				placeholders: [{ scope: 'track', ownerId: 'track', effectId: 'effect', effectType: 'compressor' }],
			},
			featureRequirementsAudioRenderedFallback: {
				schemaVersion: 1,
				featureId: 'org.soundscaper.capability.audio-effects',
				requirementId: 'audio-effects',
				sourceId: 'rendered-source',
				trackId: 'soundscaper:rendered-audio-fallback:track',
				clipId: 'soundscaper:rendered-audio-fallback:clip',
			},
			featureRequirementsVideoEffectPlaybackBypass: {
				schemaVersion: 1,
				placeholders: [{
					location: 'timeline', clipId: 'clip', effectId: 'video-effect', effectType: 'pixelate',
				}],
			},
			featureRequirementsVideoRenderedFallback: {
				schemaVersion: 1,
				featureId: 'org.soundscaper.capability.video-effects',
				requirementId: 'video-effects',
				sourceId: 'rendered-video',
				trackId: 'framescaper:rendered-video-fallback:track',
				clipId: 'framescaper:rendered-video-fallback:clip',
			},
		}),
		recordingPreviewSnapshot: (preview) => preview,
		getAudioDevicesSnapshot: () => ({ inputSupported: true }),
		getSoundActivationSnapshot: () => SOUND_ACTIVATION_SNAPSHOT,
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
		getVideoNavigationSnapshot: () => Object.freeze({ rate: 2, positionFrame: 960 }),
		getFramescaperCaptureSnapshot: () => CAPTURE_SNAPSHOT,
		getSelectionEffectTypes: () => [{ type: 'normalize' }],
		getSelectionEffectParams: () => ({ amount: 1 }),
		getSelectionEffectDefinition: () => ({ type: 'normalize' }),
		getEffectPresets: () => [{ id: 'preset' }],
	});

	assert.equal(snapshot.selection, project.selection);
	assert.equal(snapshot.selectedAnnotationId, 'annotation');
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
	assert.equal(snapshot.recordingKind, 'take-cycle');
	assert.strictEqual(snapshot.takeCycleRecovery, state.takeCycleRecovery);
	assert.equal(Object.isFrozen(snapshot.takeCycleRecovery), true);
	assert.strictEqual(snapshot.recordingInputs.soundActivation, SOUND_ACTIVATION_SNAPSHOT);
	assert.deepEqual(snapshot.recordingPreviews, [{ frames: 4 }]);
	assert.deepEqual(snapshot.history.undoEntries, ['summary:new', 'summary:old']);
	assert.equal(snapshot.storage.ephemeral, true);
	// The File entry that saves the archive's checksums is enabled from this, so a
	// manifest that never reached the snapshot left that entry disabled for the
	// whole session with no reason shown.
	assert.deepEqual(snapshot.archiveManifest, {
		manifest: { members: [{ id: 'project.json' }] }, unavailable: null,
	});
	assert.deepEqual(snapshot.aup4Compatibility, {
		report: { direction: 'import' }, dismissed: true,
	});
	assert.deepEqual(snapshot.featureRequirementsCompatibility, {
		compatible: false, items: [{ featureId: 'unknown' }],
	});
	assert.deepEqual(snapshot.audioEffectPlaybackBypass, {
		schemaVersion: 1,
		placeholders: [{ scope: 'track', ownerId: 'track', effectId: 'effect', effectType: 'compressor' }],
	});
	assert.deepEqual(snapshot.audioRenderedFallback, {
		schemaVersion: 1,
		featureId: 'org.soundscaper.capability.audio-effects',
		requirementId: 'audio-effects',
		sourceId: 'rendered-source',
		trackId: 'soundscaper:rendered-audio-fallback:track',
		clipId: 'soundscaper:rendered-audio-fallback:clip',
	});
	assert.deepEqual(snapshot.videoEffectPlaybackBypass, {
		schemaVersion: 1,
		placeholders: [{
			location: 'timeline', clipId: 'clip', effectId: 'video-effect', effectType: 'pixelate',
		}],
	});
	assert.deepEqual(snapshot.videoRenderedFallback, {
		schemaVersion: 1,
		featureId: 'org.soundscaper.capability.video-effects',
		requirementId: 'video-effects',
		sourceId: 'rendered-video',
		trackId: 'framescaper:rendered-video-fallback:track',
		clipId: 'framescaper:rendered-video-fallback:clip',
	});
	assert.strictEqual(snapshot.videoPreviewProject, videoPreviewProject);
	assert.deepEqual(snapshot.videoNavigation, { rate: 2, positionFrame: 960 });
	assert.strictEqual(snapshot.capture, CAPTURE_SNAPSHOT);
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
		projectForPlayback: (candidate) => candidate,
		getProjectTabs: () => [],
		getCurrentTabMetadata: () => ({}),
		recordingPreviewSnapshot: () => null,
		getAudioDevicesSnapshot: () => ({}),
		getSoundActivationSnapshot: () => SOUND_ACTIVATION_SNAPSHOT,
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
	assert.equal(snapshot.audioRenderedFallback, null);
	assert.equal(snapshot.videoRenderedFallback, null);
	assert.equal(snapshot.videoNavigation, null);
	assert.equal(snapshot.capture, null);
	assert.strictEqual(snapshot.videoPreviewProject, snapshot.project);
	assert.equal(snapshot.recording, false);
	assert.equal(snapshot.locale, 'de');
});

test('document snapshots expose one sorted immutable runtime annotation view', () => {
	const project = createCurrentAudioEditorProject({
		id: 'annotation-project',
		now: 1_700_000_000_000,
		timelineAnnotations: [
			{
				id: 'later', sequenceId: 'main-sequence', name: 'Later', color: 'blue', batchId: null,
				opaqueExtensions: {}, kind: 'marker', anchor: 'sample', positionFrame: 48_000,
			},
			{
				id: 'first', sequenceId: 'main-sequence', name: 'First', color: 'red', batchId: null,
				opaqueExtensions: {}, kind: 'region', anchor: 'musical',
				startBeat: { num: 1, den: 1 }, endBeat: { num: 2, den: 1 },
			},
		],
	});
	const snapshot = createEditorDocumentSnapshot(documentRuntimeFixture(project as unknown as SnapshotProject));

	assert.deepEqual(snapshot.timelineAnnotations.map(({ id }) => id), ['first', 'later']);
	assert.equal(snapshot.timelineAnnotations[0]?.coordinateDomain, 'resolved-samples');
	assert.equal(Object.isFrozen(snapshot.timelineAnnotations), true);
	assert.equal(Object.isFrozen(snapshot.timelineAnnotations[0]), true);
	assert.notStrictEqual(snapshot.timelineAnnotations, project.timelineAnnotations);
});

function documentRuntimeFixture(project: SnapshotProject) {
	return {
		state: stateFixture(), product: null, productId: 'soundscaper', capabilities: {}, locale: 'en',
		getCurrentProject: () => project, projectForPlayback: () => project,
		getProjectTabs: () => [], getCurrentTabMetadata: () => ({}),
		recordingPreviewSnapshot: () => null, getAudioDevicesSnapshot: () => ({}),
		getSoundActivationSnapshot: () => SOUND_ACTIVATION_SNAPSHOT,
		sampleEditingAvailable: () => false, canUndo: () => false, canRedo: () => false,
		historyEntrySummary: (entry: unknown) => entry,
		getStorageStatus: () => ({
			state: 'indexeddb' as const, backend: 'indexeddb' as const, persistent: true,
			ephemeral: false, degradedReason: null,
		}),
		getRackEffectTypes: () => [], getVideoEffectTypes: () => [],
		getSelectionEffectTypes: () => [], getSelectionEffectParams: () => ({}),
		getSelectionEffectDefinition: () => null, getEffectPresets: () => [],
	};
}

function stateFixture(
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
		effectPresets: {}, nyquistAbort: null, nyquistResult: null, monitoring: false,
		microphoneMetering: false, latencyOffsetMs: 0, recordingPaused: false,
		leadInRecording: false, metronomeEnabled: false, recordingInputGain: 1,
		selectionFollowsLoop: false, missingSourceIds: new Set(), disposed: false,
		...overrides,
	};
}

test('the delivery canvas an open export dialog states rides the snapshot to the preview', () => {
	const project: SnapshotProject = { id: 'project', selection: { startFrame: 0, endFrame: 0 } };
	const canvas = { size: { width: 1_080, height: 1_920 }, fit: 'cover' };

	// A delivery that reframes to 9:16 was never previewed at 9:16, because the
	// panel resolves the project's derived canvas and nothing told it otherwise.
	const snapshot = (state: EditorDocumentSnapshotState) => createEditorDocumentSnapshot({
		state,
		product: null,
		productId: 'soundscaper',
		capabilities: null,
		locale: 'en',
		getCurrentProject: () => project,
		projectForPlayback: (candidate) => candidate,
		getProjectTabs: () => [],
		getCurrentTabMetadata: () => ({}),
		recordingPreviewSnapshot: () => null,
		getAudioDevicesSnapshot: () => ({}),
		getSoundActivationSnapshot: () => SOUND_ACTIVATION_SNAPSHOT,
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

	assert.equal(snapshot(stateFixture()).videoDeliveryPreviewCanvas, null);
	assert.deepEqual(
		snapshot(stateFixture({ videoDeliveryPreviewCanvas: canvas } as Partial<EditorDocumentSnapshotState>))
			.videoDeliveryPreviewCanvas,
		canvas,
	);
});
