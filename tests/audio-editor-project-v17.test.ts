/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { applyEditorCommand } from '../src/common/editor/commands.js';

import {
	AudioEditorProjectReimportRequiredError,
	migrateAudioEditorProject,
} from '../src/common/editor/migration.js';
import {
	cloneCurrentAudioEditorProject,
	createCurrentAudioEditorProject,
	loadCurrentAudioEditorProject,
	validateCurrentAudioEditorProject,
} from '../src/common/editor/project-current.ts';
import {
	AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION,
	FRAMESCAPER_PROJECT_V19_SCHEMA_VERSION,
	SOUNDSCAPER_PROJECT_V21_SCHEMA_VERSION,
	SOUNDSCAPER_PROJECT_V23_SCHEMA_VERSION,
	isActiveAudioEditorProjectSchema,
	isTakeCompProjectSchema,
	isVideoRetimeCurveProjectSchema,
} from '../src/common/editor/project-schema-version.ts';
import {
	createAudioClip,
	createAudioSource,
	createAudioTrack,
} from '../src/common/editor/project-media-factory.ts';
import {
	AUDIO_EDITOR_PROJECT_V17_SCHEMA_VERSION,
	cloneAudioEditorProjectV17,
	createAudioEditorProjectV17,
	loadAudioEditorProjectV17,
	validateAudioEditorProjectV17,
} from '../src/common/editor/project-v17.ts';
import {
	PROJECT_FEATURE_AUDIO_CAPABILITY_IDS,
	PROJECT_FEATURE_CAPABILITY_IDS,
	PROJECT_FEATURE_VIDEO_CAPABILITY_IDS,
} from '../src/common/editor/project-feature-capabilities.ts';
import { PROJECT_OWNED_FEATURE_REQUIREMENT_IDS } from '../src/common/editor/project-owned-feature-requirements.ts';
import { normalizeProjectFeatureRequirements } from '../src/common/editor/project-feature-requirements.ts';

const NOW = '2026-08-12T10:00:00.000Z';

test('active audio-authoring schemas admit V17 and Soundscaper V21/V23 only', () => {
	assert.equal(isActiveAudioEditorProjectSchema(AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION), true);
	assert.equal(isActiveAudioEditorProjectSchema(SOUNDSCAPER_PROJECT_V21_SCHEMA_VERSION), true);
	assert.equal(isActiveAudioEditorProjectSchema(SOUNDSCAPER_PROJECT_V23_SCHEMA_VERSION), true);
	assert.equal(isActiveAudioEditorProjectSchema(16), false);
	assert.equal(isActiveAudioEditorProjectSchema(FRAMESCAPER_PROJECT_V19_SCHEMA_VERSION), false);
	assert.equal(isActiveAudioEditorProjectSchema(SOUNDSCAPER_PROJECT_V21_SCHEMA_VERSION + 1), false);
});

function options(takeGroups: readonly unknown[] = [group()]): Record<string, unknown> {
	return {
		id: 'take-comp-project', title: 'Take comp project', now: NOW,
		sources: [
			createAudioSource({
				id: 'source-a', name: 'Take A', frameCount: 1_000, channelCount: 1, sampleRate: 48_000,
			}),
			createAudioSource({
				id: 'source-b', name: 'Take B', frameCount: 1_000, channelCount: 1, sampleRate: 48_000,
			}),
		],
		tracks: [createAudioTrack({ id: 'track-a', name: 'Vocal', clipIds: [] })],
		sequences: [{ id: 'main-sequence', trackIds: ['track-a'] }],
		primarySequenceId: 'main-sequence',
		takeGroups,
	};
}

function group(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		id: 'group-a', sequenceId: 'main-sequence', trackId: 'track-a',
		startSample: 100, endSample: 500,
		laneOrder: ['lane-b', 'lane-a'],
		lanes: [{ id: 'lane-a' }, { id: 'lane-b' }],
		takes: [
			{
				id: 'take-a', laneId: 'lane-a', sourceId: 'source-a',
				startSample: 100, endSample: 500, sourceStartSample: 0,
			},
			{
				id: 'take-b', laneId: 'lane-b', sourceId: 'source-b',
				startSample: 200, endSample: 500, sourceStartSample: 25,
			},
		],
		compRegions: [
			{ id: 'region-a', takeId: 'take-a', startSample: 100, endSample: 250 },
			{ id: 'region-b', takeId: 'take-b', startSample: 250, endSample: 500 },
		],
		...overrides,
	};
}

