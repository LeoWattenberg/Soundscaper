/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createEmbeddedChapterEncoding } from '../src/common/editor/export-embedded-chapter-encoding.ts';
import { mountedExportDialog } from './helpers/audio-editor-export-dialog-fixture.ts';

test('the ordinary MP3 export checkbox refuses a point label at the exclusive delivery end', async () => {
	const label = { id: 'end', title: 'End of programme', startFrame: 48_000, endFrame: 48_000 };
	assert.throws(() => createEmbeddedChapterEncoding(
		{ format: 'mp3', sampleRate: 48_000 },
		{ sampleRate: 48_000, tracks: [{ type: 'label', labels: [label] }] },
		{ embedLabelChapters: true, mode: 'mix' },
		{ startFrame: 0, endFrame: 48_000 },
	), /No labels occur in the exported range/u);
	const fixture = await mountedExportDialog({ labels: [label] });
	try {
		await fixture.chooseFormat('MP3');
		assert.equal(fixture.chapterCheckbox().getAttribute('aria-disabled'), 'true');
	} finally { await fixture.unmount(); }
});

test('the ordinary MP3 export checkbox admits an in-range point label', async () => {
	const fixture = await mountedExportDialog({ labels: [
		{ id: 'intro', title: 'Opening', startFrame: 0, endFrame: 0 },
	] });
	try {
		await fixture.chooseFormat('MP3');
		assert.notEqual(fixture.chapterCheckbox().getAttribute('aria-disabled'), 'true');
		await fixture.click(fixture.chapterCheckbox());
		await fixture.startExport();
		assert.equal(fixture.requests[0]?.embedLabelChapters, true);
	} finally { await fixture.unmount(); }
});

test('changing output to a selection without chapters clears the displayed and submitted opt-in', async () => {
	const fixture = await mountedExportDialog({ selection: { startFrame: 0, endFrame: 12_000 }, labels: [
		{ id: 'outro', title: 'Outro', startFrame: 24_000, endFrame: 24_000 },
	] });
	try {
		await fixture.chooseFormat('MP3');
		await fixture.click(fixture.chapterCheckbox());
		await fixture.chooseOutput('Current selection');
		assert.equal(fixture.chapterCheckbox().getAttribute('aria-disabled'), 'true');
		assert.equal(fixture.chapterCheckbox().getAttribute('aria-checked'), 'false');
		await fixture.startExport();
		assert.equal(fixture.requests[0]?.embedLabelChapters, undefined);
		await fixture.chooseOutput('Entire project');
		assert.notEqual(fixture.chapterCheckbox().getAttribute('aria-disabled'), 'true');
	} finally { await fixture.unmount(); }
});
