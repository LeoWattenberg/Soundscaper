/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { audacityMacroMenuCommand } from '../src/common/editor/audacity-macro-menu-commands.ts';
import { createMacroCommandStep } from '../src/common/editor/macro-command-steps.ts';
import {
	createMacroCommandService,
	type MacroCommandProject,
} from '../src/common/editor/controller/effects/internal/macro/macro-command-service.ts';
import {
	createSelectionViewService,
	type SelectionViewSelection,
	type SelectionViewServiceRuntime,
	type SelectionViewState,
} from '../src/common/editor/controller/track-audio/internal/selection-view-service.ts';
import {
	AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION,
} from '../src/common/editor/project-schema-version.ts';

const SAMPLE_RATE = 1_000;
/** The last frame the project's own content reaches: clip-b starts at 40 and runs 30 frames. */
const PROJECT_END_FRAME = 70;
/** The timeline runs past the content, so a full-range selection must not stop here. */
const TIMELINE_FRAMES = 200;

type TestSelection = SelectionViewSelection & {
	trackIds: readonly string[];
	clipIds: readonly string[];
};

type TestRenderedAudio = Readonly<{ channels: readonly Float32Array[] }>;

type TestProject = {
	id: string;
	schemaVersion: number;
	sampleRate: number;
	tracks: Array<{ id: string; type: string; clipIds?: string[] }>;
	clips: Array<{ id: string; kind: 'audio'; timelineStartFrame: number; durationFrames: number }>;
	selection: TestSelection;
};

/**
 * The macro tier reaches the selection through the same action tree the editor
 * binds, so the harness wires the real selection service behind the same two
 * `timeline` paths `action-facade.ts` publishes.
 */
function createFixture() {
	let project: TestProject = {
		id: 'project-a',
		schemaVersion: AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION,
		sampleRate: SAMPLE_RATE,
		tracks: [
			{ id: 'track-a', type: 'audio', clipIds: ['clip-a'] },
			{ id: 'track-b', type: 'audio', clipIds: ['clip-b'] },
		],
		clips: [
			{ id: 'clip-a', kind: 'audio', timelineStartFrame: 10, durationFrames: 20 },
			{ id: 'clip-b', kind: 'audio', timelineStartFrame: 40, durationFrames: 30 },
		],
		selection: { startFrame: 10, endFrame: 30, trackIds: ['track-a'], clipIds: [] },
	};
	const seeks: number[] = [];
	const state: SelectionViewState = {
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
	const runtime: SelectionViewServiceRuntime<TestProject, TestRenderedAudio> = {
		DEFAULT_PIXELS_PER_SECOND: 100,
		MAX_PIXELS_PER_SECOND: 10_000,
		activeSelection: () => project.selection,
		audioBufferChannels: () => [new Float32Array(8)],
		cloneProject: (value) => structuredClone(value),
		collectRelatedClipIds: (_value, ids) => [...new Set(ids)],
		commit: () => project,
		copy: {
			audioTrackNotFound: 'Track not found.',
			audioClipNotFound: 'Clip not found.',
			selectionFramesFinite: 'Selection frames must be finite.',
			timelineFramesFinite: 'Timeline frames must be finite.',
			v2Required: 'Version 2 required.',
			zeroCrossingsAligned: 'Aligned.',
		},
		editorTimelineDurationFrames: () => TIMELINE_FRAMES,
		engine: {
			getPositionFrames: () => 20,
			getState: () => ({ state: 'stopped' }),
			seek: (frame: number) => { seeks.push(frame); },
		},
		findClip: (value, clipId) => value.clips.find((clip) => clip.id === clipId) || null,
		findClipTrack: (value, clipId) => value.tracks
			.find((track) => track.clipIds?.includes(clipId)) || null,
		findNearestAudioZeroCrossing: (_channels, frame) => frame,
		findTrack: (value, trackId) => value.tracks.find((track) => track.id === trackId),
		getProject: () => project,
		handleError: () => undefined,
		normalizeTimelineFrame: (value) => Math.max(0, Math.min(TIMELINE_FRAMES, Math.round(Number(value)))),
		persistSetting: (_key, value) => Promise.resolve(value),
		productSettingKey: (key) => `product:${key}`,
		projectDurationFrames: (value: TestProject) => value.clips
			.reduce((maximum, clip) => Math.max(maximum, clip.timelineStartFrame + clip.durationFrames), 0),
		projectSampleRate: () => SAMPLE_RATE,
		publishDocumentSnapshot: () => undefined,
		publishProjectState: () => undefined,
		renderSnapshot: () => Promise.resolve({ channels: [new Float32Array(8)] }),
		resetRoutedInputMeter: () => undefined,
		setStatus: () => undefined,
		snapAudioEditorFrameWithProject: (frame) => Number(frame),
		state,
		synchronizeAutomaticSampleEditMode: () => undefined,
		synchronizeMicrophoneMeterTarget: () => undefined,
		updatePlayhead: () => undefined,
		updateSelection: (command) => {
			project = { ...project, selection: { ...project.selection, ...command } };
			return project;
		},
	};
	const selectionView = createSelectionViewService(runtime);
	const macros = createMacroCommandService({
		getActions: () => ({
			timeline: {
				selectAll: () => selectionView.selectAll(),
				selectAllTracks: () => selectionView.selectAllTracks(),
			},
		}),
		getProject: () => project as unknown as MacroCommandProject,
		projectSampleRate: () => SAMPLE_RATE,
		timelineDurationFrames: () => PROJECT_END_FRAME,
		setExactSelection: (startFrame, endFrame, details = {}) => selectionView
			.setExactSelection(startFrame, endFrame, details),
	});
	return {
		seeks,
		selection: () => project.selection,
		run(command: string) {
			macros.runMacroCommand(createMacroCommandStep(command, { id: 'step' }));
		},
	};
}

test('a macro SelectAll step selects the whole project, not just every track', () => {
	const fixture = createFixture();

	fixture.run('SelectAll');

	// Audacity's own SelectAll is DoSelectTimeAndTracks(project, true, true): the
	// full time range as well as every track. A macro that opens with SelectAll
	// and continues with an effect must hand that effect the whole project.
	assert.equal(fixture.selection().startFrame, 0);
	assert.equal(
		fixture.selection().endFrame,
		PROJECT_END_FRAME,
		'the selection must reach the end of the project content, not stay on the range it already had',
	);
	assert.deepEqual(fixture.selection().trackIds, ['track-a', 'track-b']);
	assert.deepEqual(fixture.seeks, [0], 'a new full-range selection carries the playhead to its start');
});

test('a macro SelAllTracks step widens the track scope and leaves the time range alone', () => {
	const fixture = createFixture();

	fixture.run('SelAllTracks');

	// Upstream registers this as its own command, and it is the one that keeps
	// whatever range the project already had.
	assert.equal(fixture.selection().startFrame, 10);
	assert.equal(fixture.selection().endFrame, 30);
	assert.deepEqual(fixture.selection().trackIds, ['track-a', 'track-b']);
	assert.deepEqual(fixture.seeks, []);
});

test('the macro table keeps Audacity SelectAll and SelAllTracks on separate actions', () => {
	assert.equal(audacityMacroMenuCommand('SelectAll')?.path, 'timeline.selectAll');
	assert.equal(audacityMacroMenuCommand('SelAllTracks')?.path, 'timeline.selectAllTracks');
});