test('V17 creates canonical take/comp state and its reserved no-fallback requirement', () => {
	const project = createAudioEditorProjectV17(options());

	assert.equal(project.schemaVersion, 17);
	assert.deepEqual(project.takeGroups, [{
		...group(),
		lanes: [{ id: 'lane-b' }, { id: 'lane-a' }],
		takes: [
			{
				id: 'take-b', laneId: 'lane-b', sourceId: 'source-b',
				startSample: 200, endSample: 500, sourceStartSample: 25,
			},
			{
				id: 'take-a', laneId: 'lane-a', sourceId: 'source-a',
				startSample: 100, endSample: 500, sourceStartSample: 0,
			},
		],
	}]);
	assert.equal(Object.isFrozen(project.takeGroups), true);
	assert.equal(Object.isFrozen(project.takeGroups[0]), true);
	assert.equal(validateAudioEditorProjectV17(project), true);
	assert.equal(validateCurrentAudioEditorProject(project), true);
	assert.deepEqual(project.featureRequirements.requirements.find(
		({ id }) => id === PROJECT_OWNED_FEATURE_REQUIREMENT_IDS.takeComp,
	), {
		id: 'soundscaper.take-comp',
		featureId: PROJECT_FEATURE_CAPABILITY_IDS.takeComp,
		displayName: 'Take lanes and comps',
		disposition: 'bypass',
		fallback: null,
	});
});

test('valid Project Bin warp state places as a distinct native timeline clip', () => {
	const source = createAudioSource({
		id: 'bin-warp-source', storageKey: 'bin-warp-source',
		frameCount: 1_000, channelCount: 1, sampleRate: 48_000,
	});
	const warpMap = {
		feature: 'audio-warp' as const,
		points: [
			{ outer: 0, source: 100, mode: 'forward' as const },
			{ outer: 250, source: 300, mode: 'forward' as const },
			{ outer: 500, source: 600, mode: 'forward' as const },
		],
	};
	const binClip = createAudioClip({
		id: 'bin-warp-clip', binItemId: 'bin-warp-clip', sourceId: source.id,
		timelineStartFrame: 0, durationFrames: 500,
		sourceStartFrame: 100, sourceDurationFrames: 500, warpMap,
	});
	const project = createAudioEditorProjectV17({
		id: 'bin-warp-project', title: 'Project Bin warp', now: NOW,
		sources: [source], clips: [],
		tracks: [createAudioTrack({ id: 'track-a', name: 'Audio', clipIds: [] })],
		projectBin: { clips: [binClip] },
	});
	const placed = applyEditorCommand(project, {
		type: 'project-bin/place', binClipId: String(binClip.id),
		trackId: 'track-a', timelineStartFrame: 200, clipId: 'placed-warp-clip',
	}, { now: NOW });
	const timelineClip = placed.clips.find(({ id }) => id === 'placed-warp-clip');
	assert.ok(timelineClip);
	assert.notEqual(timelineClip.id, binClip.id);
	assert.equal(timelineClip.binItemId, null);
	assert.deepEqual(timelineClip.warpMap, binClip.warpMap);
	assert.equal(validateAudioEditorProjectV17(placed), true);
});

test('V17 defaults to no take groups and does not invent optional feature state', () => {
	const project = createAudioEditorProjectV17(options([]));
	assert.deepEqual(project.takeGroups, []);
	assert.equal(project.featureRequirements.requirements.some(
		({ id }) => id === PROJECT_OWNED_FEATURE_REQUIREMENT_IDS.takeComp,
	), false);
});

