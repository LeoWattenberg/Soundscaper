/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createClipSelectionNavigationService,
	type ClipSelectionNavigationProject,
	type ClipSelectionNavigationSelectionCommand,
} from '../src/common/editor/controller/clip-selection-navigation-service.ts';

const tempoMap = {
	mode: 'musical' as const,
	events: [{ beat: { num: 0, den: 1 }, bpm: { num: 120, den: 1 } }],
};

function sampleClip(id: string, timelineStartFrame: number, durationFrames: number) {
	return {
		id,
		kind: 'audio',
		sourceId: `source-${id}`,
		timelineStartFrame,
		durationFrames,
		sourceStartFrame: 0,
		sourceDurationFrames: durationFrames,
	};
}

function musicalClip(id: string, startBeat: number, durationBeats: number) {
	return {
		id,
		kind: 'audio',
		sourceId: `source-${id}`,
		anchor: 'musical',
		musicalStartBeat: { num: startBeat, den: 1 },
		musicalExtent: 'beat',
		musicalDurationBeats: { num: durationBeats, den: 1 },
		sourceStartFrame: 0,
		sourceDurationFrames: 48_000,
		// A stale persisted cache must never drive navigation.
		timelineStartFrame: 7,
		durationFrames: 11,
	};
}

function projectFixture(
	overrides: Partial<ClipSelectionNavigationProject> = {},
): ClipSelectionNavigationProject {
	const selected = musicalClip('selected-musical', 2, 1);
	const unselected = sampleClip('unselected-nearer', 79_000, 2_000);
	return {
		schemaVersion: 10,
		sampleRate: 48_000,
		tempoMap,
		clips: [selected, unselected],
		tracks: [
			{ id: 'selected-track', type: 'audio', clipIds: [selected.id] },
			{ id: 'other-track', type: 'audio', clipIds: [unselected.id] },
		],
		selection: {
			startFrame: 80_000,
			endFrame: 100_000,
			trackIds: ['selected-track'],
			clipIds: ['selected-musical'],
			annotationIds: ['annotation-a'],
			frequencyRange: { minimumFrequency: 120, maximumFrequency: 4_000 },
		},
		...overrides,
	};
}

function createFixture(project: ClipSelectionNavigationProject) {
	const commands: ClipSelectionNavigationSelectionCommand[] = [];
	const seeks: number[] = [];
	const state = {
		selectedTrackId: 'selected-track',
		selectedClipId: 'selected-musical',
		selectedAnnotationId: 'annotation-a',
	};
	const service = createClipSelectionNavigationService({
		state,
		getProject: () => project,
		updateSelection: (command) => {
			commands.push(command);
			return command;
		},
		seek: (frame) => { seeks.push(frame); },
	});
	return { commands, seeks, service, state };
}

test('previous clip boundary uses projected musical timing and selected audio tracks', () => {
	const project = projectFixture();
	const before = structuredClone(project);
	const fixture = createFixture(project);

	fixture.service.selectPreviousClipBoundaryToCursor();

	assert.deepEqual(fixture.commands, [{
		type: 'selection/set',
		startFrame: 72_000,
		endFrame: 100_000,
		trackIds: ['selected-track'],
		clipIds: ['selected-musical'],
		annotationIds: ['annotation-a'],
		frequencyRange: { minimumFrequency: 120, maximumFrequency: 4_000 },
	}]);
	assert.deepEqual(project, before);
});

test('next clip boundary is strictly after the selection end and preserves selection facets', () => {
	const first = musicalClip('first', 2, 1);
	const next = musicalClip('next', 4, 1);
	const project = projectFixture({
		clips: [first, next],
		tracks: [{ id: 'selected-track', type: 'audio', clipIds: [first.id, next.id] }],
		selection: {
			startFrame: 60_000,
			endFrame: 72_000,
			trackIds: ['selected-track'],
			clipIds: ['first'],
			annotationIds: ['annotation-a'],
			frequencyRange: null,
		},
	});
	const fixture = createFixture(project);

	fixture.service.selectCursorToNextClipBoundary();

	assert.deepEqual(fixture.commands, [{
		type: 'selection/set',
		startFrame: 60_000,
		endFrame: 96_000,
		trackIds: ['selected-track'],
		clipIds: ['first'],
		annotationIds: ['annotation-a'],
		frequencyRange: null,
	}]);
});

