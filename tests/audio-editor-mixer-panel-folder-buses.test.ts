/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createAudioTrack,
} from '../src/common/editor/project-media-factory.ts';
import {
	folderOwnedMixerBusIds,
	mixerAudibilityAuthority,
	removableMixerBuses,
} from '../src/common/editor/ui/workspace/mixer-panel-model.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { applySoundscaperProjectCommand } from '../src/soundscaper/editor-project-commands.ts';

/**
 * The mixer offers what a folder-owned strip can actually do.
 *
 * A folder that contains audio owns its group bus: the folder record holds that
 * bus's name, mute, solo, and existence, and the graph refuses to change any of
 * them on the bus. The mixer rendered those strips exactly like a bus a user
 * made, so Mute, Solo, and Remove bus were live controls that answered with the
 * invariant message the folder authority throws — permanently dead, on a strip
 * whose gain, pan, and effects work.
 */

const NOW = '2026-08-19T12:00:00.000Z';

test('a folder that contains audio owns the strip its audio is mixed on', () => {
	const project = folderedProject();
	const owned = folderOwnedMixerBusIds(project);

	assert.deepEqual([...owned], ['stems']);
	assert.equal(mixerAudibilityAuthority('group', 'stems', owned), 'folder');
	assert.equal(mixerAudibilityAuthority('group', 'user-bus', owned), 'strip');
	assert.equal(mixerAudibilityAuthority('send', 'stems', owned), 'strip');
});

test('a folder-owned bus is not offered for removal', () => {
	const owned = folderOwnedMixerBusIds(folderedProject());
	const buses = [
		{ type: 'group', bus: { id: 'stems' } },
		{ type: 'group', bus: { id: 'user-bus' } },
		{ type: 'send', bus: { id: 'reverb' } },
	];
	assert.deepEqual(
		removableMixerBuses(buses, owned).map(({ bus }) => bus.id),
		['user-bus', 'reverb'],
	);
});

test('a project with no folders leaves every bus a user bus', () => {
	const owned = folderOwnedMixerBusIds(plainProject());
	assert.deepEqual([...owned], []);
	assert.equal(mixerAudibilityAuthority('group', 'user-bus', owned), 'strip');
});

function folderedProject() {
	return applySoundscaperProjectCommand(plainProject(), {
		type: 'batch',
		commands: [
			{ type: 'track-folder/add', folder: { id: 'stems', name: 'Stems' }, sequenceId: 'main-sequence' },
			{
				type: 'track-node/move', sequenceId: 'main-sequence',
				nodeId: 'voice', parentFolderId: 'stems', index: 0,
			},
		],
	} as never, { now: NOW });
}

function plainProject() {
	return createSoundscaperProject({
		id: 'mixer-folder-buses', title: 'Mixer folder buses', now: NOW,
		tracks: [createAudioTrack({ id: 'voice', name: 'Voice', clipIds: [] })],
		sequences: [{ id: 'main-sequence', trackIds: ['voice'] }],
		primarySequenceId: 'main-sequence',
	});
}
