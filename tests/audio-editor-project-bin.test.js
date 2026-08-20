import test from 'node:test';
import assert from 'node:assert/strict';

import { applyEditorCommand } from '../src/common/editor/commands.js';
import {
	createEditorHistory,
	executeEditorCommand,
	undoEditorCommand,
} from '../src/common/editor/history.js';
import {
	findProjectBinClip,
	projectDurationFrames,
	validateAudioEditorProject,
} from '../src/common/editor/project.js';
import {
	createAudioClip,
	createAudioSource,
	createAudioTrack,
} from '../src/common/editor/project-media-factory.ts';
import {
	createCurrentAudioEditorProject,
} from '../src/common/editor/project-current.ts';
import {
	collectHistorySourceIds,
	collectProjectSourceIds,
	compactProjectSourceMetadata,
} from '../src/common/editor/retention.js';
import { createAudioEditorSessionController } from '../src/common/editor/session.js';

const NOW = '2026-07-18T10:00:00.000Z';
const LATER = '2026-07-18T10:01:00.000Z';

function createBinFixture() {
	const source = createAudioSource({
		id: 'source-1',
		name: 'voice.wav',
		storageKey: 'pcm/source-1',
		frameCount: 1_000,
		channelCount: 2,
	});
	const first = createAudioClip({
		id: 'clip-1',
		sourceId: source.id,
		title: 'First',
		timelineStartFrame: 20,
		sourceStartFrame: 100,
		sourceDurationFrames: 500,
		durationFrames: 400,
		trimStartFrames: 100,
		trimEndFrames: 400,
		gain: 0.75,
		fadeInFrames: 20,
		fadeOutFrames: 30,
		reversed: true,
		envelope: [{ frame: 0, value: 0.5 }, { frame: 400, value: 1 }],
		groupId: 'group-1',
		color: 'violet',
		pitchCents: 250,
		speedRatio: 1.25,
		preserveFormants: true,
		stretchToTempo: true,
		renderCacheRevision: 7,
		opaqueExtensions: { retained: true },
	});
	const second = createAudioClip({
		id: 'clip-2',
		sourceId: source.id,
		title: 'Second',
		timelineStartFrame: 600,
		sourceStartFrame: 0,
		sourceDurationFrames: 200,
		durationFrames: 200,
		trimEndFrames: 800,
		groupId: 'group-1',
	});
	return createCurrentAudioEditorProject({
		id: 'project-bin-fixture',
		title: 'Project bin fixture',
		now: NOW,
		selection: {
			startFrame: 20,
			endFrame: 800,
			trackIds: ['track-1', 'track-2'],
			clipIds: [first.id, second.id],
		},
		sources: [source],
		clips: [first, second],
		tracks: [
			createAudioTrack({ id: 'track-1', clipIds: [first.id] }),
			createAudioTrack({ id: 'track-2', clipIds: [second.id] }),
		],
	});
}

test('current factory retains bin clips separately from the timeline', () => {
	const project = createBinFixture();
	const binClip = { ...project.clips[0], id: 'bin-clip', groupId: null };
	const withBin = createCurrentAudioEditorProject({
		...project,
		now: project.createdAt,
		clips: [project.clips[1]],
		tracks: [
			{ ...project.tracks[0], clipIds: [] },
			project.tracks[1],
		],
		selection: { ...project.selection, clipIds: [project.clips[1].id] },
		projectBin: { clips: [binClip] },
	});
	assert.equal(validateAudioEditorProject(withBin), true);
	assert.equal(projectDurationFrames(withBin), 800);
	assert.equal(findProjectBinClip(withBin, binClip.id).title, 'First');
});

