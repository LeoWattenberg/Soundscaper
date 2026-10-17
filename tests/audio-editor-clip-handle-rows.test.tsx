/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Clip } from '../vendor/audacity-design-system/components/src/Clip/Clip.tsx';
import { clipHandleRows, isClipCollapsed } from '../vendor/audacity-design-system/components/src/utils/clipHandleRows.ts';

test('upstream handle rows divide short clips and fit beneath expanded clip headers', () => {
	for (const [height, expected] of [
		[44, { collapsed: true, trimTop: 0, stretchTop: 22, rowHeight: 22 }],
		[54, { collapsed: true, trimTop: 0, stretchTop: 27, rowHeight: 27 }],
		[60, { collapsed: true, trimTop: 0, stretchTop: 30, rowHeight: 30 }],
		[72, { collapsed: false, trimTop: 20, stretchTop: 46, rowHeight: 26 }],
		[84, { collapsed: false, trimTop: 20, stretchTop: 52, rowHeight: 32 }],
		[114, { collapsed: false, trimTop: 20, stretchTop: 52, rowHeight: 32 }],
	] as const) {
		const rows = clipHandleRows(height);
		assert.deepEqual(rows, expected);
		assert.ok(rows.stretchTop + rows.rowHeight <= height, `both handles fit the ${height}px clip`);
	}
	assert.equal(isClipCollapsed(71), true);
	assert.equal(isClipCollapsed(72), false);
});

test('collapsed clips hide their header and send adaptive dimensions to their handle hit areas', () => {
	for (const height of [54, 60, 72, 114]) {
		const markup = renderToStaticMarkup(<Clip selected name="Audio" height={height} waveformData={[0]} onTrimEdge={() => {}} />);
		const rows = clipHandleRows(height);
		assert.equal(markup.includes('clip-display--truncated'), rows.collapsed);
		assert.equal(/class="clip-header[\s"]/u.test(markup), !rows.collapsed);
		assert.ok(markup.includes(`--clip-handle-top:${rows.trimTop}px`));
		assert.ok(markup.includes(`--clip-handle-row:${rows.rowHeight}px`));
		assert.match(markup, /aria-label="Trim right edge"/u);
		assert.match(markup, /aria-label="Stretch right edge"/u);
	}
});
