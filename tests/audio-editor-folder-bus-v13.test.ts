/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	deriveFolderBusOwnershipV13,
	reconcileFolderBusesV13,
	validateFolderBusesV13,
} from '../src/common/editor/folder-bus-v13.ts';
import {
	createAudioEditorProjectV13,
	validateAudioEditorProjectV13,
	type AudioEditorProjectV13,
} from '../src/common/editor/project-v13.ts';
import { createAudioTrackV10 } from '../src/common/editor/project-v10.ts';

const NOW = '2026-08-10T09:00:00.000Z';

function node(kind: 'folder' | 'track', id: string, parentFolderId: string | null = null) {
	return { kind, id, parentFolderId };
}

/**
 * band            (top-level folder, owns a bus)
 *   drums         (nested folder, owns none)
 *     kick        (audio)
 *   bass          (audio)
 * picture         (top-level folder, video only, owns no bus)
 *   plate         (video)
 * vocals          (root audio track, no folder bus)
 */
function mixedProject(): AudioEditorProjectV13 {
	return createAudioEditorProjectV13({
		id: 'folder-bus', title: 'Folder bus', now: NOW, primarySequenceId: 'main',
		trackFolders: [
			{ id: 'band', name: 'Band' },
			{ id: 'drums', name: 'Drums' },
			{ id: 'picture', name: 'Picture' },
		],
		tracks: [
			createAudioTrackV10({ id: 'kick', name: 'Kick' }),
			createAudioTrackV10({ id: 'bass', name: 'Bass' }),
			{ ...createAudioTrackV10({ id: 'plate', name: 'Plate' }), type: 'video' },
			createAudioTrackV10({ id: 'vocals', name: 'Vocals' }),
		],
		sequences: [{
			id: 'main',
			trackNodes: [
				node('folder', 'band'),
				node('folder', 'drums', 'band'),
				node('track', 'kick', 'drums'),
				node('track', 'bass', 'band'),
				node('folder', 'picture'),
				node('track', 'plate', 'picture'),
				node('track', 'vocals'),
			],
		}],
	});
}

test('only a top-level folder holding audio owns a bus, and nested audio routes to it', () => {
	const project = mixedProject();
	const ownership = deriveFolderBusOwnershipV13(project.sequences, project.tracks);

	assert.deepEqual(ownership.busFolderIds, ['band']);
	assert.deepEqual([...ownership.busFolderIdByAudioTrackId.entries()], [
		['kick', 'band'],
		['bass', 'band'],
	]);
	assert.deepEqual([...ownership.folderIds].sort(), ['band', 'drums', 'picture']);

	const mixer = project.mixer as { groups: Record<string, unknown>[]; routes: Record<string, unknown> };
	const groups = mixer.groups;
	assert.deepEqual(groups.map(({ id }) => id), ['band']);
	assert.equal(groups[0].name, 'Band');
	assert.equal(groups[0].mute, false);
	assert.equal(groups[0].solo, false);

	const routes = mixer.routes as Record<string, { groupId: string | null }>;
	assert.equal(routes.kick.groupId, 'band');
	assert.equal(routes.bass.groupId, 'band');
	assert.equal(routes.vocals?.groupId ?? null, null);
	assert.equal(Object.hasOwn(routes, 'plate'), false);
});

test('a video-only top-level folder owns no bus and authors no route', () => {
	const project = mixedProject();
	const groupIds = ((project.mixer as { groups: { id: string }[] }).groups).map(({ id }) => id);
	assert.equal(groupIds.includes('picture'), false);
	assert.equal(groupIds.includes('drums'), false);
	assert.equal(validateAudioEditorProjectV13(project), true);
});

test('a missing, misnamed, or opinionated folder bus is rejected rather than repaired', () => {
	const base = mixedProject();

	const missing = structuredClone(base) as Record<string, unknown>;
	(missing.mixer as { groups: unknown[] }).groups = [];
	assert.throws(
		() => validateFolderBusesV13(missing),
		/Track folder band contains audio and must own a group bus\./u,
	);

	const misnamed = structuredClone(base) as Record<string, unknown>;
	((misnamed.mixer as { groups: Record<string, unknown>[] }).groups[0]).name = 'Renamed';
	assert.throws(
		() => validateFolderBusesV13(misnamed),
		/Group bus band must mirror its track folder name\./u,
	);

	const soloed = structuredClone(base) as Record<string, unknown>;
	((soloed.mixer as { groups: Record<string, unknown>[] }).groups[0]).solo = true;
	assert.throws(
		() => validateFolderBusesV13(soloed),
		/Group bus band must leave mute and solo to its track folder\./u,
	);
});

