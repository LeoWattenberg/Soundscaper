/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { ENGLISH_COPY, GERMAN_COPY } from '../src/common/i18n/catalogs.js';

const TOOLBAR = new URL('../src/common/editor/ui/toolbar/EditorToolToolbar.jsx', import.meta.url);

test('the customize-toolbar flyout calls the time display "Timecode" in both locales', async () => {
	const toolbar = await readFile(TOOLBAR, 'utf8');
	assert.equal(ENGLISH_COPY.timecode, 'Timecode');
	assert.equal(typeof GERMAN_COPY.timecode, 'string');
	assert.ok(GERMAN_COPY.timecode.length > 0);
	assert.match(toolbar, /id: 'time-display', label: copy\.timecode/u);
	assert.doesNotMatch(toolbar, /id: 'time-display', label: copy\.playhead/u);
});

test('the playhead label keeps naming the timeline cursor and timecode aria-labels', async () => {
	const transport = await readFile(new URL('../src/common/editor/ui/toolbar/AudioEditorTransportControls.jsx', import.meta.url), 'utf8');
	assert.match(transport, /ariaLabel=\{`\$\{copy\.playhead\}: \$\{copy\.format\}`\}/u);
	assert.equal(ENGLISH_COPY.playhead, 'Playhead');
});