test('V17 accepts only timeline warp maps with complete native runtime authority', () => {
	const warpOptions = (overrides: Record<string, unknown> = {}) => ({
		...options([]),
		clips: [createAudioClip({
			id: 'warp-clip', kind: 'audio', sourceId: 'source-a', anchor: 'sample',
			timelineStartFrame: 0, durationFrames: 100,
			sourceStartFrame: 10, sourceDurationFrames: 200,
			warpMap: { feature: 'audio-warp', points: [
				{ outer: 0, source: 10, mode: 'forward' },
				{ outer: 100, source: 210, mode: 'forward' },
			] },
			...overrides,
		})],
		tracks: [createAudioTrack({ id: 'track-a', name: 'Vocal', clipIds: ['warp-clip'] })],
	});
	assert.equal(validateAudioEditorProjectV17(createAudioEditorProjectV17(warpOptions())), true);
	for (const warpMap of [
		{ feature: 'audio-warp', points: [
			{ outer: 1, source: 10, mode: 'forward' }, { outer: 100, source: 210, mode: 'forward' },
		] },
		{ feature: 'audio-warp', points: [
			{ outer: 0, source: 0, mode: 'forward' }, { outer: 100, source: 210, mode: 'forward' },
		] },
	] as const) {
		assert.throws(() => createAudioEditorProjectV17(warpOptions({ warpMap })), /native runtime authority/iu);
	}
	assert.throws(() => createAudioEditorProjectV17(warpOptions({ reversed: true })), /native runtime authority/iu);
	assert.throws(() => createAudioEditorProjectV17(warpOptions({
		anchor: 'musical', musicalExtent: 'fixedSamples', musicalStartBeat: 0,
	})), /native runtime authority/iu);
	const musical = createAudioEditorProjectV17(warpOptions({
		anchor: 'musical', musicalExtent: 'beat', musicalStartBeat: 0,
		musicalDurationBeats: 1,
		warpMap: { feature: 'audio-warp', points: [
			{ outer: 0, source: 10, mode: 'forward' },
			{ outer: 1, source: 210, mode: 'forward' },
		] },
	}));
	assert.equal(validateAudioEditorProjectV17(musical), true);

	const valid = createAudioEditorProjectV17(warpOptions());
	const authoredBinClip = { ...valid.clips[0], id: 'bin-warp', binItemId: 'bin-warp' };
	const binProject = { ...valid, clips: [], tracks: [
		{ ...valid.tracks[0], clipIds: [] },
	], projectBin: { ...valid.projectBin, clips: [authoredBinClip] } };
	assert.equal(validateAudioEditorProjectV17(binProject), true);
	const reopened = loadAudioEditorProjectV17(binProject);
	assert.equal(reopened.readOnly, false);
	assert.deepEqual(
		((reopened.project as typeof valid).projectBin.clips[0] as Record<string, unknown>)?.warpMap,
		(authoredBinClip as Record<string, unknown>).warpMap,
	);
	const malformedBin = structuredClone(binProject);
	(malformedBin.projectBin.clips[0] as Record<string, unknown>).warpMap = {
		feature: 'audio-warp', points: [
			{ outer: 0, source: 0, mode: 'forward' },
			{ outer: 99, source: 210, mode: 'forward' },
		],
	};
	assert.throws(() => validateAudioEditorProjectV17(malformedBin), /insertable runtime authority/iu);
});

test('take/comp state is bypass-only and refuses rendered fallback substitution', () => {
	assert.equal(
		new Set<string>(PROJECT_FEATURE_AUDIO_CAPABILITY_IDS).has(PROJECT_FEATURE_CAPABILITY_IDS.takeComp),
		false,
	);
	assert.equal(
		new Set<string>(PROJECT_FEATURE_VIDEO_CAPABILITY_IDS).has(PROJECT_FEATURE_CAPABILITY_IDS.takeComp),
		false,
	);
	for (const [kind, role] of [
		['audio', 'project-audio-mix-v1'],
		['video', 'project-video-render-v1'],
	] as const) {
		assert.throws(() => normalizeProjectFeatureRequirements({
			schemaVersion: 2,
			requirements: [{
				id: `publisher-${kind}-take-comp-render`,
				featureId: PROJECT_FEATURE_CAPABILITY_IDS.takeComp,
				displayName: 'Take lanes and comps',
				disposition: 'rendered-fallback',
				fallback: {
					role,
					kind,
					sourceId: `fallback-${kind}`,
					sha256: 'ab'.repeat(32),
				},
			}],
		}, {
			sources: [{ id: `fallback-${kind}`, kind }],
			clips: [],
			tracks: [],
		}), /not eligible for an? (?:audio|video) rendered fallback/iu);
	}
	assert.throws(() => createAudioEditorProjectV17({
		...options(),
		featureRequirements: {
			schemaVersion: 2,
			requirements: [{
				id: 'publisher-take-comp-bypass',
				featureId: PROJECT_FEATURE_CAPABILITY_IDS.takeComp,
				displayName: 'Publisher take comps',
				disposition: 'bypass',
				fallback: null,
			}],
		},
	}), /reserved.*take-comp.*requirement conflicts with publisher data/iu);
});