test('project-bin commands preserve transforms, clear groups, reuse items, and undo atomically', () => {
	const project = createBinFixture();
	const originalFirst = structuredClone(project.clips[0]);
	let history = createEditorHistory(project);
	history = executeEditorCommand(history, {
		type: 'project-bin/move-from-timeline',
		clipIds: ['clip-1'],
	}, { now: LATER });

	assert.deepEqual(history.present.clips, []);
	assert.deepEqual(history.present.tracks.map((track) => track.clipIds), [[], []]);
	assert.deepEqual(history.present.selection.clipIds, []);
	assert.deepEqual(history.present.projectBin.clips.map((clip) => clip.id), ['clip-1', 'clip-2']);
	assert.deepEqual(findProjectBinClip(history.present, 'clip-1'), {
		...originalFirst,
		groupId: null,
		binItemId: 'clip-1',
	});

	history = undoEditorCommand(history, { now: LATER });
	assert.deepEqual(history.present.clips, project.clips);
	assert.deepEqual(history.present.tracks, project.tracks);
	assert.deepEqual(history.present.selection, project.selection);

	let placed = applyEditorCommand(
		executeEditorCommand(history, {
			type: 'project-bin/move-from-timeline',
			clipIds: ['clip-1', 'clip-2'],
		}, { now: LATER }).present,
		{
			type: 'project-bin/place',
			binClipId: 'clip-1',
			trackId: 'track-1',
			timelineStartFrame: 1_200,
			clipId: 'placed-clip',
		},
		{ now: LATER },
	);
	const placedClip = placed.clips[0];
	assert.equal(placedClip.id, 'placed-clip');
	assert.equal(placedClip.timelineStartFrame, 1_200);
	assert.equal(placedClip.groupId, null);
	assert.deepEqual(
		{ ...placedClip, id: originalFirst.id, timelineStartFrame: originalFirst.timelineStartFrame },
		{ ...originalFirst, groupId: null },
	);
	assert.ok(findProjectBinClip(placed, 'clip-1'));

	placed = applyEditorCommand(placed, {
		type: 'project-bin/update',
		clipId: 'clip-1',
		changes: { title: 'Reusable voice' },
	}, { now: LATER });
	assert.equal(findProjectBinClip(placed, 'clip-1').title, 'Reusable voice');
	placed = applyEditorCommand(placed, {
		type: 'project-bin/remove',
		clipId: 'clip-1',
	}, { now: LATER });
	assert.equal(findProjectBinClip(placed, 'clip-1'), null);
});

test('source updates cannot author disposable video-preview cache locators', () => {
	const project = createBinFixture();
	for (const field of ['posterStorageKey', 'thumbnailStorageKey']) {
		assert.throws(() => applyEditorCommand(project, {
			type: 'source/update',
			sourceId: 'source-1',
			changes: { [field]: `disposable-${field}` },
		}, { now: LATER }), new RegExp(`Source field cannot be updated: ${field}`, 'u'));
	}
});

test('bin-only sources remain live through metadata compaction and source removal is guarded', () => {
	const project = createBinFixture();
	let binned = applyEditorCommand(project, {
		type: 'project-bin/move-from-timeline',
		clipIds: ['clip-1'],
	}, { now: LATER });
	binned = applyEditorCommand(binned, {
		type: 'project-bin/remove',
		clipId: 'clip-2',
	}, { now: LATER });

	assert.deepEqual([...collectProjectSourceIds(binned)], ['source-1']);
	assert.deepEqual([...collectHistorySourceIds(createEditorHistory(binned))], ['source-1']);
	const session = createAudioEditorSessionController({ projects: [binned] });
	assert.deepEqual(session.getSnapshot().sourceReferenceCounts, { 'source-1': 1 });
	session.dispose();
	assert.deepEqual(compactProjectSourceMetadata(binned).sources.map((source) => source.id), ['source-1']);
	assert.throws(() => applyEditorCommand(binned, {
		type: 'source/remove',
		sourceId: 'source-1',
	}, { now: LATER }), /in use/);

	const emptyBin = applyEditorCommand(binned, {
		type: 'project-bin/remove',
		clipId: 'clip-1',
	}, { now: LATER });
	assert.deepEqual([...collectProjectSourceIds(emptyBin)], []);
	assert.deepEqual(compactProjectSourceMetadata(emptyBin).sources, []);
});