test('clip boundary navigation searches every audio track when none is selected', () => {
	const project = projectFixture({
		selection: {
			startFrame: 80_000,
			endFrame: 80_000,
			trackIds: ['labels'],
			clipIds: [],
			annotationIds: [],
			frequencyRange: null,
		},
		tracks: [
			{ id: 'labels', type: 'label' },
			{ id: 'selected-track', type: 'audio', clipIds: ['selected-musical'] },
			{ id: 'other-track', type: 'audio', clipIds: ['unselected-nearer'] },
		],
	});
	const fixture = createFixture(project);

	fixture.service.selectPreviousClipBoundaryToCursor();
	fixture.service.selectCursorToNextClipBoundary();

	assert.equal(fixture.commands[0]?.startFrame, 79_000);
	assert.equal(fixture.commands[1]?.endFrame, 81_000);
});

test('clip boundary navigation is inert when no qualifying boundary exists', () => {
	const clip = sampleClip('only', 10, 10);
	const project = projectFixture({
		clips: [clip],
		tracks: [{ id: 'selected-track', type: 'audio', clipIds: [clip.id] }],
		selection: {
			startFrame: 0,
			endFrame: 20,
			trackIds: ['selected-track'],
			clipIds: [],
			annotationIds: [],
			frequencyRange: null,
		},
	});
	const fixture = createFixture(project);

	assert.equal(fixture.service.selectPreviousClipBoundaryToCursor(), null);
	assert.equal(fixture.service.selectCursorToNextClipBoundary(), null);
	assert.deepEqual(fixture.commands, []);
});

test('next clip selects projected timing and resolves equal-time ties by track order', () => {
	const current = musicalClip('current', 2, 1);
	const firstTrackNext = musicalClip('first-track-next', 4, 2);
	const secondTrackNext = musicalClip('second-track-next', 4, 1);
	const project = projectFixture({
		// Put the second-track clip first in document order to prove track order is primary.
		clips: [current, secondTrackNext, firstTrackNext],
		tracks: [
			{ id: 'first-track', type: 'audio', clipIds: [current.id, firstTrackNext.id] },
			{ id: 'second-track', type: 'audio', clipIds: [secondTrackNext.id] },
		],
		selection: {
			startFrame: 48_000,
			endFrame: 72_000,
			trackIds: ['second-track', 'first-track'],
			clipIds: ['current'],
			annotationIds: ['annotation-a'],
			frequencyRange: { minimumFrequency: 120, maximumFrequency: 4_000 },
		},
	});
	const fixture = createFixture(project);

	fixture.service.selectNextClip();

	assert.deepEqual(fixture.commands, [{
		type: 'selection/set',
		startFrame: 96_000,
		endFrame: 144_000,
		trackIds: ['first-track'],
		clipIds: ['first-track-next'],
		annotationIds: [],
		frequencyRange: null,
	}]);
	assert.deepEqual(fixture.state, {
		selectedTrackId: 'first-track',
		selectedClipId: 'first-track-next',
		selectedAnnotationId: null,
	});
});

