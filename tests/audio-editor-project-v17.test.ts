/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

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
	isTakeCompProjectSchema,
	isVideoRetimeCurveProjectSchema,
} from '../src/common/editor/project-schema-version.ts';
import {
	createAudioSourceV10,
	createAudioTrackV10,
} from '../src/common/editor/project-v10.ts';
import { createAudioEditorProjectV16 } from '../src/common/editor/project-v16.ts';
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

function options(takeGroups: readonly unknown[] = [group()]): Record<string, unknown> {
	return {
		id: 'take-comp-project', title: 'Take comp project', now: NOW,
		sources: [
			createAudioSourceV10({
				id: 'source-a', name: 'Take A', frameCount: 1_000, channelCount: 1, sampleRate: 48_000,
			}),
			createAudioSourceV10({
				id: 'source-b', name: 'Take B', frameCount: 1_000, channelCount: 1, sampleRate: 48_000,
			}),
		],
		tracks: [createAudioTrackV10({ id: 'track-a', name: 'Vocal', clipIds: [] })],
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

test('V17 defaults to no take groups and does not invent optional feature state', () => {
	const project = createAudioEditorProjectV17(options([]));
	assert.deepEqual(project.takeGroups, []);
	assert.equal(project.featureRequirements.requirements.some(
		({ id }) => id === PROJECT_OWNED_FEATURE_REQUIREMENT_IDS.takeComp,
	), false);
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

	const v16 = createAudioEditorProjectV16({ id: 'historical-v16', now: NOW });
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
