/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createSelectionViewService,
	type SelectionViewServiceRuntime,
} from '../src/common/editor/controller/selection-view-service.ts';
import {
	AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION,
	FRAMESCAPER_PROJECT_V19_SCHEMA_VERSION,
	SOUNDSCAPER_PROJECT_V21_SCHEMA_VERSION,
} from '../src/common/editor/project-schema-version.ts';

function createFixture() {
	type TestProject = {
		id: string;
		schemaVersion: number;
		sampleRate: number;
		tracks: Array<{
			id: string;
			type: string;
			clipIds?: string[];
			labels?: Array<{ startFrame: number; endFrame: number }>;
		}>;
		clips: Array<{
			id: string;
			kind: 'audio';
			timelineStartFrame: number;
			durationFrames: number;
			sourceStartFrame: number;
		}>;
		timelineAnnotations?: unknown[];
		selection: {
			startFrame: number;
			endFrame: number;
			trackIds: string[];
			clipIds: string[];
			annotationIds?: string[];
			frequencyRange?: Record<string, number> | null;
		} | null;
	};
	let project: TestProject = {
		id: 'project-a',
		schemaVersion: 5,
		sampleRate: 1_000,
		tracks: [
			{ id: 'track-a', type: 'audio', clipIds: ['clip-a'] },
			{ id: 'track-b', type: 'audio', clipIds: ['clip-b'] },
			{ id: 'labels', type: 'label', labels: [{ startFrame: 5, endFrame: 75 }] },
		],
		clips: [
			{ id: 'clip-a', kind: 'audio', timelineStartFrame: 10, durationFrames: 20, sourceStartFrame: 0 },
			{ id: 'clip-b', kind: 'audio', timelineStartFrame: 40, durationFrames: 30, sourceStartFrame: 0 },
		],
		selection: { startFrame: 10, endFrame: 30, trackIds: ['track-a'], clipIds: [] },
	};
	let resolveRender: (value: unknown) => void = () => undefined;
	let rejectRender: (reason?: unknown) => void = () => undefined;
	let commits = 0;
	let publishes = 0;
	let projectPublishes = 0;
	let meterResets = 0;
	let meterSynchronizations = 0;
	let automaticModeSynchronizations = 0;
	const persisted: Array<[string, unknown]> = [];
	const statuses: Array<[unknown, unknown]> = [];
	const handledErrors: unknown[] = [];
	const playheads: unknown[] = [];
	const seeks: number[] = [];
	const state: Record<string, unknown> = {
		analysisProcessing: false,
		selectedTrackId: 'track-a',
		selectedClipId: null,
		selectedAnnotationId: null,
		showRms: false,
		showVerticalRulers: false,
		updateDisplayWhilePlaying: true,
		pinnedPlayhead: false,
		playbackOnRulerClick: true,
		timelineViewportWidth: 1_000,
		pixelsPerSecond: 100,
	};
	const runtime: SelectionViewServiceRuntime = {
		DEFAULT_PIXELS_PER_SECOND: 100,
		MAX_PIXELS_PER_SECOND: 10_000,
		MAX_TIMELINE_PIXELS: 1_000_000,
		activeSelection: () => project.selection,
		audioBufferChannels: () => [new Float32Array(64)],
		cloneProject: (value) => structuredClone(value),
		collectRelatedClipIds: (_value, ids) => [...new Set(ids)],
		commit: (command) => {
			commits += 1;
			if (command.type === 'selection/set') {
				project = { ...project, selection: { ...project.selection, ...command } } as TestProject;
			}
			return project;
		},
		copy: {
			audioTrackNotFound: 'Track not found.',
			audioClipNotFound: 'Clip not found.',
			selectionFramesFinite: 'Selection frames must be finite.',
			timelineFramesFinite: 'Timeline frames must be finite.',
			v2Required: 'Version 2 required.',
			zeroCrossingsAligned: 'Aligned.',
		},
		editorTimelineDurationFrames: () => 100,
		engine: { getPositionFrames: () => 20, seek: (frame: number) => { seeks.push(frame); } },
		findClip: (value, clipId) => value.clips.find((clip: { id: string }) => clip.id === clipId) || null,
		findClipTrack: (value, clipId) => value.tracks.find((track: { clipIds?: string[] }) => track.clipIds?.includes(clipId)) || null,
		findNearestAudioZeroCrossing: (_channels, frame) => frame,
		findTrack: (value, trackId) => value.tracks.find((track: { id: string }) => track.id === trackId),
		getProject: () => project,
		handleError: (error) => { handledErrors.push(error); },
		normalizeTimelineFrame: (value) => Math.max(0, Math.min(100, Math.round(Number(value)))),
		persistSetting: (key, value) => {
			persisted.push([key, value]);
			return Promise.resolve(value);
		},
		productSettingKey: (key) => `product:${key}`,
		projectDurationFrames: () => 100,
		projectSampleRate: () => 1_000,
		publishDocumentSnapshot: () => { publishes += 1; },
		publishProjectState: () => { projectPublishes += 1; },
		renderSnapshot: () => new Promise((resolve, reject) => {
			resolveRender = resolve;
			rejectRender = reject;
		}),
		resetRoutedInputMeter: () => { meterResets += 1; },
		setStatus: (message, status) => { statuses.push([message, status]); },
		snapAudioEditorFrameWithProject: (frame) => frame,
		state,
		synchronizeAutomaticSampleEditMode: () => { automaticModeSynchronizations += 1; },
		synchronizeMicrophoneMeterTarget: () => { meterSynchronizations += 1; },
		updatePlayhead: (frame) => { playheads.push(frame); },
		updateSelection: (command) => {
			project = { ...project, selection: { ...project.selection, ...command } } as TestProject;
			return project;
		},
	};
	return {
		service: createSelectionViewService(runtime),
		state,
		persisted,
		commits: () => commits,
		publishes: () => publishes,
		projectPublishes: () => projectPublishes,
		meterResets: () => meterResets,
		meterSynchronizations: () => meterSynchronizations,
		automaticModeSynchronizations: () => automaticModeSynchronizations,
		statuses,
		handledErrors,
		playheads,
		seeks,
		project: () => project,
		updateProject(changes: Partial<TestProject>) {
			project = { ...project, ...changes };
		},
		replaceProject() {
			project = { ...project, id: 'project-b' };
		},
		resolveRender(value: unknown) {
			resolveRender(value);
		},
		rejectRender(reason: unknown) {
			rejectRender(reason);
		},
	};
}

