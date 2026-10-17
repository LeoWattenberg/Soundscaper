/* SPDX-License-Identifier: AGPL-3.0-only */

import { TextWriter, Uint8ArrayReader, ZipReader } from '@zip.js/zip.js';
import { rewriteScapeProjectDocument } from '../helpers/scape-archive-rewrite.js';
import { expect, longTone, test } from './audio-editor-test-fixtures.js';
import {
	bootEditor, chooseCommandAction, chooseExportProjectFileAction, chooseFileAction,
	chooseNestedCommandAction, clipByName, collectClientErrors, disableNativeSavePicker,
	downloadBytes, getMenuItem, importFiles,
} from './audio-editor-test-helpers.js';
import { chooseTrackMenuAction } from './helpers/track-menu.js';

test('selected point and range labels copy their text, colors and spacing; Cut is one Undo and media copying still works', async ({ page }) => {
	test.setTimeout(60_000);
	await disableNativeSavePicker(page);
	const errors = collectClientErrors(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [longTone]);
	await importFiles(editor, [{ name: 'clipboard-labels.txt', mimeType: 'text/plain',
		buffer: Buffer.from('0.5\t0.5\tPoint cue\n1\t1.5\tRegion cue\n') }]);
	await reopenColoredLabelFixture(page, editor);
	const row = editor.locator('[data-label-track]');
	const labels = row.locator('[data-label-id]');
	const point = row.getByRole('group', { name: 'Edit labels: Point cue', exact: true });
	const region = row.getByRole('group', { name: 'Edit labels: Region cue', exact: true });
	await point.locator('[data-label-banner]').click();
	await region.locator('[data-label-banner]').click({ modifiers: ['Shift'] });
	await expect(row.locator('[data-selected-label="true"]')).toHaveCount(2);
	await chooseCommandAction(page, editor, 'Edit', 'Copy');
	await expect(row.locator('[data-selected-label="true"]')).toHaveCount(2);
	await setPlayhead(editor, '4s');
	await editor.getByRole('slider', { name: 'Playhead', exact: true }).focus();
	await page.keyboard.press('Control+v');
	await expect(labels).toHaveCount(4);
	const pastedPoint = point.last(), pastedRegion = region.last();
	await expect(pastedPoint).toHaveAttribute('data-point-label', 'true');
	await expect(pastedRegion).toHaveAttribute('data-point-label', 'false');
	const originalPointX = (await point.first().boundingBox()).x;
	const originalRegionX = (await region.first().boundingBox()).x;
	await expect.poll(async () => (await pastedRegion.boundingBox()).x - (await pastedPoint.boundingBox()).x)
		.toBeCloseTo(originalRegionX - originalPointX, 1);
	const document = await exportedProject(page, editor);
	const pasted = document.tracks.find(track => track.type === 'label').labels.filter(label => label.startFrame >= 4 * document.sampleRate);
	expect(pasted.map(({ title, color, startFrame, endFrame }) => ({ title, color, startFrame, endFrame }))).toEqual([
		{ title: 'Point cue', color: '#e04040', startFrame: 4 * document.sampleRate, endFrame: 4 * document.sampleRate },
		{ title: 'Region cue', color: '#40a060', startFrame: 4.5 * document.sampleRate, endFrame: 5 * document.sampleRate },
	]);

	await pastedPoint.locator('[data-label-banner]').click();
	await pastedRegion.locator('[data-label-banner]').click({ modifiers: ['Shift'] });
	await expect(row.locator('[data-selected-label="true"]')).toHaveCount(2);
	await chooseNestedCommandAction(page, editor, 'Edit', ['Cut', 'Cut']);
	await expect(labels).toHaveCount(2);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(labels).toHaveCount(4);

	await point.first().locator('[data-label-banner]').click();
	await region.first().locator('[data-label-banner]').click({ modifiers: ['Shift'] });
	await chooseCommandAction(page, editor, 'Edit', 'Copy');
	await chooseTrackMenuAction(page, editor, row, 'Lock track');
	await editor.getByRole('menuitem', { name: 'Edit', exact: true }).click();
	const pasteParent = getMenuItem(page.getByRole('menu', { name: 'Edit', exact: true }), 'Paste');
	await pasteParent.focus();
	await pasteParent.press('ArrowRight');
	await expect(getMenuItem(pasteParent.getByRole('menu'), 'Paste')).toBeDisabled();
	await page.keyboard.press('Escape');
	await page.keyboard.press('Escape');
	await expect(labels).toHaveCount(4);
	await chooseTrackMenuAction(page, editor, row, 'Unlock track');

	await clipByName(editor, longTone.name).locator('.clip-header').click();
	await expect(row.locator('[data-selected-label="true"]')).toHaveCount(0);
	await chooseCommandAction(page, editor, 'Edit', 'Copy');
	await setPlayhead(editor, '6s');
	await chooseNestedCommandAction(page, editor, 'Edit', ['Paste', 'Paste']);
	await expect(editor).toHaveAttribute('data-clip-count', '2');
	await expect(labels).toHaveCount(4);
	expect(errors).toEqual([]);
});

async function setPlayhead(editor, value) {
	const timecode = editor.getByRole('group', { name: 'Playhead', exact: true });
	await timecode.locator('.timecode__display').dblclick();
	const input = timecode.getByRole('textbox', { name: 'Playhead', exact: true });
	await input.fill(value);
	await input.press('Enter');
}

async function archiveBytes(page, editor) {
	const pending = page.waitForEvent('download');
	await chooseExportProjectFileAction(page, editor);
	const download = await pending;
	const bytes = await downloadBytes(download);
	await download.delete();
	return bytes;
}

async function exportedProject(page, editor) {
	const reader = new ZipReader(new Uint8ArrayReader(await archiveBytes(page, editor)), { useWebWorkers: false });
	try {
		const entry = (await reader.getEntries()).find(candidate => candidate.filename === 'project.json');
		expect(entry).toBeTruthy();
		return JSON.parse(await entry.getData(new TextWriter()));
	} finally { await reader.close(); }
}

// The public project format carries per-label color; no color editor is exposed yet.
async function reopenColoredLabelFixture(page, editor) {
	const previousId = await editor.getAttribute('data-project-id');
	const colored = await rewriteScapeProjectDocument(new Blob([await archiveBytes(page, editor)]), project => {
		const labels = project.tracks.find(track => track.type === 'label').labels;
		labels[0].color = '#e04040'; labels[1].color = '#40a060';
	});
	const chooser = page.waitForEvent('filechooser');
	await chooseFileAction(page, editor, 'Open');
	await (await chooser).setFiles({ name: 'colored-labels.sscape', mimeType: 'application/vnd.soundscaper.scape+zip',
		buffer: Buffer.from(await colored.arrayBuffer()) });
	const collision = page.getByRole('dialog', { name: 'Project already exists', exact: true });
	await expect(collision).toBeVisible();
	await collision.getByRole('button', { name: /^Open as (?:read-only )?copy$/u }).click();
	await expect.poll(() => editor.getAttribute('data-project-id')).not.toBe(previousId);
	await expect(editor.getByRole('group', { name: 'Edit labels: Region cue', exact: true })).toBeVisible();
}
