/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createDocumentTrackFolderSnapshot } from '../src/common/editor/controller/document-track-folder-snapshot.ts';
import { createAudioTrackV10 } from '../src/common/editor/project-v10.ts';
import { createAudioEditorProjectV13 } from '../src/common/editor/project-v13.ts';
import {
	planTrackListRows,
	resolveTrackFolderMoveKey,
	resolveTrackFolderTreeKey,
	trackFolderRowTabIndex,
} from '../src/common/editor/ui/timeline/track-folder-ui-model.ts';

const NOW = '2026-08-10T17:00:00.000Z';

/**
 * band (collapsed)
 *   kick
 *   drums
 *     snare
 * voices
 *   vocals
 * outside
 */
function project() {
	return createAudioEditorProjectV13({
		id: 'folder-ui', title: 'Folder UI', now: NOW, primarySequenceId: 'main',
		trackFolders: [
			{ id: 'band', name: 'Band', collapsed: true },
			{ id: 'drums', name: 'Drums' },
			{ id: 'voices', name: 'Voices' },
		],
		tracks: [
			createAudioTrackV10({ id: 'kick', name: 'Kick' }),
			createAudioTrackV10({ id: 'snare', name: 'Snare' }),
			createAudioTrackV10({ id: 'vocals', name: 'Vocals' }),
			createAudioTrackV10({ id: 'outside', name: 'Outside' }),
		],
		sequences: [{
			id: 'main',
			trackNodes: [
				{ kind: 'folder', id: 'band', parentFolderId: null },
				{ kind: 'track', id: 'kick', parentFolderId: 'band' },
				{ kind: 'folder', id: 'drums', parentFolderId: 'band' },
				{ kind: 'track', id: 'snare', parentFolderId: 'drums' },
				{ kind: 'folder', id: 'voices', parentFolderId: null },
				{ kind: 'track', id: 'vocals', parentFolderId: 'voices' },
				{ kind: 'track', id: 'outside', parentFolderId: null },
			],
		}],
	});
}

function plan(document = project()) {
	return planTrackListRows(
		createDocumentTrackFolderSnapshot(document),
		document.tracks as readonly { id: string }[],
		document.trackFolders,
	);
}

test('the row plan mirrors the trackNodes preorder and suppresses collapsed rows', () => {
	const rows = plan();
	assert.equal(rows.hasFolders, true);
	assert.deepEqual(rows.entries.map((entry) => (
		entry.kind === 'folder'
			? { id: entry.row.id, kind: 'folder', rowHidden: entry.row.rowHidden }
			: { id: entry.trackId, kind: 'track', rowHidden: entry.rowHidden }
	)), [
		{ id: 'band', kind: 'folder', rowHidden: false },
		{ id: 'kick', kind: 'track', rowHidden: true },
		{ id: 'drums', kind: 'folder', rowHidden: true },
		{ id: 'snare', kind: 'track', rowHidden: true },
		{ id: 'voices', kind: 'folder', rowHidden: false },
		{ id: 'vocals', kind: 'track', rowHidden: false },
		{ id: 'outside', kind: 'track', rowHidden: false },
	]);
});

test('tree levels, positions, and set sizes describe the folder tree, not track rows', () => {
	const rows = plan();
	assert.deepEqual(rows.folderRows.map(({ id, name, level, posInSet, setSize }) => (
		{ id, name, level, posInSet, setSize }
	)), [
		{ id: 'band', name: 'Band', level: 1, posInSet: 1, setSize: 2 },
		{ id: 'drums', name: 'Drums', level: 2, posInSet: 1, setSize: 1 },
		{ id: 'voices', name: 'Voices', level: 1, posInSet: 2, setSize: 2 },
	]);
	assert.equal(
		rows.treeOwnedIds,
		'audio-editor-track-folder-row-band audio-editor-track-folder-row-drums audio-editor-track-folder-row-voices',
	);
});

test('a folder-free project plans plain track rows with no tree', () => {
	const document = createAudioEditorProjectV13({
		id: 'flat', title: 'Flat', now: NOW, primarySequenceId: 'main',
		tracks: [createAudioTrackV10({ id: 'only', name: 'Only' })],
		sequences: [{ id: 'main', trackNodes: [{ kind: 'track', id: 'only', parentFolderId: null }] }],
	});
	const rows = plan(document);
	assert.equal(rows.hasFolders, false);
	assert.deepEqual(rows.entries, [
		{ kind: 'track', trackId: 'only', rowHidden: false, sequenceId: '', parentFolderId: null },
	]);
});