test('selection service composes clip navigation through one frozen controller port', () => {
	const fixture = createFixture();
	const navigation = fixture.service.clipNavigation;
	assert.equal(Object.isFrozen(navigation), true);

	fixture.updateProject({
		selection: { startFrame: 10, endFrame: 30, trackIds: [], clipIds: [] },
	});
	assert.equal(navigation.selectNextClip()?.selection.startFrame, 40);
	assert.equal(fixture.state.selectedClipId, 'clip-b');
	assert.equal(navigation.skipToSelectionStart(), 40);
	assert.equal(navigation.skipToSelectionEnd(), 70);
	assert.deepEqual(fixture.seeks, [40, 70]);
	assert.deepEqual(navigation.selectNoTracks()?.selection.trackIds, []);
});

test('selection async completion cannot publish into a replacement project', async () => {
	const fixture = createFixture();
	assert.equal(Object.isFrozen(fixture.service), true);
	const pending = fixture.service.selectAtZeroCrossings();
	fixture.replaceProject();
	fixture.resolveRender({});
	assert.equal(await pending, null);
	assert.equal(fixture.commits(), 0);
	assert.equal(fixture.state.analysisProcessing, false);
	assert.equal(fixture.publishes(), 2);
});

test('view toggles share durable preference publication behavior', () => {
	const fixture = createFixture();
	assert.equal(fixture.service.toggleRmsWaveform(), true);
	assert.equal(fixture.service.toggleVerticalRulers(), true);
	assert.equal(fixture.service.toggleUpdateWhilePlaying(), false);
	assert.equal(fixture.service.togglePinnedPlayhead(), true);
	assert.equal(fixture.service.toggleRulerPlayback(), false);
	assert.deepEqual(fixture.persisted, [
		['product:waveform-show-rms', true],
		['product:timeline-show-vertical-rulers', true],
		['product:timeline-update-while-playing', false],
		['product:timeline-pinned-playhead', true],
		['product:timeline-ruler-playback', false],
	]);
	assert.equal(fixture.publishes(), 5);
});

test('selection frame validation and normalization remain centralized', () => {
	const fixture = createFixture();
	assert.throws(() => fixture.service.setSelection(Number.NaN, 1), /finite/u);
	const next = fixture.service.setSelection(120, -10);
	assert.equal(next.selection.startFrame, 0);
	assert.equal(next.selection.endFrame, 100);
});