test('clip adjacency stays within selected audio tracks and is inert at the end', () => {
	const current = sampleClip('current', 10, 10);
	const selectedNext = sampleClip('selected-next', 50, 10);
	const unselectedNearer = sampleClip('unselected-nearer', 30, 10);
	const project = projectFixture({
		clips: [current, selectedNext, unselectedNearer],
		tracks: [
			{ id: 'selected', type: 'audio', clipIds: [current.id, selectedNext.id] },
			{ id: 'unselected', type: 'audio', clipIds: [unselectedNearer.id] },
		],
		selection: {
			startFrame: 10, endFrame: 20, trackIds: ['selected'], clipIds: ['current'],
			annotationIds: [], frequencyRange: null,
		},
	});
	const fixture = createFixture(project);

	fixture.service.selectNextClip();

	assert.equal(fixture.commands[0]?.clipIds[0], 'selected-next');
	const endFixture = createFixture(projectFixture({
		clips: [current, selectedNext, unselectedNearer],
		tracks: [
			{ id: 'selected', type: 'audio', clipIds: [current.id, selectedNext.id] },
			{ id: 'unselected', type: 'audio', clipIds: [unselectedNearer.id] },
		],
		selection: {
			startFrame: 50, endFrame: 60, trackIds: ['selected'], clipIds: ['selected-next'],
			annotationIds: [], frequencyRange: null,
		},
	}));
	const focusBefore = { ...endFixture.state };
	assert.equal(endFixture.service.selectNextClip(), null);
	assert.deepEqual(endFixture.commands, []);
	assert.deepEqual(endFixture.state, focusBefore);
});

test('previous clip uses all-audio fallback and project document order within a track tie', () => {
	const documentFirst = sampleClip('document-first', 40_000, 10_000);
	const documentSecond = sampleClip('document-second', 40_000, 20_000);
	const later = sampleClip('later', 70_000, 5_000);
	const project = projectFixture({
		clips: [documentFirst, documentSecond, later],
		tracks: [
			{ id: 'labels', type: 'label' },
			{
				id: 'audio',
				type: 'audio',
				// Track-local order differs; the project clip array remains authoritative for ties.
				clipIds: [documentSecond.id, later.id, documentFirst.id],
			},
		],
		selection: {
			startFrame: 80_000,
			endFrame: 80_000,
			trackIds: ['labels'],
			clipIds: [],
			annotationIds: ['annotation-a'],
			frequencyRange: null,
		},
	});
	const fixture = createFixture(project);

	fixture.service.selectPreviousClip();

	assert.deepEqual(fixture.commands, [{
		type: 'selection/set',
		startFrame: 70_000,
		endFrame: 75_000,
		trackIds: ['audio'],
		clipIds: ['later'],
		annotationIds: [],
		frequencyRange: null,
	}]);

	const tiedProject = projectFixture({
		clips: [documentFirst, documentSecond],
		tracks: [{
			id: 'audio', type: 'audio', clipIds: [documentSecond.id, documentFirst.id],
		}],
		selection: {
			startFrame: 60_000,
			endFrame: 60_000,
			trackIds: [],
			clipIds: [],
			annotationIds: [],
			frequencyRange: null,
		},
	});
	const tiedFixture = createFixture(tiedProject);
	tiedFixture.service.selectPreviousClip();
	assert.equal(tiedFixture.commands[0]?.clipIds[0], 'document-first');
});

test('partial same-start selections expand or contract to the adjacent clip', () => {
	const clip = sampleClip('same-start', 20_000, 20_000);
	const nextProject = projectFixture({
		clips: [clip],
		tracks: [{ id: 'audio', type: 'audio', clipIds: [clip.id] }],
		selection: {
			startFrame: 20_000, endFrame: 25_000, trackIds: ['audio'], clipIds: [],
			annotationIds: [], frequencyRange: null,
		},
	});
	const previousProject = projectFixture({
		clips: [clip],
		tracks: [{ id: 'audio', type: 'audio', clipIds: [clip.id] }],
		selection: {
			startFrame: 20_000, endFrame: 45_000, trackIds: ['audio'], clipIds: [],
			annotationIds: [], frequencyRange: null,
		},
	});
	const nextFixture = createFixture(nextProject);
	const previousFixture = createFixture(previousProject);

	nextFixture.service.selectNextClip();
	previousFixture.service.selectPreviousClip();

	assert.deepEqual(
		[nextFixture.commands[0]?.startFrame, nextFixture.commands[0]?.endFrame],
		[20_000, 40_000],
	);
	assert.deepEqual(
		[previousFixture.commands[0]?.startFrame, previousFixture.commands[0]?.endFrame],
		[20_000, 40_000],
	);
});

