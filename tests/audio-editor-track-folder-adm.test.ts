/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { applyEditorCommand } from '../src/common/editor/commands.js';
import {
	createAddTrackFolderCommand,
	createMoveTrackNodeCommand,
	createUpdateTrackFolderCommand,
} from '../src/common/editor/commands/factories.ts';
import {
	createAudioTrack,
} from '../src/common/editor/project-media-factory.ts';
import {
	createCurrentAudioEditorProject,
	validateCurrentAudioEditorProject,
	type AudioEditorProjectCurrent,
} from '../src/common/editor/project-current.ts';

const NOW = '2026-08-10T15:00:00.000Z';
const PINNED = /ADM authored programme pins its terminal strips/u;

/**
 * Authored 5.1 programme over a foldered document whose bed assignments
 * target the folder bus (a group terminal strip) and a root track terminal.
 */
function authoredFolderedProject(): AudioEditorProjectCurrent {
	return createCurrentAudioEditorProject({
		id: 'adm-folders', title: 'ADM folders', now: NOW, primarySequenceId: 'main',
		metadata: {
			adm: {
				mode: 'authored',
				programme: { name: 'Main programme', language: 'eng' },
				content: { name: 'Main content', language: 'eng' },
				bed: {
					name: '5.1 bed',
					layout: '5.1',
					assignments: [
						{ stripKind: 'track', stripId: 'dialogue', sourceChannel: 0, bedChannel: 'C' },
						{ stripKind: 'group', stripId: 'music', sourceChannel: 0, bedChannel: 'L', gain: 0.8 },
					],
				},
			},
		},
		trackFolders: [{ id: 'music', name: 'Music' }],
		tracks: [
			createAudioTrack({ id: 'strings', name: 'Strings' }),
			createAudioTrack({ id: 'dialogue', name: 'Dialogue' }),
		],
		sequences: [{
			id: 'main',
			trackNodes: [
				{ kind: 'folder', id: 'music', parentFolderId: null },
				{ kind: 'track', id: 'strings', parentFolderId: 'music' },
				{ kind: 'track', id: 'dialogue', parentFolderId: null },
			],
		}],
	});
}

test('an authored programme refuses folder edits that would change bus ownership', () => {
	const project = authoredFolderedProject();
	const snapshot = structuredClone(project);

	// Moving the dialogue terminal into the folder re-terminals it through the bus.
	assert.throws(
		() => applyEditorCommand(project, createMoveTrackNodeCommand('main', 'dialogue', 'music', 0), { now: NOW }),
		PINNED,
	);
	// Moving strings out retires the music bus that carries a bed assignment.
	assert.throws(
		() => applyEditorCommand(project, createMoveTrackNodeCommand('main', 'strings', null, 0), { now: NOW }),
		PINNED,
	);
	// Legacy structural commands on the foldered authored document refuse too.
	assert.throws(
		() => applyEditorCommand(project, { type: 'track/reorder', trackId: 'dialogue', index: 0 }, { now: NOW }),
		PINNED,
	);
	assert.deepEqual(project, snapshot);
});

test('ownership-neutral folder edits stay available on an authored programme', () => {
	const project = authoredFolderedProject();

	const renamed = applyEditorCommand(
		project,
		createUpdateTrackFolderCommand('music', { name: 'Score', collapsed: true }),
		{ now: NOW },
	);
	const bus = (renamed.mixer as { groups: readonly { id: string; name: string }[] })
		.groups.find(({ id }) => id === 'music');
	assert.equal(bus?.name, 'Score');
	assert.equal(validateCurrentAudioEditorProject(renamed), true);

	// An empty folder owns no bus, so creating one changes no ownership.
	const grown = applyEditorCommand(
		renamed,
		createAddTrackFolderCommand('main', { id: 'ambience', name: 'Ambience' }),
		{ now: NOW },
	);
	assert.equal(validateCurrentAudioEditorProject(grown), true);
});