test('track, clip, and time selection clear V17 annotation focus and selection', () => {
	const fixture = createFixture();
	fixture.updateProject({
		schemaVersion: AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION,
		timelineAnnotations: [],
		selection: {
			startFrame: 10,
			endFrame: 30,
			trackIds: ['track-a'],
			clipIds: [],
			annotationIds: ['annotation-a'],
		},
	});
	fixture.state.selectedAnnotationId = 'annotation-a';

	fixture.service.selectTrack('track-b');
	assert.equal(fixture.state.selectedAnnotationId, null);
	assert.deepEqual(fixture.project().selection?.annotationIds, []);

	fixture.updateProject({
		selection: { ...fixture.project().selection!, annotationIds: ['annotation-a'] },
	});
	fixture.state.selectedAnnotationId = 'annotation-a';
	fixture.service.selectClip('clip-a');
	assert.equal(fixture.state.selectedAnnotationId, null);
	assert.deepEqual(fixture.project().selection?.annotationIds, []);

	fixture.updateProject({
		selection: { ...fixture.project().selection!, annotationIds: ['annotation-a'] },
	});
	fixture.state.selectedAnnotationId = 'annotation-a';
	fixture.service.setSelection(12, 24, { trackIds: ['track-a'] });
	assert.equal(fixture.state.selectedAnnotationId, null);
	assert.deepEqual(fixture.project().selection?.annotationIds, []);
});

test('track selection clears Soundscaper V21 annotation focus and durable selection', () => {
	const fixture = createFixture();
	fixture.updateProject({
		schemaVersion: SOUNDSCAPER_PROJECT_V21_SCHEMA_VERSION,
		timelineAnnotations: [],
		selection: {
			startFrame: 10,
			endFrame: 30,
			trackIds: ['track-a'],
			clipIds: [],
			annotationIds: ['annotation-a'],
		},
	});
	fixture.state.selectedAnnotationId = 'annotation-a';

	fixture.service.selectTrack('track-b');

	assert.equal(fixture.state.selectedAnnotationId, null);
	assert.deepEqual(fixture.project().selection?.annotationIds, []);
});

test('selection does not traverse Framescaper or future annotation storage', () => {
	let annotationReads = 0;
	for (const schemaVersion of [
		FRAMESCAPER_PROJECT_V19_SCHEMA_VERSION,
		SOUNDSCAPER_PROJECT_V21_SCHEMA_VERSION + 1,
	]) {
		const fixture = createFixture();
		fixture.updateProject({
			schemaVersion,
			timelineAnnotations: undefined,
			selection: {
				startFrame: 10,
				endFrame: 30,
				trackIds: ['track-a'],
				clipIds: [],
				annotationIds: ['opaque-annotation'],
			},
		});
		Object.defineProperty(fixture.project(), 'timelineAnnotations', {
			configurable: true,
			get(): never {
				annotationReads += 1;
				throw new Error('foreign timelineAnnotations was traversed');
			},
		});

		fixture.service.selectTrack('track-b');

		assert.deepEqual(fixture.project().selection?.annotationIds, ['opaque-annotation']);
	}
	assert.equal(annotationReads, 0);
});

test('selection does not infer annotation ownership without the current annotation collection', () => {
	const fixture = createFixture();
	fixture.updateProject({
		schemaVersion: AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION,
		timelineAnnotations: undefined,
		selection: {
			startFrame: 10,
			endFrame: 30,
			trackIds: ['track-a'],
			clipIds: [],
			annotationIds: ['opaque-annotation'],
		},
	});
	fixture.state.selectedAnnotationId = 'opaque-annotation';

	fixture.service.selectTrack('track-b');
	assert.equal(fixture.state.selectedAnnotationId, null);
	assert.deepEqual(fixture.project().selection?.annotationIds, ['opaque-annotation']);
});