test('a bus naming a folder that owns none, and a stray route, are rejected', () => {
	const base = mixedProject();

	const strayBus = structuredClone(base) as Record<string, unknown>;
	(strayBus.mixer as { groups: Record<string, unknown>[] }).groups.push({
		...((strayBus.mixer as { groups: Record<string, unknown>[] }).groups[0]),
		id: 'drums',
		name: 'Drums',
	});
	assert.throws(
		() => validateFolderBusesV13(strayBus),
		/Group bus drums names a track folder that owns no bus\./u,
	);

	const strayRoute = structuredClone(base) as Record<string, unknown>;
	(strayRoute.mixer as { routes: Record<string, unknown> }).routes.vocals = {
		groupId: 'band',
		sends: {},
	};
	assert.throws(
		() => validateFolderBusesV13(strayRoute),
		/Audio track vocals cannot route to track folder bus band it does not belong to\./u,
	);

	const detached = structuredClone(base) as Record<string, unknown>;
	((detached.mixer as { routes: Record<string, { groupId: string | null }> }).routes.kick).groupId = null;
	assert.throws(
		() => validateFolderBusesV13(detached),
		/Audio track kick must route to its track folder bus band\./u,
	);
});

test('a send bus may not reuse a folder identity', () => {
	const project = structuredClone(mixedProject()) as Record<string, unknown>;
	(project.mixer as { sends: Record<string, unknown>[] }).sends.push({
		id: 'band', name: 'Band', color: '#8c6fd1', gain: 1, pan: 0,
		mute: false, solo: false, envelope: [], collapsed: true, effectsActive: true, effects: [],
	});
	assert.throws(
		() => validateFolderBusesV13(project),
		/Send bus band cannot reuse a track folder ID\./u,
	);
});

test('reconciliation mints, renames, and retires folder buses while preserving unrelated ones', () => {
	const project = structuredClone(mixedProject()) as Record<string, unknown>;
	const mixer = project.mixer as { groups: Record<string, unknown>[]; routes: Record<string, unknown> };
	const ordinary = { ...mixer.groups[0], id: 'ordinary-bus', name: 'Ordinary' };
	mixer.groups.push(ordinary);
	mixer.routes.vocals = { groupId: 'ordinary-bus', sends: {} };

	// Carry non-mirrored mix state so reconciliation is proven not to reset it.
	mixer.groups[0].gain = 0.5;
	mixer.groups[0].color = '#ff0000';
	(project.trackFolders as Record<string, unknown>[])[0].name = 'Ensemble';

	reconcileFolderBusesV13(project);

	const groups = mixer.groups;
	assert.deepEqual(groups.map(({ id }) => id), ['band', 'ordinary-bus']);
	assert.equal(groups[0].name, 'Ensemble');
	assert.equal(groups[0].gain, 0.5);
	assert.equal(groups[0].color, '#ff0000');
	assert.equal((mixer.routes.vocals as { groupId: string }).groupId, 'ordinary-bus');
	assert.doesNotThrow(() => validateFolderBusesV13(project));

	// Emptying the folder of audio retires its bus and clears the routes.
	const sequence = (project.sequences as { trackNodes: unknown[] }[])[0];
	sequence.trackNodes = sequence.trackNodes.filter((entry) => {
		const id = (entry as { id: string }).id;
		return id !== 'kick' && id !== 'bass' && id !== 'drums';
	});
	project.tracks = (project.tracks as { id: string }[]).filter(({ id }) => id !== 'kick' && id !== 'bass');
	project.trackFolders = (project.trackFolders as { id: string }[]).filter(({ id }) => id !== 'drums');
	delete (mixer.routes as Record<string, unknown>).kick;
	delete (mixer.routes as Record<string, unknown>).bass;

	reconcileFolderBusesV13(project);
	assert.deepEqual(mixer.groups.map(({ id }) => id), ['ordinary-bus']);
	assert.doesNotThrow(() => validateFolderBusesV13(project));
});
