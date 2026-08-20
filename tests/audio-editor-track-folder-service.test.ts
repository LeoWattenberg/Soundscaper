/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { applyEditorCommand } from '../src/common/editor/commands.js';
import type { AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';
import { createDocumentTrackFolderSnapshot } from '../src/common/editor/controller/document-track-folder-snapshot.ts';
import { EditorControllerLifetime } from '../src/common/editor/controller/lifecycle.ts';
import { createTrackFolderService } from '../src/common/editor/controller/track-folder-service.ts';
import {
	createAudioTrack,
} from '../src/common/editor/project-media-factory.ts';
import {
	createCurrentAudioEditorProject,
	validateCurrentAudioEditorProject,
	type AudioEditorProjectCurrent,
} from '../src/common/editor/project-current.ts';
import {
	FRAMESCAPER_PROJECT_V19_SCHEMA_VERSION,
	SOUNDSCAPER_PROJECT_V21_SCHEMA_VERSION,
} from '../src/common/editor/project-schema-version.ts';

const NOW = '2026-08-10T16:00:00.000Z';

function folderedProject(): AudioEditorProjectCurrent {
	return createCurrentAudioEditorProject({
		id: 'folder-service', title: 'Folder service', now: NOW, primarySequenceId: 'main',
		trackFolders: [{ id: 'band', name: 'Band', solo: true, collapsed: true }],
		tracks: [
			createAudioTrack({ id: 'kick', name: 'Kick' }),
			createAudioTrack({ id: 'vocals', name: 'Vocals' }),
			createAudioTrack({ id: 'bass', name: 'Bass' }),
		],
		sequences: [{
			id: 'main',
			trackNodes: [
				{ kind: 'folder', id: 'band', parentFolderId: null },
				{ kind: 'track', id: 'kick', parentFolderId: 'band' },
				{ kind: 'track', id: 'vocals', parentFolderId: null },
				{ kind: 'track', id: 'bass', parentFolderId: null },
			],
		}],
	});
}

function createFixture(initial = folderedProject()) {
	const lifetime = new EditorControllerLifetime();
	lifetime.markReady();
	let project = initial;
	let published = 0;
	let identity = 0;
	const service = createTrackFolderService({
		lifetime,
		getProject: () => project,
		editingBlocked: () => false,
		createId: (prefix: string) => `${prefix}-${String(++identity)}`,
		commit: (command: AudioEditorCommand) => {
			project = applyEditorCommand(project, command, { now: NOW });
			return project;
		},
		publishProjectState: () => { published += 1; },
	});
	return {
		service,
		get project() { return project; },
		get published() { return published; },
	};
}

test('folder creation targets the session-selected folder and publishes state', () => {
	const fixture = createFixture();
	const rootFolderId = fixture.service.createFolder('Section');
	assert.equal(rootFolderId, 'track-folder-1');
	assert.equal(fixture.service.selectedFolderId(), rootFolderId);

	// With a selection active, a new folder nests inside it.
	const nestedId = fixture.service.createFolder();
	const nested = fixture.project.sequences[0].trackNodes.find(({ id }) => id === nestedId);
	assert.equal(nested?.parentFolderId, rootFolderId);
	assert.equal(fixture.published, 2);
	assert.equal(validateCurrentAudioEditorProject(fixture.project), true);
});

test('rename, collapse toggle, move, and removal ride the folder-aware commands', () => {
	const fixture = createFixture();
	fixture.service.renameFolder('band', 'Rhythm');
	fixture.service.toggleCollapsed('band');
	fixture.service.moveNode('main', 'bass', 'band', 1);

	const folder = fixture.project.trackFolders.find(({ id }) => id === 'band');
	assert.equal(folder?.name, 'Rhythm');
	assert.equal(folder?.collapsed, false);
	const mixer = fixture.project.mixer as {
		routes: Record<string, { groupId: string | null }>;
		groups: readonly { id: string; name: string }[];
	};
	assert.equal(mixer.routes.bass.groupId, 'band');
	assert.equal(mixer.groups[0]?.name, 'Rhythm');

	fixture.service.selectFolder('band');
	fixture.service.removeFolder('band', 'promote');
	assert.equal(fixture.service.selectedFolderId(), null);
	assert.deepEqual(fixture.project.trackFolders, []);
	assert.equal(validateCurrentAudioEditorProject(fixture.project), true);

	assert.throws(
		() => fixture.service.removeFolder('ghost', 'promote'),
		/Unknown track folder: ghost\./u,
	);
});

test('wrapping a selection creates the folder at the first track and moves the block atomically', () => {
	const fixture = createFixture();
	const folderId = fixture.service.wrapTracksIntoFolder(['vocals', 'bass'], 'Voices');
	assert.equal(typeof folderId, 'string');
	assert.deepEqual(
		fixture.project.sequences[0].trackNodes.map(({ id, parentFolderId }) => ({ id, parentFolderId })),
		[
			{ id: 'band', parentFolderId: null },
			{ id: 'kick', parentFolderId: 'band' },
			{ id: folderId, parentFolderId: null },
			{ id: 'vocals', parentFolderId: folderId },
			{ id: 'bass', parentFolderId: folderId },
		],
	);
	// One command batch, one publication.
	assert.equal(fixture.published, 1);
	assert.equal(validateCurrentAudioEditorProject(fixture.project), true);
});

test('the document snapshot exposes per-sequence rows with structural state', () => {
	const snapshot = createDocumentTrackFolderSnapshot(folderedProject());
	assert.equal(snapshot.structuralSoloActive, true);
	assert.equal(snapshot.sequences.length, 1);
	const rows = snapshot.sequences[0].rows;
	assert.deepEqual(rows.map(({ id, kind, depth }) => ({ id, kind, depth })), [
		{ id: 'band', kind: 'folder', depth: 0 },
		{ id: 'kick', kind: 'track', depth: 1 },
		{ id: 'vocals', kind: 'track', depth: 0 },
		{ id: 'bass', kind: 'track', depth: 0 },
	]);
	const folderRow = rows[0];
	assert.equal(folderRow.kind === 'folder' && folderRow.hasAudioDescendant, true);
	const kickRow = rows[1];
	assert.equal(kickRow.kind === 'track' && kickRow.type === 'audio' && kickRow.effectiveSoloed, true);
	assert.equal(kickRow.rowHidden, true, 'a collapsed ancestor suppresses the row');
	const soundscaperSnapshot = createDocumentTrackFolderSnapshot({
		...folderedProject(),
		schemaVersion: SOUNDSCAPER_PROJECT_V21_SCHEMA_VERSION,
	});
	assert.deepEqual(soundscaperSnapshot, snapshot);
});

test('the snapshot never traverses obsolete, Framescaper, future, folder-free, or hostile documents', () => {
	assert.deepEqual(createDocumentTrackFolderSnapshot(null).sequences, []);
	assert.deepEqual(createDocumentTrackFolderSnapshot({ schemaVersion: 12 }).sequences, []);
	assert.deepEqual(createDocumentTrackFolderSnapshot({ schemaVersion: FRAMESCAPER_PROJECT_V19_SCHEMA_VERSION }).sequences, []);
	assert.deepEqual(createDocumentTrackFolderSnapshot({
		schemaVersion: FRAMESCAPER_PROJECT_V19_SCHEMA_VERSION,
		get trackFolders(): never { throw new Error('trackFolders was traversed'); },
	}).sequences, []);
	assert.deepEqual(createDocumentTrackFolderSnapshot({
		schemaVersion: SOUNDSCAPER_PROJECT_V21_SCHEMA_VERSION + 1,
		get trackFolders(): never { throw new Error('trackFolders was traversed'); },
	}).sequences, []);
	const folderFree = createCurrentAudioEditorProject({
		id: 'folder-free', title: 'Folder free', now: NOW, primarySequenceId: 'main',
		tracks: [createAudioTrack({ id: 'solo-track', name: 'Solo' })],
		sequences: [{ id: 'main', trackNodes: [{ kind: 'track', id: 'solo-track', parentFolderId: null }] }],
	});
	assert.deepEqual(createDocumentTrackFolderSnapshot(folderFree).sequences, []);
});
