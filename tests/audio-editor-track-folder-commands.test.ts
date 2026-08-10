/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { applyEditorCommand } from '../src/common/editor/commands.js';
import {
	createAddTrackFolderCommand,
	createMoveTrackNodeCommand,
	createRemoveTrackFolderCommand,
	createUpdateTrackFolderCommand,
} from '../src/common/editor/commands/factories.ts';
import type { AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';
import { assertEditorCommandCapabilities } from '../src/common/editor/controller/command-capability-policy.ts';
import {
	createEditorHistory,
	executeEditorCommand,
	redoEditorCommand,
	undoEditorCommand,
} from '../src/common/editor/history.js';
import { createAudioTrackV10 } from '../src/common/editor/project-v10.ts';
import {
	createAudioEditorProjectV14,
	validateAudioEditorProjectV14,
	type AudioEditorProjectV14,
} from '../src/common/editor/project-v14.ts';
import { PRODUCT_PROFILES } from '../src/common/products.js';

const NOW = '2026-08-10T12:00:00.000Z';

interface MixerShape {
	readonly groups: readonly Readonly<Record<string, unknown>>[];
	readonly sends: readonly Readonly<Record<string, unknown>>[];
	readonly routes: Readonly<Record<string, { readonly groupId: string | null }>>;
}

function mixerOf(project: object): MixerShape {
	return (project as { mixer: MixerShape }).mixer;
}

function nodeIds(project: AudioEditorProjectV14): readonly string[] {
	return project.sequences[0].trackNodes.map(({ id }) => id);
}

/**
 * band          (top-level folder, owns a bus)
 *   drums       (nested folder)
 *     kick
 *   bass
 * vocals        (root audio track)
 */
function folderedProject(): AudioEditorProjectV14 {
	return createAudioEditorProjectV14({
		id: 'folder-commands', title: 'Folder commands', now: NOW, primarySequenceId: 'main',
		trackFolders: [
			{ id: 'band', name: 'Band' },
			{ id: 'drums', name: 'Drums' },
		],
		tracks: [
			createAudioTrackV10({ id: 'kick', name: 'Kick' }),
			createAudioTrackV10({ id: 'bass', name: 'Bass' }),
			createAudioTrackV10({ id: 'vocals', name: 'Vocals' }),
		],
		sequences: [{
			id: 'main',
			trackNodes: [
				{ kind: 'folder', id: 'band', parentFolderId: null },
				{ kind: 'folder', id: 'drums', parentFolderId: 'band' },
				{ kind: 'track', id: 'kick', parentFolderId: 'drums' },
				{ kind: 'track', id: 'bass', parentFolderId: 'band' },
				{ kind: 'track', id: 'vocals', parentFolderId: null },
			],
		}],
	});
}

test('Soundscaper accepts folder-aware commands while Framescaper stays gated off', () => {
	const commands: readonly AudioEditorCommand[] = [
		createAddTrackFolderCommand('main', { id: 'folder-x', name: 'X' }),
		createUpdateTrackFolderCommand('band', { name: 'Renamed' }),
		createRemoveTrackFolderCommand('band', 'promote'),
		createMoveTrackNodeCommand('main', 'bass', null, 0),
	];
	for (const command of commands) {
		assert.doesNotThrow(() => assertEditorCommandCapabilities(
			command,
			PRODUCT_PROFILES.soundscaper.capabilities,
			'soundscaper',
		));
		assert.throws(
			() => assertEditorCommandCapabilities(command, PRODUCT_PROFILES.framescaper.capabilities, 'framescaper'),
			/does not support trackFolders/iu,
			`framescaper must reject ${command.type}`,
		);
	}
});

test('adding a folder places it child-relative and mints its bus only once audio arrives', () => {
	let project = folderedProject();
	project = applyEditorCommand(project, createAddTrackFolderCommand(
		'main',
		{ id: 'fx', name: 'FX' },
	), { now: NOW });
	assert.deepEqual(nodeIds(project), ['band', 'drums', 'kick', 'bass', 'vocals', 'fx']);
	// Video- or audio-free folders own nothing.
	assert.deepEqual(mixerOf(project).groups.map(({ id }) => id), ['band']);

	project = applyEditorCommand(project, createMoveTrackNodeCommand('main', 'vocals', 'fx', 0), { now: NOW });
	assert.deepEqual(mixerOf(project).groups.map(({ id }) => id), ['band', 'fx']);
	assert.equal(mixerOf(project).routes.vocals.groupId, 'fx');
	assert.equal(validateAudioEditorProjectV14(project), true);

	// Duplicate and bus-colliding identities reject before mutation.
	assert.throws(
		() => applyEditorCommand(project, createAddTrackFolderCommand('main', { id: 'band', name: 'Twin' }), { now: NOW }),
		/Duplicate track folder ID: band\./u,
	);
	assert.throws(
		() => applyEditorCommand(
			project,
			{ type: 'batch', commands: [
				{ type: 'mixer/bus-add', busType: 'send', bus: { id: 'aux', name: 'Aux' } },
				createAddTrackFolderCommand('main', { id: 'aux', name: 'Aux Folder' }),
			] },
			{ now: NOW },
		),
		/Track folder ID collides with mixer bus aux\./u,
	);
});

test('folder updates stay on the folder while the bus mirrors name and never mute or solo', () => {
	let project = folderedProject();
	project = applyEditorCommand(project, createUpdateTrackFolderCommand('band', {
		name: 'Ensemble', mute: true, solo: true, collapsed: true, height: 96, hidden: true,
	}), { now: NOW });
	const band = project.trackFolders.find(({ id }) => id === 'band');
	assert.deepEqual(band, {
		id: 'band', name: 'Ensemble', collapsed: true, height: 96, hidden: true, mute: true, solo: true,
	});
	const bus = mixerOf(project).groups.find(({ id }) => id === 'band');
	assert.equal(bus?.name, 'Ensemble');
	assert.equal(bus?.mute, false);
	assert.equal(bus?.solo, false);
	assert.equal(validateAudioEditorProjectV14(project), true);

	assert.throws(
		() => applyEditorCommand(project, createUpdateTrackFolderCommand('band', { id: 'other' }), { now: NOW }),
		/Track folder identity is immutable\./u,
	);
	assert.throws(
		() => applyEditorCommand(project, createUpdateTrackFolderCommand('band', { clipIds: [] }), { now: NOW }),
		/unsupported field/iu,
	);
	assert.throws(
		() => applyEditorCommand(project, createUpdateTrackFolderCommand('ghost', { name: 'X' }), { now: NOW }),
		/Unknown track folder: ghost\./u,
	);
});

test('promote lifts children, retires the bus when audio leaves, and delete-contents cleans dependents', () => {
	const base = folderedProject();

	const promoted = applyEditorCommand(base, createRemoveTrackFolderCommand('band', 'promote'), { now: NOW });
	assert.deepEqual(nodeIds(promoted), ['drums', 'kick', 'bass', 'vocals']);
	assert.deepEqual(promoted.trackFolders.map(({ id }) => id), ['drums']);
	// drums is now top-level and holds kick, so ownership transfers to it.
	assert.deepEqual(mixerOf(promoted).groups.map(({ id }) => id), ['drums']);
	assert.equal(mixerOf(promoted).routes.kick.groupId, 'drums');
	assert.equal(mixerOf(promoted).routes.bass.groupId, null);
	assert.equal(validateAudioEditorProjectV14(promoted), true);

	const withRouteState = applyEditorCommand(base, {
		type: 'mixer/route-update', trackId: 'vocals', changes: { groupId: null, sends: {} },
	}, { now: NOW });
	const deleted = applyEditorCommand(
		withRouteState,
		createRemoveTrackFolderCommand('band', 'delete-contents'),
		{ now: NOW },
	);
	assert.deepEqual(nodeIds(deleted), ['vocals']);
	assert.deepEqual(deleted.trackFolders, []);
	assert.deepEqual(deleted.tracks.map(({ id }) => id), ['vocals']);
	assert.deepEqual(mixerOf(deleted).groups, []);
	assert.deepEqual(Object.keys(mixerOf(deleted).routes), ['vocals']);
	assert.equal(validateAudioEditorProjectV14(deleted), true);

	assert.throws(
		() => applyEditorCommand(base, {
			type: 'track-folder/remove', folderId: 'band', disposition: 'flatten',
		} as unknown as AudioEditorCommand, { now: NOW }),
		/explicit promote or delete-contents disposition/u,
	);
});

test('moves keep buses, routes, and preorder consistent in one undoable step', () => {
	const history = createEditorHistory(folderedProject());
	const moved = executeEditorCommand(history, createMoveTrackNodeCommand('main', 'drums', null, 0), { now: NOW });
	assert.deepEqual(nodeIds(moved.present as AudioEditorProjectV14), ['drums', 'kick', 'band', 'bass', 'vocals']);
	const mixer = mixerOf(moved.present as AudioEditorProjectV14);
	assert.deepEqual(mixer.groups.map(({ id }) => id).sort(), ['band', 'drums']);
	assert.equal(mixer.routes.kick.groupId, 'drums');
	assert.equal(mixer.routes.bass.groupId, 'band');
	assert.equal(validateAudioEditorProjectV14(moved.present), true);

	const undone = undoEditorCommand(moved);
	assert.deepEqual(nodeIds(undone.present as AudioEditorProjectV14), ['band', 'drums', 'kick', 'bass', 'vocals']);
	assert.deepEqual(mixerOf(undone.present as AudioEditorProjectV14).groups.map(({ id }) => id), ['band']);
	assert.equal(validateAudioEditorProjectV14(undone.present), true);

	const redone = redoEditorCommand(undone);
	assert.deepEqual(nodeIds(redone.present as AudioEditorProjectV14), ['drums', 'kick', 'band', 'bass', 'vocals']);
	assert.equal(validateAudioEditorProjectV14(redone.present), true);
});

test('direct mixer edits cannot break a folder bus mirror or ownership', () => {
	const project = folderedProject();
	assert.throws(
		() => applyEditorCommand(project, {
			type: 'mixer/bus-update', busType: 'group', busId: 'band', changes: { name: 'Detached' },
		}, { now: NOW }),
		/mirrors its folder; edit the folder name instead/u,
	);
	assert.throws(
		() => applyEditorCommand(project, {
			type: 'mixer/bus-update', busType: 'group', busId: 'band', changes: { solo: true },
		}, { now: NOW }),
		/edit the folder solo instead/u,
	);
	const regained = applyEditorCommand(project, {
		type: 'mixer/bus-update', busType: 'group', busId: 'band', changes: { gain: 0.5, color: '#123456' },
	}, { now: NOW });
	const bus = mixerOf(regained).groups.find(({ id }) => id === 'band');
	assert.equal(bus?.gain, 0.5);
	assert.equal(validateAudioEditorProjectV14(regained), true);

	assert.throws(
		() => applyEditorCommand(project, {
			type: 'mixer/bus-remove', busType: 'group', busId: 'band',
		}, { now: NOW }),
		/remove or empty the folder instead/u,
	);
	assert.throws(
		() => applyEditorCommand(project, {
			type: 'mixer/route-update', trackId: 'kick', changes: { groupId: null },
		}, { now: NOW }),
		/routes through its folder bus; move the track out of the folder instead/u,
	);
});

test('legacy structural commands compose with folder-aware ones on a foldered document', () => {
	const project = folderedProject();
	const combined = applyEditorCommand(project, {
		type: 'batch',
		commands: [
			createMoveTrackNodeCommand('main', 'vocals', 'band', 0),
			{ type: 'track/remove', trackId: 'vocals' },
		],
	}, { now: NOW });
	assert.deepEqual(nodeIds(combined), ['band', 'drums', 'kick', 'bass']);
	assert.equal(validateAudioEditorProjectV14(combined), true);
});

test('a folder created mid-batch cannot follow a root-hierarchy structural edit', () => {
	const rootOnly = createAudioEditorProjectV14({
		id: 'root-only', title: 'Root only', now: NOW, primarySequenceId: 'main',
		tracks: [createAudioTrackV10({ id: 'vocals', name: 'Vocals' })],
		sequences: [{ id: 'main', trackNodes: [{ kind: 'track', id: 'vocals', parentFolderId: null }] }],
	});
	assert.throws(
		() => applyEditorCommand(rootOnly, {
			type: 'batch',
			commands: [
				{ type: 'track/remove', trackId: 'vocals' },
				createAddTrackFolderCommand('main', { id: 'late', name: 'Late' }),
			],
		}, { now: NOW }),
		/cannot mix folder-aware and legacy structural track commands/u,
	);
});