test('tree keys walk visible rows, expand, collapse, and exit to the parent', () => {
	const rows = plan();
	// band is collapsed, so drums is invisible: Down from band goes to voices.
	assert.deepEqual(resolveTrackFolderTreeKey('ArrowDown', 'band', rows), { kind: 'focus', folderId: 'voices' });
	assert.deepEqual(resolveTrackFolderTreeKey('ArrowUp', 'voices', rows), { kind: 'focus', folderId: 'band' });
	assert.deepEqual(resolveTrackFolderTreeKey('ArrowRight', 'band', rows), { kind: 'expand', folderId: 'band' });
	assert.deepEqual(resolveTrackFolderTreeKey('ArrowLeft', 'voices', rows), { kind: 'collapse', folderId: 'voices' });
	assert.deepEqual(resolveTrackFolderTreeKey('Home', 'voices', rows), { kind: 'focus', folderId: 'band' });
	assert.deepEqual(resolveTrackFolderTreeKey('End', 'band', rows), { kind: 'focus', folderId: 'voices' });
	assert.deepEqual(resolveTrackFolderTreeKey('Enter', 'band', rows), { kind: 'activate', folderId: 'band' });
	assert.equal(resolveTrackFolderTreeKey('ArrowDown', 'ghost', rows), null);
	assert.equal(resolveTrackFolderTreeKey('x', 'band', rows), null);

	// Expanded band: Right enters the first child folder; Left from drums exits to band.
	const expanded = project();
	const opened = {
		...expanded,
		trackFolders: expanded.trackFolders.map((folder) => (
			folder.id === 'band' ? { ...folder, collapsed: false } : folder
		)),
	};
	const openRows = plan(opened as ReturnType<typeof project>);
	assert.deepEqual(resolveTrackFolderTreeKey('ArrowRight', 'band', openRows), { kind: 'focus', folderId: 'drums' });
	// drums is expanded here, so Left collapses it first; once collapsed, Left exits to the parent.
	assert.deepEqual(resolveTrackFolderTreeKey('ArrowLeft', 'drums', openRows), { kind: 'collapse', folderId: 'drums' });
	const closedChild = {
		...opened,
		trackFolders: opened.trackFolders.map((folder) => (
			folder.id === 'drums' ? { ...folder, collapsed: true } : folder
		)),
	};
	const closedRows = plan(closedChild as ReturnType<typeof project>);
	assert.deepEqual(resolveTrackFolderTreeKey('ArrowLeft', 'drums', closedRows), { kind: 'focus', folderId: 'band' });
});

test('the roving tab index rests on the first visible row until a row is active', () => {
	const rows = plan();
	const [band, drums, voices] = rows.folderRows;
	assert.equal(trackFolderRowTabIndex(band, null, rows), 0);
	assert.equal(trackFolderRowTabIndex(voices, null, rows), -1);
	assert.equal(trackFolderRowTabIndex(voices, 'voices', rows), 0);
	assert.equal(trackFolderRowTabIndex(band, 'voices', rows), -1);
	assert.equal(trackFolderRowTabIndex(drums, 'drums', rows), 0);
});

test('alt-modified keys resolve structural moves identical to a pointer drop', () => {
	const expanded = project();
	const opened = {
		...expanded,
		trackFolders: expanded.trackFolders.map((folder) => (
			folder.id === 'band' ? { ...folder, collapsed: false } : folder
		)),
	};
	const rows = plan(opened as ReturnType<typeof project>);

	// voices is the second root child (band first): up moves before band.
	assert.deepEqual(resolveTrackFolderMoveKey('ArrowUp', 'voices', rows), {
		kind: 'move', sequenceId: 'main', nodeId: 'voices', parentFolderId: null, index: 0,
	});
	assert.equal(resolveTrackFolderMoveKey('ArrowUp', 'band', rows), null);
	assert.deepEqual(resolveTrackFolderMoveKey('ArrowDown', 'band', rows), {
		kind: 'move', sequenceId: 'main', nodeId: 'band', parentFolderId: null, index: 1,
	});
	// drums unnests to sit right after band at the root.
	assert.deepEqual(resolveTrackFolderMoveKey('ArrowLeft', 'drums', rows), {
		kind: 'move', sequenceId: 'main', nodeId: 'drums', parentFolderId: null, index: 1,
	});
	assert.equal(resolveTrackFolderMoveKey('ArrowLeft', 'band', rows), null);
	// voices nests into its previous root sibling, band.
	assert.deepEqual(resolveTrackFolderMoveKey('ArrowRight', 'voices', rows), {
		kind: 'move', sequenceId: 'main', nodeId: 'voices', parentFolderId: 'band', index: Number.MAX_SAFE_INTEGER,
	});
	assert.equal(resolveTrackFolderMoveKey('ArrowRight', 'band', rows), null);
	assert.equal(resolveTrackFolderMoveKey('ArrowUp', 'ghost', rows), null);
});