test('track and clip selection cover modern, additive, toggle, clear, and legacy paths', () => {
	const fixture = createFixture();
	fixture.service.selectTrack('track-a');
	assert.equal(fixture.meterResets(), 0);
	fixture.service.selectTrack('track-b');
	assert.equal(fixture.state.selectedTrackId, 'track-b');
	assert.equal(fixture.meterResets(), 1);
	assert.throws(() => fixture.service.selectTrack('missing'), /Track not found/u);

	assert.equal(fixture.service.selectClip('clip-a'), 'clip-a');
	assert.deepEqual(fixture.project().selection?.clipIds, ['clip-a']);
	assert.equal(fixture.service.selectClip('clip-b', { additive: true }), 'clip-b');
	assert.deepEqual(fixture.project().selection?.clipIds, ['clip-a', 'clip-b']);
	assert.equal(fixture.service.selectClip('clip-b', { toggle: true }), 'clip-a');
	assert.deepEqual(fixture.project().selection?.clipIds, ['clip-a']);
	assert.deepEqual(fixture.service.selectClip(null).selection?.clipIds, []);
	assert.deepEqual(fixture.project().selection?.clipIds, []);
	assert.throws(() => fixture.service.selectClip('missing'), /Clip not found/u);

	fixture.updateProject({ schemaVersion: 1 });
	assert.equal(fixture.service.selectClip('clip-b'), 'clip-b');
	assert.equal(fixture.state.selectedTrackId, 'track-b');
	assert.equal(fixture.state.selectedClipId, 'clip-b');
	assert.ok(fixture.meterSynchronizations() >= 3);
});

test('selection range commands derive audio and label bounds around the playhead', () => {
	const fixture = createFixture();
	fixture.updateProject({
		selection: { startFrame: 10, endFrame: 30, trackIds: ['track-a', 'labels'], clipIds: [] },
	});
	assert.deepEqual(fixture.service.selectedTracksTimeRange(), { startFrame: 5, endFrame: 75 });
	const wholeTracks = fixture.service.selectTrackStartToEnd();
	assert.equal(wholeTracks.startFrame, 5);
	assert.equal(wholeTracks.endFrame, 75);
	assert.deepEqual(wholeTracks.trackIds, ['track-a', 'labels']);
	assert.equal(fixture.service.selectLeftOfPlaybackPosition().endFrame, 20);
	assert.equal(fixture.service.selectLeftOfPlaybackPosition(25).startFrame, 0);
	assert.equal(fixture.service.selectRightOfPlaybackPosition().endFrame, 100);
	assert.equal(fixture.service.selectRightOfPlaybackPosition(10).endFrame, 100);
	assert.equal(fixture.service.selectTrackStartToCursor().startFrame, 5);
	assert.equal(fixture.service.selectCursorToTrackEnd().endFrame, 75);

	const selected = fixture.service.selectAllTracks();
	assert.deepEqual(selected?.trackIds, ['track-a', 'track-b', 'labels']);
	fixture.updateProject({ selection: { startFrame: 0, endFrame: 0, trackIds: [], clipIds: [] } });
	fixture.state.selectedTrackId = null;
	assert.equal(fixture.service.selectedTracksTimeRange(), null);
	assert.equal(fixture.service.selectTrackStartToEnd(), null);
});

test('snap settings, legacy frame clamping, and zoom remain bounded', () => {
	const fixture = createFixture();
	assert.equal(fixture.service.snapTimelineFrame(12.4), 12);
	assert.throws(() => fixture.service.snapTimelineFrame(Number.POSITIVE_INFINITY), /finite/u);
	assert.equal(fixture.service.setSnapSettings({ mode: 'nearest' }), fixture.project());
	fixture.updateProject({ schemaVersion: 1 });
	assert.equal(fixture.service.snapTimelineFrame(-4), 0);
	assert.throws(() => fixture.service.setSnapSettings(), /Version 2/u);

	fixture.state.timelineViewportWidth = 0;
	assert.equal(fixture.service.setZoom(250), 250);
	assert.equal(fixture.service.setZoom(0), 100);
	assert.equal(fixture.automaticModeSynchronizations(), 2);
	assert.deepEqual(fixture.playheads, [20, 20]);
});

test('zero-crossing alignment commits success and reports render failures', async () => {
	const success = createFixture();
	const aligned = success.service.selectAtZeroCrossings();
	success.resolveRender({});
	const result = await aligned;
	assert.equal(result.startFrame, 10);
	assert.equal(result.endFrame, 30);
	assert.deepEqual(result.trackIds, ['track-a']);
	assert.equal(success.commits(), 1);
	assert.deepEqual(success.statuses, [['Aligned.', 'success']]);

	const failed = createFixture();
	const pending = failed.service.selectAtZeroCrossings();
	const failure = new Error('render failed');
	failed.rejectRender(failure);
	assert.equal(await pending, null);
	assert.deepEqual(failed.handledErrors, [failure]);
	failed.state.analysisProcessing = true;
	assert.equal(await failed.service.selectAtZeroCrossings(), null);
});
