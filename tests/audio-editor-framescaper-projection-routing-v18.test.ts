/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createEditorDocumentSnapshot,
	type EditorDocumentSnapshotState,
	type SnapshotProject,
} from '../src/common/editor/controller/document-snapshot.ts';
import {
	createInitialStorageCapacitySnapshot,
} from '../src/common/editor/controller/storage-capacity-service.ts';
import {
	createVideoSource,
	createVideoTrack,
} from '../src/common/editor/project-media-factory.ts';
import { DEFAULT_SOUND_ACTIVATION_PREFERENCES } from '../src/common/editor/sound-activation-preferences.ts';
import {
	createFramescaperPlaybackProjectServiceV18,
} from '../src/framescaper/editor-project-playback-v18.ts';
import {
	FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE,
} from '../src/framescaper/editor-project-runtime-profile-v18.ts';
import {
	applyFramescaperProjectCommandV18,
} from '../src/framescaper/editor-project-v18-commands.ts';
import {
	framescaperProjectForAuthoredFoundationV18,
	framescaperProjectForPlaybackFoundationV18,
	framescaperProjectForRuntimeConsumersV18,
} from '../src/framescaper/editor-project-v18-runtime.ts';
import {
	createFramescaperProjectV18,
	type FramescaperProjectV18,
} from '../src/framescaper/editor-project-v18.ts';

const PROFILE = FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE;
const NOW = '2026-08-13T15:00:00.000Z';
const SOURCE_A_SHA = '12'.repeat(32);
const SOURCE_B_SHA = '34'.repeat(32);
const SOUND_ACTIVATION_SNAPSHOT = Object.freeze({
	preferences: DEFAULT_SOUND_ACTIVATION_PREFERENCES,
	preferenceMutationBlocked: false,
	preferenceMutationBlockReason: null,
	sources: Object.freeze([]),
});

test('runtime consumers keep every authored clip, track, and selection identity beside a subsequence', () => {
	const project = nestedProject();
	const runtime = framescaperProjectForRuntimeConsumersV18(PROFILE, project);

	assert.deepEqual([...runtime.clips].map(({ id }) => id).sort(), ['child-clip', 'primary-clip']);
	assert.deepEqual(
		[...runtime.tracks].map((track) => track.id).sort(),
		['child-track', 'primary-track'],
	);
	assert.deepEqual((runtime.selection as Readonly<Record<string, unknown>>).clipIds, ['primary-clip']);
	assert.deepEqual((runtime.selection as Readonly<Record<string, unknown>>).trackIds, ['primary-track']);
	assert.equal(runtime.schemaVersion, 17);
	assert.equal(Object.hasOwn(runtime, 'subsequences'), false);
	assert.equal(Object.hasOwn(runtime, 'multicameraGroups'), false);
});

test('the authored foundation substitutes the active multicamera angle without re-identifying clips', () => {
	const project = switchedMulticameraProject();
	const foundation = framescaperProjectForAuthoredFoundationV18(PROFILE, project);
	const output = foundation.clips?.find((clip) => clip.id === 'output-clip');

	assert.equal(output?.sourceId, 'source-b');
	assert.equal(output?.sourceInFrame, 3);
	assert.equal(project.clips[0]?.sourceId, 'source-a');
});

test('the playback foundation still flattens nested sequences onto the primary grid', () => {
	const foundation = framescaperProjectForPlaybackFoundationV18(PROFILE, nestedProject());

	assert.equal(foundation.clips?.length, 2);
	assert.ok(foundation.clips?.every(({ id }) => String(id).startsWith('framescaper-v18-flat-clip-')));
});

test('the published video preview project follows the switched multicamera angle', () => {
	const project = switchedMulticameraProject();
	const playback = createFramescaperPlaybackProjectServiceV18(PROFILE);
	const snapshot = createEditorDocumentSnapshot(snapshotRuntime(
		project as unknown as SnapshotProject,
		(candidate) => playback.projectForPlayback(candidate).project,
	));
	const preview = snapshot.videoPreviewProject as unknown as FramescaperProjectV18;

	assert.notStrictEqual(preview, snapshot.project);
	assert.deepEqual(preview.clips.map(({ sourceId }) => sourceId), ['source-b']);
});

test('the video preview projection is resolved once per canonical document', () => {
	const project = switchedMulticameraProject();
	const playback = createFramescaperPlaybackProjectServiceV18(PROFILE);
	let projections = 0;
	const runtime = snapshotRuntime(project as unknown as SnapshotProject, (candidate) => {
		projections += 1;
		return playback.projectForPlayback(candidate).project;
	});

	const first = createEditorDocumentSnapshot(runtime).videoPreviewProject;
	assert.strictEqual(createEditorDocumentSnapshot(runtime).videoPreviewProject, first);
	assert.equal(projections, 1);
});

