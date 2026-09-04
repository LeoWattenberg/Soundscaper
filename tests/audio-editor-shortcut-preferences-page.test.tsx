/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { createAudioEditorPreferencesV1 } from '../src/common/editor/preferences.js';
import WorkspacePreferencesDialog from '../src/common/editor/ui/dialogs/WorkspacePreferencesDialog.jsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';

// The .jsx modules compile against the global React the browser build provides.
(globalThis as unknown as { React: unknown }).React = React;

const MENUS = Object.freeze([
	{ id: 'file', label: 'File', items: [{ id: 'file-new', label: 'New' }] },
	{
		id: 'view',
		label: 'View',
		items: [
			{ id: 'zoom-in', label: 'Zoom in' },
			{
				id: 'snap',
				label: 'Snapping',
				items: [
					{ id: 'snap-enabled', label: 'Snap to grid' },
					{ id: 'snap-1-128', label: '1/128', shortcutAssignable: false },
				],
			},
		],
	},
	{ id: 'help', label: 'Help', items: [{ id: 'about-audacity', label: 'About Soundscaper' }] },
]);

test('the shortcuts page opens on the categorized view and heads each group', () => {
	const markup = renderShortcutsPage();

	assert.match(markup, /role="group" aria-label="Sort commands">.*?By category/su);
	assert.match(markup, /data-shortcut-group="menu:file"[^>]*>File</u);
	assert.match(markup, /data-shortcut-group="menu:view"[^>]*>View</u);
	assert.ok(
		markup.indexOf('data-shortcut-group="menu:file"') < markup.indexOf('data-shortcut-group="menu:view"'),
		'the groups follow the menubar rather than the alphabet',
	);
	assert.ok(
		markup.indexOf('data-shortcut-group="menu:view"') < markup.indexOf('data-shortcut-action="zoom-in"'),
		'a command sits under the heading of the menu that shows it',
	);
});

test('the shortcuts page drops the rows that cannot take a shortcut', () => {
	const markup = renderShortcutsPage();

	assert.doesNotMatch(markup, /data-shortcut-action="about-audacity"/u);
	assert.doesNotMatch(markup, /data-shortcut-action="snap-1-128"/u);
	assert.doesNotMatch(markup, /data-shortcut-action="[^"]*%1"/u);
	assert.match(markup, /data-shortcut-action="snap-enabled"/u);
});

test('a command with two bindings gets a field and a remove control for each', () => {
	const row = shortcutRow(renderShortcutsPage(), 'delete-all-tracks-ripple');

	assert.match(row, /data-shortcut-binding="0"[^>]*value="Ctrl\+Del"/u);
	assert.match(row, /data-shortcut-binding="1"[^>]*value="Ctrl\+Backspace"/u);
	assert.match(row, /data-shortcut-remove="0"/u);
	assert.match(row, /data-shortcut-remove="1"/u);
	assert.match(row, /data-shortcut-add="true"/u);
});

test('a command with one binding gets one field and no remove control', () => {
	const row = shortcutRow(renderShortcutsPage(), 'split');

	assert.match(row, /data-shortcut-binding="0"[^>]*value="Ctrl\+I"/u);
	assert.doesNotMatch(row, /data-shortcut-binding="1"/u);
	assert.doesNotMatch(row, /data-shortcut-remove/u);
	assert.match(row, /data-shortcut-add="true"/u);
});

/** Slice one command's row out of the rendered page. */
function shortcutRow(markup: string, actionId: string): string {
	const start = markup.indexOf(`data-shortcut-action="${actionId}"`);
	assert.notEqual(start, -1, `renders the ${actionId} row`);
	const next = markup.indexOf('kw-audio-editor-preferences__shortcut-row', start);
	return markup.slice(start, next === -1 ? undefined : next);
}

function renderShortcutsPage(): string {
	return renderToStaticMarkup(
		<WorkspacePreferencesDialog
			controller={{ actions: { preferences: {} } }}
			snapshot={{ preferences: createAudioEditorPreferencesV1({}) }}
			copy={ENGLISH_COPY}
			locale="en"
			fileService={{ isDesktop: false }}
			menus={MENUS}
			run={() => undefined}
			initialPage="shortcuts"
			onTogglePanel={() => undefined}
			onClose={() => undefined}
		/>,
	);
}
