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
	cloneCurrentAudioEditorProject,
	createCurrentAudioEditorProject,
	loadCurrentAudioEditorProject,
	validateCurrentAudioEditorProject,
	type AudioEditorProjectCurrent,
} from '../src/common/editor/project-current.ts';
import { exportScapeProject } from '../src/common/editor/scape-project.js';
import { AudioEditorProjectStore } from '../src/common/editor/storage.js';
import {
	asBaselineSoundscaperProject,
	importBaselineScapeProject,
	validateBaselineSoundscaperProject,
} from './helpers/baseline-scape-runtime.ts';

const NOW = '2026-08-10T14:00:00.000Z';

/**
 * Build a foldered project, then push it through a folder-aware batch so the
 * round trips below exercise the EDIT path, not a factory-fresh document:
 * a folder is created, an audio track moves into it (minting its bus), and
 * the original folder is renamed (moving its bus mirror).
 */
function mutatedProject(): AudioEditorProjectCurrent {
	const base = createCurrentAudioEditorProject({
		id: 'folder-roundtrip', title: 'Folder roundtrip', now: NOW, primarySequenceId: 'main',
		trackFolders: [{ id: 'band', name: 'Band' }],
		tracks: [
			createAudioTrack({ id: 'kick', name: 'Kick' }),
			createAudioTrack({ id: 'vocals', name: 'Vocals' }),
		],
		sequences: [{
			id: 'main',
			trackNodes: [
				{ kind: 'folder', id: 'band', parentFolderId: null },
				{ kind: 'track', id: 'kick', parentFolderId: 'band' },
				{ kind: 'track', id: 'vocals', parentFolderId: null },
			],
		}],
	});
	return applyEditorCommand(base, {
		type: 'batch',
		commands: [
			createAddTrackFolderCommand('main', { id: 'voices', name: 'Voices' }),
			createMoveTrackNodeCommand('main', 'vocals', 'voices', 0),
			createUpdateTrackFolderCommand('band', { name: 'Rhythm' }),
		],
	}, { now: NOW });
}

interface MixerShape {
	readonly groups: readonly Readonly<{ readonly id: string; readonly name: string }>[];
	readonly routes: Readonly<Record<string, { readonly groupId: string | null }>>;
}

function mixerOf(project: object): MixerShape {
	return (project as { mixer: MixerShape }).mixer;
}

test('a folder-aware edit batch produces the expected buses before any round trip', () => {
	const project = mutatedProject();
	assert.deepEqual(project.trackFolders.map(({ id, name }) => ({ id, name })), [
		{ id: 'band', name: 'Rhythm' },
		{ id: 'voices', name: 'Voices' },
	]);
	assert.deepEqual(mixerOf(project).groups.map(({ id, name }) => ({ id, name })), [
		{ id: 'band', name: 'Rhythm' },
		{ id: 'voices', name: 'Voices' },
	]);
	assert.equal(mixerOf(project).routes.kick.groupId, 'band');
	assert.equal(mixerOf(project).routes.vocals.groupId, 'voices');
	assert.equal(validateCurrentAudioEditorProject(project), true);
});

test('mutated folder and bus state is byte-exact through clone, JSON, and the local store', async () => {
	const project = mutatedProject();
	const serialized = JSON.stringify(project);

	const cloned = cloneCurrentAudioEditorProject(project);
	assert.deepEqual(cloned, project);
	assert.equal(JSON.stringify(cloned), serialized);

	const loaded = loadCurrentAudioEditorProject(JSON.parse(serialized));
	assert.equal(loaded.readOnly, false);
	assert.equal(JSON.stringify(loaded.project), serialized);

	const store = new AudioEditorProjectStore({ indexedDB: null, databaseName: 'v13-folder-mutated-roundtrip' });
	await store.saveProject(project);
	const reopened = await store.loadProject(project.id);
	assert.equal(JSON.stringify(reopened), serialized);
	await store.close();
});

test('mutated folder and bus state survives a .scape export and import byte-exactly', async () => {
	const project = asBaselineSoundscaperProject(mutatedProject());
	const serialized = JSON.stringify(project);
	const sourceStore = new AudioEditorProjectStore({ indexedDB: null, databaseName: 'v13-folder-mutated-scape-source' });
	const targetStore = new AudioEditorProjectStore({ indexedDB: null, databaseName: 'v13-folder-mutated-scape-target' });

	const exported = await exportScapeProject(project, sourceStore);
	const imported = await importBaselineScapeProject(exported.blob, targetStore);
	assert.equal(imported.readOnly, false);
	assert.equal(JSON.stringify(imported.project), serialized);
	assert.deepEqual(mixerOf(imported.project).groups, mixerOf(project).groups);
	assert.deepEqual(mixerOf(imported.project).routes, mixerOf(project).routes);
	assert.equal(validateBaselineSoundscaperProject(imported.project), true);
});

test('a further edit after reopening keeps the reconciled contract intact', async () => {
	const project = mutatedProject();
	const store = new AudioEditorProjectStore({ indexedDB: null, databaseName: 'v13-folder-edit-after-reopen' });
	await store.saveProject(project);
	const reopened = await store.loadProject(project.id) as AudioEditorProjectCurrent;
	const edited = applyEditorCommand(
		reopened,
		createMoveTrackNodeCommand('main', 'vocals', null, 0),
		{ now: NOW },
	);
	assert.deepEqual(mixerOf(edited).groups.map(({ id }) => id), ['band']);
	assert.equal(mixerOf(edited).routes.vocals.groupId, null);
	assert.equal(validateCurrentAudioEditorProject(edited), true);
	await store.close();
});