test('a video preview projection failure leaves the canonical document published', () => {
	const project = switchedMulticameraProject();
	const snapshot = createEditorDocumentSnapshot(snapshotRuntime(
		project as unknown as SnapshotProject,
		() => { throw new RangeError('not an exact active-source boundary'); },
	));

	assert.strictEqual(snapshot.videoPreviewProject, snapshot.project);
});

function snapshotRuntime(
	project: SnapshotProject,
	projectForPlayback: (candidate: SnapshotProject) => SnapshotProject,
) {
	return {
		state: stateFixture(), product: null, productId: 'framescaper', capabilities: {}, locale: 'en',
		getCurrentProject: () => project, projectForPlayback,
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

function nestedProject(): FramescaperProjectV18 {
	const rate = { num: 30, den: 1 };
	return createFramescaperProjectV18(PROFILE, {
		id: 'projection-routing-nested', title: 'Projection routing nested', now: NOW,
		sources: [videoSource('source-a', SOURCE_A_SHA, rate, 200)],
		clips: [
			{
				kind: 'video', id: 'primary-clip', sourceId: 'source-a', title: 'Primary clip',
				sequenceId: 'root', sequenceStartFrame: 0, sequenceFrameCount: 10,
				sourceInFrame: 0, sourceFrameCount: 10, retimeMap: null,
			},
			{
				kind: 'video', id: 'child-clip', sourceId: 'source-a', title: 'Child clip',
				sequenceId: 'child', sequenceStartFrame: 0, sequenceFrameCount: 12,
				sourceInFrame: 10, sourceFrameCount: 12, retimeMap: null,
			},
		],
		tracks: [
			createVideoTrack({ id: 'primary-track', name: 'Primary', clipIds: ['primary-clip'], locked: false }),
			createVideoTrack({ id: 'child-track', name: 'Child', clipIds: ['child-clip'], locked: false }),
		],
		sequences: [
			{ id: 'root', rate, trackIds: ['primary-track'] },
			{ id: 'child', rate, trackIds: ['child-track'] },
		],
		primarySequenceId: 'root',
		subsequences: [{
			id: 'child-a', sequenceId: 'root', sourceSequenceId: 'child',
			sequenceStartFrame: 30, sequenceFrameCount: 12, sourceInFrame: 0, sourceFrameCount: 12,
		}],
		selection: {
			startFrame: 0, endFrame: 0, clipIds: ['primary-clip'], trackIds: ['primary-track'],
		},
	});
}

function switchedMulticameraProject(): FramescaperProjectV18 {
	const rate = { num: 24, den: 1 };
	const project = createFramescaperProjectV18(PROFILE, {
		id: 'projection-routing-multicamera', title: 'Projection routing multicamera', now: NOW,
		sampleRate: 48_000,
		sources: [
			videoSource('source-a', SOURCE_A_SHA, rate, 24),
			videoSource('source-b', SOURCE_B_SHA, rate, 24),
		],
		clips: [{
			kind: 'video', id: 'output-clip', sourceId: 'source-a', title: 'Multicamera output',
			sequenceId: 'main-sequence', sequenceStartFrame: 10, sequenceFrameCount: 3,
			sourceInFrame: 2, sourceFrameCount: 3, retimeMap: null,
		}],
		tracks: [createVideoTrack({
			id: 'video-track', name: 'Video', clipIds: ['output-clip'], locked: false,
		})],
		sequences: [{ id: 'main-sequence', rate, trackIds: ['video-track'] }],
		primarySequenceId: 'main-sequence',
		multicameraGroups: [{
			id: 'group-a', projectId: 'projection-routing-multicamera', sequenceId: 'main-sequence',
			outputClipId: 'output-clip', activeMemberId: 'camera-a',
			members: [
				{ id: 'camera-a', groupId: 'group-a', sourceId: 'source-a', syncOffsetSamples: 0 },
				{ id: 'camera-b', groupId: 'group-a', sourceId: 'source-b', syncOffsetSamples: 2_000 },
			],
		}],
	});
	return applyFramescaperProjectCommandV18(PROFILE, project, {
		type: 'multicamera/switch',
		projectId: project.id,
		expectedProjectRevision: project.revision,
		groupId: 'group-a',
		expectedActiveMemberId: 'camera-a',
		memberId: 'camera-b',
	}, { now: NOW });
}

function videoSource(
	id: string,
	contentSha256: string,
	rate: Readonly<{ readonly num: number; readonly den: number }>,
	sourceFrameCount: number,
): Record<string, unknown> {
	return createVideoSource({
		id, name: id, storageKey: id, mimeType: 'video/mp4', contentSha256,
		sampleFrameCount: Math.ceil(sourceFrameCount * 48_000 * rate.den / rate.num),
		sourceFrameCount, frameRate: rate, width: 1920, height: 1080,
	});
}

function stateFixture(): EditorDocumentSnapshotState {
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
	};
}