test('clip selection restores every focus field when selection publication fails', () => {
	const current = sampleClip('current', 10, 10);
	const next = sampleClip('next', 30, 10);
	const project = projectFixture({
		clips: [current, next],
		tracks: [{ id: 'audio', type: 'audio', clipIds: [current.id, next.id] }],
		selection: {
			startFrame: 10, endFrame: 20, trackIds: ['audio'], clipIds: ['current'],
			annotationIds: ['annotation-a'], frequencyRange: null,
		},
	});
	const state = {
		selectedTrackId: 'audio',
		selectedClipId: 'current',
		selectedAnnotationId: 'annotation-a',
	};
	const failure = new Error('read only');
	let focusDuringUpdate: typeof state | null = null;
	const service = createClipSelectionNavigationService({
		state,
		getProject: () => project,
		updateSelection: () => {
			focusDuringUpdate = { ...state };
			throw failure;
		},
		seek: () => undefined,
	});

	assert.throws(() => service.selectNextClip(), (error: unknown) => error === failure);
	assert.deepEqual(focusDuringUpdate, {
		selectedTrackId: 'audio',
		selectedClipId: 'next',
		selectedAnnotationId: null,
	});
	assert.deepEqual(state, {
		selectedTrackId: 'audio',
		selectedClipId: 'current',
		selectedAnnotationId: 'annotation-a',
	});
});

test('skip actions seek to exact selection endpoints without changing selection', () => {
	const project = projectFixture({
		selection: {
			startFrame: 12_345,
			endFrame: 67_890,
			trackIds: ['selected-track'],
			clipIds: ['selected-musical'],
			annotationIds: ['annotation-a'],
			frequencyRange: { minimumFrequency: 120, maximumFrequency: 4_000 },
		},
	});
	const before = structuredClone(project.selection);
	const fixture = createFixture(project);

	assert.equal(fixture.service.skipToSelectionStart(), 12_345);
	assert.equal(fixture.service.skipToSelectionEnd(), 67_890);

	assert.deepEqual(fixture.seeks, [12_345, 67_890]);
	assert.deepEqual(fixture.commands, []);
	assert.deepEqual(project.selection, before);
});

test('select no tracks preserves time, clip, annotation, and frequency selection', () => {
	const project = projectFixture();
	const fixture = createFixture(project);

	fixture.service.selectNoTracks();

	assert.deepEqual(fixture.commands, [{
		type: 'selection/set',
		startFrame: 80_000,
		endFrame: 100_000,
		trackIds: [],
		clipIds: ['selected-musical'],
		annotationIds: ['annotation-a'],
		frequencyRange: { minimumFrequency: 120, maximumFrequency: 4_000 },
	}]);
	assert.deepEqual(fixture.state, {
		selectedTrackId: null,
		selectedClipId: 'selected-musical',
		selectedAnnotationId: 'annotation-a',
	});
});

test('select no tracks publishes cleared focus atomically and restores it on failure', () => {
	const project = projectFixture();
	const state = {
		selectedTrackId: 'selected-track',
		selectedClipId: 'selected-musical',
		selectedAnnotationId: 'annotation-a',
	};
	let selectedTrackIdDuringUpdate: string | null = 'not-called';
	const failure = new Error('read only');
	const service = createClipSelectionNavigationService({
		state,
		getProject: () => project,
		updateSelection: () => {
			selectedTrackIdDuringUpdate = state.selectedTrackId;
			throw failure;
		},
		seek: () => undefined,
	});

	assert.throws(() => service.selectNoTracks(), (error: unknown) => error === failure);
	assert.equal(selectedTrackIdDuringUpdate, null);
	assert.equal(state.selectedTrackId, 'selected-track');
	assert.equal(state.selectedClipId, 'selected-musical');
	assert.equal(state.selectedAnnotationId, 'annotation-a');
});
