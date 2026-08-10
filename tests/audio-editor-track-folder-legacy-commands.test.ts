/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { applyEditorCommand } from '../src/common/editor/commands.js';
import { createAddTrackCommand } from '../src/common/editor/commands/factories.ts';
import type { AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';
import { assertEditorCommandCapabilities } from '../src/common/editor/controller/command-capability-policy.ts';
import { createAudioTrackV10 } from '../src/common/editor/project-v10.ts';
import {
	createAudioEditorProjectV13,
	validateAudioEditorProjectV13,
	type AudioEditorProjectV13,
} from '../src/common/editor/project-v13.ts';
import { PRODUCT_PROFILES } from '../src/common/products.js';

const NOW = '2026-08-10T13:00:00.000Z';

interface MixerShape {
	readonly groups: readonly Readonly<{ readonly id: string }>[];
	readonly routes: Readonly<Record<string, { readonly groupId: string | null }>>;
}

function mixerOf(project: object): MixerShape {
	return (project as { mixer: MixerShape }).mixer;
}

function hierarchyOf(project: AudioEditorProjectV13): readonly Readonly<{ id: string; parentFolderId: string | null }>[] {
	return project.sequences[0].trackNodes.map(({ id, parentFolderId }) => ({ id, parentFolderId }));
}

/**
 * band          (top-level folder, owns a bus)
 *   kick
 *   bass
 * vocals        (root audio track)
 */
function folderedProject(): AudioEditorProjectV13 {
	return createAudioEditorProjectV13({
		id: 'legacy-folder', title: 'Legacy on folders', now: NOW, primarySequenceId: 'main',
		trackFolders: [{ id: 'band', name: 'Band' }],
		tracks: [
			createAudioTrackV10({ id: 'kick', name: 'Kick' }),
			createAudioTrackV10({ id: 'bass', name: 'Bass' }),
			createAudioTrackV10({ id: 'vocals', name: 'Vocals' }),
		],
		sequences: [{
			id: 'main',
			trackNodes: [
				{ kind: 'folder', id: 'band', parentFolderId: null },
				{ kind: 'track', id: 'kick', parentFolderId: 'band' },
				{ kind: 'track', id: 'bass', parentFolderId: 'band' },
				{ kind: 'track', id: 'vocals', parentFolderId: null },
			],
		}],
	});
}

test('a stereo-split shaped batch keeps both halves inside the folder, adjacent, and routed', () => {
	const project = folderedProject();
	// track-transform-service splits a track by removing it and adding two
	// replacements at its flat index and index + 1.
	const split = applyEditorCommand(project, {
		type: 'batch',
		commands: [
			{ type: 'track/remove', trackId: 'kick' },
			{ ...createAddTrackCommand({ id: 'kick-left', name: 'Kick L' }), index: 0 },
			{ ...createAddTrackCommand({ id: 'kick-right', name: 'Kick R' }), index: 1 },
		],
	}, { now: NOW });
	assert.deepEqual(hierarchyOf(split), [
		{ id: 'band', parentFolderId: null },
		{ id: 'kick-left', parentFolderId: 'band' },
		{ id: 'kick-right', parentFolderId: 'band' },
		{ id: 'bass', parentFolderId: 'band' },
		{ id: 'vocals', parentFolderId: null },
	]);
	assert.equal(mixerOf(split).routes['kick-left'].groupId, 'band');
	assert.equal(mixerOf(split).routes['kick-right'].groupId, 'band');
	assert.equal(Object.hasOwn(mixerOf(split).routes, 'kick'), false);
	assert.equal(validateAudioEditorProjectV13(split), true);
});

test('a mixdown-shaped batch retires the emptied folder bus and appends the render at root', () => {
	const project = folderedProject();
	const mixed = applyEditorCommand(project, {
		type: 'batch',
		commands: [
			{ type: 'track/remove', trackId: 'kick' },
			{ type: 'track/remove', trackId: 'bass' },
			createAddTrackCommand({ id: 'mixdown', name: 'Mixdown' }) as AudioEditorCommand,
		],
	}, { now: NOW });
	assert.deepEqual(hierarchyOf(mixed), [
		{ id: 'band', parentFolderId: null },
		{ id: 'vocals', parentFolderId: null },
		{ id: 'mixdown', parentFolderId: null },
	]);
	// The folder holds no audio, so its bus and routes are gone.
	assert.deepEqual(mixerOf(mixed).groups, []);
	assert.equal(validateAudioEditorProjectV13(mixed), true);
});

test('legacy removal of one lane member removes the pair and their nodes together', () => {
	const project = createAudioEditorProjectV13({
		id: 'legacy-lanes', title: 'Legacy lanes', now: NOW, primarySequenceId: 'main',
		trackFolders: [{ id: 'picture', name: 'Picture' }],
		tracks: [
			{ ...createAudioTrackV10({ id: 'cam', name: 'Camera' }), type: 'video', laneGroupId: 'lane-a' },
			{ ...createAudioTrackV10({ id: 'cam-audio', name: 'Camera audio' }), laneGroupId: 'lane-a' },
			createAudioTrackV10({ id: 'vocals', name: 'Vocals' }),
		],
		sequences: [{
			id: 'main',
			trackNodes: [
				{ kind: 'folder', id: 'picture', parentFolderId: null },
				{ kind: 'track', id: 'cam', parentFolderId: 'picture' },
				{ kind: 'track', id: 'cam-audio', parentFolderId: 'picture' },
				{ kind: 'track', id: 'vocals', parentFolderId: null },
			],
		}],
	});
	const removed = applyEditorCommand(project, { type: 'track/remove', trackId: 'cam-audio' }, { now: NOW });
	assert.deepEqual(hierarchyOf(removed as AudioEditorProjectV13), [
		{ id: 'picture', parentFolderId: null },
		{ id: 'vocals', parentFolderId: null },
	]);
	assert.equal(validateAudioEditorProjectV13(removed), true);
});

test('legacy reorder moves across folder boundaries by adopting the destination parent', () => {
	const project = folderedProject();
	// vocals (flat 2) moves up to flat 0 -> before kick, inside band.
	const adopted = applyEditorCommand(project, {
		type: 'track/reorder', trackId: 'vocals', index: 0,
	}, { now: NOW });
	assert.deepEqual(hierarchyOf(adopted), [
		{ id: 'band', parentFolderId: null },
		{ id: 'vocals', parentFolderId: 'band' },
		{ id: 'kick', parentFolderId: 'band' },
		{ id: 'bass', parentFolderId: 'band' },
	]);
	assert.equal(mixerOf(adopted).routes.vocals.groupId, 'band');
	assert.equal(validateAudioEditorProjectV13(adopted), true);

	// kick (flat 0) moves down to flat 2 -> after vocals, at root.
	const escaped = applyEditorCommand(project, {
		type: 'track/reorder', trackId: 'kick', index: 2,
	}, { now: NOW });
	assert.deepEqual(hierarchyOf(escaped), [
		{ id: 'band', parentFolderId: null },
		{ id: 'bass', parentFolderId: 'band' },
		{ id: 'vocals', parentFolderId: null },
		{ id: 'kick', parentFolderId: null },
	]);
	assert.equal(mixerOf(escaped).routes.kick.groupId, null);
	assert.equal(validateAudioEditorProjectV13(escaped), true);
});

test('cross-sequence legacy reorder still rejects with the pinned message', () => {
	const project = createAudioEditorProjectV13({
		id: 'legacy-cross', title: 'Legacy cross', now: NOW, primarySequenceId: 'main',
		trackFolders: [{ id: 'band', name: 'Band' }],
		tracks: [
			createAudioTrackV10({ id: 'kick', name: 'Kick' }),
			createAudioTrackV10({ id: 'stem', name: 'Stem' }),
		],
		sequences: [
			{
				id: 'main',
				trackNodes: [
					{ kind: 'folder', id: 'band', parentFolderId: null },
					{ kind: 'track', id: 'kick', parentFolderId: 'band' },
				],
			},
			{ id: 'alt', trackNodes: [{ kind: 'track', id: 'stem', parentFolderId: null }] },
		],
	});
	const snapshot = structuredClone(project);
	assert.throws(
		() => applyEditorCommand(project, { type: 'track/reorder', trackId: 'stem', index: 0 }, { now: NOW }),
		/Legacy track reorder cannot cross V12 sequence boundaries\./u,
	);
	assert.deepEqual(project, snapshot);
});

test('explicit folder placement on track/add is capability-gated and lands under the parent', () => {
	assert.doesNotThrow(() => assertEditorCommandCapabilities(
		{ ...createAddTrackCommand({ id: 'x', name: 'X' }), parentFolderId: 'band' },
		PRODUCT_PROFILES.soundscaper.capabilities,
		'soundscaper',
	));
	assert.throws(
		() => assertEditorCommandCapabilities(
			{ ...createAddTrackCommand({ id: 'x', name: 'X' }), parentFolderId: 'band' },
			PRODUCT_PROFILES.framescaper.capabilities,
			'framescaper',
		),
		/does not support trackFolders/iu,
	);
	const placed = applyEditorCommand(folderedProject(), {
		...createAddTrackCommand({ id: 'shaker', name: 'Shaker' }),
		sequenceId: 'main',
		parentFolderId: 'band',
		parentIndex: 1,
	}, { now: NOW });
	assert.deepEqual(hierarchyOf(placed), [
		{ id: 'band', parentFolderId: null },
		{ id: 'kick', parentFolderId: 'band' },
		{ id: 'shaker', parentFolderId: 'band' },
		{ id: 'bass', parentFolderId: 'band' },
		{ id: 'vocals', parentFolderId: null },
	]);
	assert.equal(mixerOf(placed).routes.shaker.groupId, 'band');
	assert.equal(validateAudioEditorProjectV13(placed), true);
});
