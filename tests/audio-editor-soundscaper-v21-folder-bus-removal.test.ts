/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createAudioTrack,
} from '../src/common/editor/project-media-factory.ts';
import { applySoundscaperProjectCommand } from '../src/soundscaper/editor-project-commands.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';

/**
 * A removed folder takes its bus with it, on the production revisions too.
 *
 * A folder that contains audio owns a group bus, and the folder authority holds
 * that group's name, mute, solo, and existence — the mixer refuses to edit them
 * directly. The shared removal knows those identities and retires the bus with
 * the folder, because once the folder record is gone nothing can tell that bus
 * from one a user made.
 *
 * The V21 graph is rebuilt from the previous mixer after an inherited command,
 * since the command projects a V17-shaped mixer that cannot state V21 authority.
 * That rebuild also restored the bus the removal had just retired. The folder
 * reconciler then read it as an ordinary group, kept the track's assignment
 * pointing into it, and suppressed the fallback assignment to master — leaving
 * the track feeding a bus for a folder that no longer exists.
 */

const NOW = '2026-08-19T12:00:00.000Z';

test('removing a folder retires the bus it owned and the routes into it', () => {
	const foldered = applySoundscaperProjectCommand(project(), {
		type: 'batch',
		commands: [
			{ type: 'track-folder/add', folder: { id: 'stems', name: 'Stems' }, sequenceId: 'main-sequence' },
			{
				type: 'track-node/move', sequenceId: 'main-sequence',
				nodeId: 'voice', parentFolderId: 'stems', index: 0,
			},
		],
	} as never, { now: NOW });
	assert.deepEqual(foldered.mixer.groups.map(({ id }) => id), ['stems']);
	assert.ok(foldered.mixer.edges.some(({ id }) => id === 'assignment:track:voice:mixer-node:stems'));

	const removed = applySoundscaperProjectCommand(foldered, {
		type: 'track-folder/remove', folderId: 'stems', sequenceId: 'main-sequence',
		disposition: 'promote',
	} as never, { now: NOW });

	assert.deepEqual(removed.trackFolders, []);
	assert.deepEqual(removed.mixer.groups, [], 'the bus belonged to the folder that is gone');
	assert.deepEqual(
		removed.mixer.edges.map(({ id }) => id).sort(),
		[
			'assignment:master:output:main',
			'assignment:track:guitar:master',
			'assignment:track:voice:master',
		],
		'and the track reaches the mix directly again',
	);
});

test('removing one folder leaves another folder its bus', () => {
	const foldered = applySoundscaperProjectCommand(project(), {
		type: 'batch',
		commands: [
			{ type: 'track-folder/add', folder: { id: 'stems', name: 'Stems' }, sequenceId: 'main-sequence' },
			{ type: 'track-folder/add', folder: { id: 'music', name: 'Music' }, sequenceId: 'main-sequence' },
			{
				type: 'track-node/move', sequenceId: 'main-sequence',
				nodeId: 'voice', parentFolderId: 'stems', index: 0,
			},
			{
				type: 'track-node/move', sequenceId: 'main-sequence',
				nodeId: 'guitar', parentFolderId: 'music', index: 0,
			},
		],
	} as never, { now: NOW });
	assert.deepEqual(foldered.mixer.groups.map(({ id }) => id).sort(), ['music', 'stems']);

	const removed = applySoundscaperProjectCommand(foldered, {
		type: 'track-folder/remove', folderId: 'stems', sequenceId: 'main-sequence',
		disposition: 'promote',
	} as never, { now: NOW });

	assert.deepEqual(removed.mixer.groups.map(({ id }) => id), ['music']);
	assert.ok(removed.mixer.edges.some(({ id }) => id === 'assignment:track:guitar:mixer-node:music'));
});

function project() {
	return createSoundscaperProject({
		id: 'folder-bus-removal', title: 'Folder bus removal', now: NOW,
		tracks: [
			createAudioTrack({ id: 'voice', name: 'Voice', clipIds: [] }),
			createAudioTrack({ id: 'guitar', name: 'Guitar', clipIds: [] }),
		],
		sequences: [{ id: 'main-sequence', trackIds: ['voice', 'guitar'] }],
		primarySequenceId: 'main-sequence',
	});
}