test('V17 validates ownership, source bounds, take coverage, ordering, and global identities', () => {
	for (const [invalid, message] of [
		[group({ sequenceId: 'missing' }), /sequence/u],
		[group({ trackId: 'missing' }), /track/u],
		[group({ takes: [{
			id: 'take-a', laneId: 'lane-a', sourceId: 'missing',
			startSample: 100, endSample: 500, sourceStartSample: 0,
		}] }), /source/u],
		[group({ takes: [{
			id: 'take-a', laneId: 'lane-a', sourceId: 'source-a',
			startSample: 100, endSample: 500, sourceStartSample: 800,
		}] }), /source bounds/u],
		[group({ compRegions: [{
			id: 'region-b', takeId: 'take-b', startSample: 100, endSample: 250,
		}] }), /available take span/u],
	] as const) {
		assert.throws(() => createAudioEditorProjectV17(options([invalid])), message);
	}
	assert.throws(
		() => createAudioEditorProjectV17(options([
			group(),
			group({ id: 'group-b', startSample: 400, endSample: 600,
				lanes: [{ id: 'lane-c' }], laneOrder: ['lane-c'],
				takes: [{ id: 'take-c', laneId: 'lane-c', sourceId: 'source-a', startSample: 400, endSample: 600, sourceStartSample: 0 }],
				compRegions: [] }),
		])),
		/overlap/u,
	);
	assert.throws(
		() => createAudioEditorProjectV17(options([
			group(),
			group({ id: 'group-b', trackId: 'track-a', startSample: 600, endSample: 800,
				lanes: [{ id: 'lane-a' }], laneOrder: ['lane-a'],
				takes: [{ id: 'take-c', laneId: 'lane-a', sourceId: 'source-a', startSample: 600, endSample: 800, sourceStartSample: 0 }],
				compRegions: [] }),
		])),
		/Duplicate take\/comp identity lane-a/u,
	);
});

test('V17 clone, current aliases, and raw load preserve take/comp state without aliases', () => {
	const project = createAudioEditorProjectV17(options());
	const clone = cloneAudioEditorProjectV17(project);
	const loaded = loadAudioEditorProjectV17(project);
	const current = createCurrentAudioEditorProject(options());

	assert.deepEqual(clone, project);
	assert.notStrictEqual(clone, project);
	assert.notStrictEqual(clone.takeGroups, project.takeGroups);
	assert.notStrictEqual(clone.takeGroups[0], project.takeGroups[0]);
	assert.deepEqual(loaded, { project, readOnly: false, reason: null });
	assert.notStrictEqual(loaded.project, project);
	assert.deepEqual(current, project);
	assert.deepEqual(cloneCurrentAudioEditorProject(current), project);
	assert.deepEqual(loadCurrentAudioEditorProject(current), { project, readOnly: false, reason: null });
});

test('V17 is the sole current schema while V16 reimports and V18 remains opaque', () => {
	assert.equal(AUDIO_EDITOR_PROJECT_V17_SCHEMA_VERSION, 17);
	assert.equal(AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION, 17);
	assert.equal(isTakeCompProjectSchema(17), true);
	assert.equal(isTakeCompProjectSchema(16), false);
	assert.equal(isVideoRetimeCurveProjectSchema(17), true);

	const v16 = {
		...createAudioEditorProjectV17({ id: 'historical-v16', now: NOW }),
		schemaVersion: 16,
	};
	assert.throws(
		() => migrateAudioEditorProject(v16),
		(error: unknown) => error instanceof AudioEditorProjectReimportRequiredError,
	);
	const project = createAudioEditorProjectV17(options());
	const future = { ...project, schemaVersion: 18, future: { retained: true } };
	assert.deepEqual(migrateAudioEditorProject(future), {
		project: future, migrated: false, fromVersion: 18, readOnly: true, reason: 'newer-schema',
	});
});
