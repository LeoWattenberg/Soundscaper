import test from 'node:test';
import assert from 'node:assert/strict';

import { applyEditorCommand } from '../src/lib/tools/audio-editor/commands.js';
import {
	createEditorHistory,
	executeEditorCommand,
	undoEditorCommand,
} from '../src/lib/tools/audio-editor/history.js';
import {
	migrateAudioEditorProject,
	migrateAudioEditorProjectV2ToV3,
	migrateAudioEditorProjectV3ToV4,
	migrateAudioEditorProjectV4ToV5,
} from '../src/lib/tools/audio-editor/migration.js';
import {
	findProjectBinClip,
	projectDurationFrames,
	validateAudioEditorProject,
} from '../src/lib/tools/audio-editor/project.js';
import {
	createAudioClipV2,
	createAudioEditorProjectV2,
	createAudioSourceV2,
	createAudioTrackV2,
	loadAudioEditorProjectV2,
} from '../src/lib/tools/audio-editor/project-v2.js';
import {
	AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION,
	createAudioEditorProjectV3,
	loadAudioEditorProjectV3,
	validateAudioEditorProjectV3,
} from '../src/lib/tools/audio-editor/project-v3.js';
import {
	collectHistorySourceIds,
	collectProjectSourceIds,
	compactProjectSourceMetadata,
} from '../src/lib/tools/audio-editor/retention.js';
import { createAudioEditorSessionController } from '../src/lib/tools/audio-editor/session.js';

const NOW = '2026-07-18T10:00:00.000Z';
const LATER = '2026-07-18T10:01:00.000Z';

function createBinFixture() {
	const source = createAudioSourceV2({
		id: 'source-1',
		name: 'voice.wav',
		storageKey: 'pcm/source-1',
		frameCount: 1_000,
		channelCount: 2,
	});
	const first = createAudioClipV2({
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
	const second = createAudioClipV2({
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
	return createAudioEditorProjectV3({
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
			createAudioTrackV2({ id: 'track-1', clipIds: [first.id] }),
			createAudioTrackV2({ id: 'track-2', clipIds: [second.id] }),
		],
	});
}

test('V3 adds an empty project bin and V2 migration is atomic', () => {
	const v2 = createAudioEditorProjectV2({ id: 'v2-project', title: 'V2', now: NOW });
	const rollback = structuredClone(v2);
	const migrated = migrateAudioEditorProjectV2ToV3(v2);

	assert.deepEqual(v2, rollback);
	assert.equal(migrated.schemaVersion, AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION);
	assert.deepEqual(migrated.projectBin, { clips: [] });
	assert.equal(Object.hasOwn(migrated.opaqueExtensions, 'projectBin'), false);
	assert.equal(validateAudioEditorProjectV3(migrated), true);
	assert.deepEqual(loadAudioEditorProjectV2(migrated), {
		project: migrated,
		readOnly: true,
		reason: 'newer-schema',
	});
	assert.deepEqual(migrateAudioEditorProject(v2), {
		project: migrateAudioEditorProjectV4ToV5(migrateAudioEditorProjectV3ToV4(migrated)),
		migrated: true,
		fromVersion: 2,
		readOnly: false,
		reason: null,
	});
	assert.equal(migrateAudioEditorProject(migrated).migrated, true);

	const future = { ...migrated, schemaVersion: 4, futureData: { retained: true } };
	assert.deepEqual(loadAudioEditorProjectV3(future), {
		project: future,
		readOnly: true,
		reason: 'newer-schema',
	});
});

test('V3 validation checks bin bounds, cross-collection IDs, and timeline-only selections', () => {
	const project = createBinFixture();
	const binClip = { ...project.clips[0], id: 'bin-clip', groupId: null };
	const withBin = createAudioEditorProjectV3({
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
	assert.equal(validateAudioEditorProjectV3(withBin), true);
	assert.equal(validateAudioEditorProject(withBin), true);
	assert.equal(projectDurationFrames(withBin), 800);
	assert.equal(findProjectBinClip(withBin, binClip.id).title, 'First');

	assert.throws(() => validateAudioEditorProjectV3({
		...withBin,
		projectBin: { clips: [{ ...binClip, id: withBin.clips[0].id }] },
	}), /Duplicate clip ID/);
	assert.throws(() => validateAudioEditorProjectV3({
		...withBin,
		projectBin: { clips: [{ ...binClip, sourceStartFrame: 900, sourceDurationFrames: 200 }] },
	}), /source bounds/);
	assert.throws(() => validateAudioEditorProjectV3({
		...withBin,
		selection: { ...withBin.selection, clipIds: [binClip.id] },
	}), /missing clip/);
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
	assert.deepEqual(findProjectBinClip(history.present, 'clip-1'), { ...originalFirst, groupId: null });

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
