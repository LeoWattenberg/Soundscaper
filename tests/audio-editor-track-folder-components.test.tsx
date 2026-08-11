/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { createDocumentTrackFolderSnapshot } from '../src/common/editor/controller/document-track-folder-snapshot.ts';
import { createAudioTrackV10 } from '../src/common/editor/project-v10.ts';
import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';
import { TrackFolderRow } from '../src/common/editor/ui/timeline/TrackFolderRow.jsx';
import { planTrackListRows } from '../src/common/editor/ui/timeline/track-folder-ui-model.ts';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';

const NOW = '2026-08-10T18:00:00.000Z';

function foldersPlan() {
	const project = createCurrentAudioEditorProject({
		id: 'folder-components', title: 'Folder components', now: NOW, primarySequenceId: 'main',
		trackFolders: [
			{ id: 'band', name: 'Band', mute: true },
			{ id: 'drums', name: 'Drums', collapsed: true },
		],
		tracks: [createAudioTrackV10({ id: 'kick', name: 'Kick' })],
		sequences: [{
			id: 'main',
			trackNodes: [
				{ kind: 'folder', id: 'band', parentFolderId: null },
				{ kind: 'folder', id: 'drums', parentFolderId: 'band' },
				{ kind: 'track', id: 'kick', parentFolderId: 'drums' },
			],
		}],
	});
	return planTrackListRows(
		createDocumentTrackFolderSnapshot(project),
		project.tracks as readonly { id: string }[],
		project.trackFolders,
	);
}

function renderRow(rowId: string, overrides: Record<string, unknown> = {}) {
	const plan = foldersPlan();
	const row = plan.folderRows.find(({ id }) => id === rowId);
	assert.notEqual(row, undefined);
	return renderToStaticMarkup(<TrackFolderRow
		row={row}
		plan={plan}
		copy={ENGLISH_COPY}
		blocked={false}
		selected={false}
		activeFolderId={null}
		panelWidth={240}
		onSelect={() => undefined}
		onKeyDown={() => undefined}
		onToggleCollapsed={() => undefined}
		onSetFlag={() => undefined}
		onMenu={() => undefined}
		editing={false}
		onRename={() => undefined}
		onDropNode={() => undefined}
		{...overrides}
	/>);
}

test('a folder row is a labelled treeitem carrying level, position, and expansion state', () => {
	const markup = renderRow('band');
	assert.match(markup, /role="treeitem"/u);
	assert.match(markup, /aria-level="1"/u);
	assert.match(markup, /aria-posinset="1"/u);
	assert.match(markup, /aria-setsize="1"/u);
	assert.match(markup, /aria-expanded="true"/u);
	assert.match(markup, /aria-label="Folder Band, level 1"/u);
	assert.match(markup, /id="audio-editor-track-folder-row-band"/u);
	assert.match(markup, /tabindex="0"/iu);

	const nested = renderRow('drums');
	assert.match(nested, /aria-level="2"/u);
	assert.match(nested, /aria-expanded="false"/u);
	assert.match(nested, /tabindex="-1"/iu);
});

test('folder audibility toggles expose pressed state and accessible names', () => {
	const markup = renderRow('band');
	assert.match(markup, /aria-label="Mute folder" aria-pressed="true"/u);
	assert.match(markup, /aria-label="Solo folder" aria-pressed="false"/u);
	assert.match(markup, /aria-label="Hide folder" aria-pressed="false"/u);
	assert.match(markup, /aria-label="Collapse folder"/u);

	const blocked = renderRow('band', { blocked: true });
	const disabledButtons = blocked.match(/disabled=""/gu) ?? [];
	assert.equal(disabledButtons.length, 4, 'chevron and all three toggles disable together');
});

test('the German catalog carries the folder tree copy', () => {
	assert.equal(typeof ENGLISH_COPY.trackFolderTree, 'string');
	assert.match(renderRow('band'), /Band/u);
});

test('an editing row swaps the name for a labelled rename input', () => {
	const markup = renderRow('band', { editing: true });
	assert.match(markup, /aria-label="Rename folder"/u);
	assert.match(markup, /value="Band"/u);
	assert.doesNotMatch(markup, /<span class="audio-editor-track-folder-row__name">/u);
	assert.match(markup, /draggable="false"/u);
});
