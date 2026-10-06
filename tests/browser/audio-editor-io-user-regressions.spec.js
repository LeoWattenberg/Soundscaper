/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA, longTone, captionLabels, readFile } from './audio-editor-test-fixtures.js';
import {
	bootEditor, chooseCommandAction, chooseDropdown, chooseNestedCommandAction,
	closeWorkspacePanel, commitInput, disableNativeSavePicker,
	importFiles, openExportDialog,
} from './audio-editor-test-helpers.js';
import { createDeterministicAvFixture } from './fixtures/deterministic-av-media.js';

async function saveDeliveryPreset(page, dialog, name) {
	await dialog.getByRole('button', { name: 'Save preset', exact: true }).click();
	await page.getByRole('menuitem', { name: 'Save as new preset', exact: true }).click();
	const naming = page.getByRole('dialog', { name: 'Save as new preset', exact: true });
	await naming.getByRole('textbox', { name: 'Preset name', exact: true }).fill(name);
	await naming.getByRole('button', { name: 'Save preset', exact: true }).click();
	await expect(dialog.getByRole('button', { name: 'Preset', exact: true })).toContainText(name);
}

async function applyDeliveryPreset(page, dialog, name) {
	await dialog.getByRole('button', { name: 'Preset', exact: true }).click();
	await page.getByRole('option', { name: `${name} (custom)` }).click();
}

test('Cancel in the raw PCM import dialog stops a pending ordinary recording import', async ({ page }) => {
	test.setTimeout(90_000);
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Tools', 'Import raw data');
	const dialog = page.getByRole('dialog', { name: 'Import raw data', exact: true });
	// About six minutes of mono, 16-bit PCM at the dialog's default 44.1 kHz.
	await dialog.getByLabel('Raw PCM file').setInputFiles({
		name: 'room-recording.raw', mimeType: 'application/octet-stream', buffer: Buffer.alloc(32 * 1024 * 1024),
	});
	await dialog.getByRole('button', { name: 'Import', exact: true }).click();
	await expect(editor).toHaveAttribute('data-edit-block-reason', 'importing', { timeout: 30_000 });
	await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
	await expect(dialog).toBeHidden();
	await expect(editor).not.toHaveAttribute('data-edit-block-reason', 'importing', { timeout: 45_000 });
	await expect(editor).toHaveAttribute('data-clip-count', '0');
});

test('a legacy AUP chosen through File Import asks for its data directory', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	const importChooser = page.waitForEvent('filechooser');
	await chooseCommandAction(page, editor, 'File', 'Import');
	const chooser = await importChooser;
	const dataChooser = page.waitForEvent('filechooser');
	// A normal native chooser can select this project using its All files filter.
	await chooser.setFiles({
		name: 'Legacy.aup', mimeType: 'application/x-audacity-project',
		buffer: Buffer.from('<?xml version="1.0"?><project rate="44100" projname="Legacy.aup"/>'),
	});
	expect((await dataChooser).isMultiple()).toBe(true);
});

test('clearing the project metadata title keeps the export title empty', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	await chooseCommandAction(page, editor, 'Edit', 'Metadata editor');
	const metadata = editor.locator('[data-workspace-panel="metadata"]');
	await commitInput(metadata.getByRole('textbox', { name: 'Title', exact: true }), '');
	await closeWorkspacePanel(editor, 'metadata');
	const dialog = await openExportDialog(page, editor);
	await dialog.getByRole('button', { name: 'Metadata', exact: true }).click();
	await expect(page.getByRole('dialog', { name: 'Metadata', exact: true })
		.getByRole('textbox', { name: 'Title', exact: true })).toHaveValue('');
});

test('a dotted project title is retained in the label download name', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [captionLabels]);
	await chooseNestedCommandAction(page, editor, 'File', ['Project management', 'Rename project']);
	const naming = page.getByRole('dialog', { name: 'Rename project', exact: true });
	await commitInput(naming.getByRole('textbox'), 'Episode 1.2');
	await naming.getByRole('button', { name: 'Save name', exact: true }).click();
	await chooseNestedCommandAction(page, editor, 'File', ['Export other', 'Export labels']);
	const dialog = page.getByRole('dialog', { name: 'Export labels', exact: true });
	const downloaded = page.waitForEvent('download');
	await dialog.getByRole('button', { name: 'Export labels', exact: true }).click();
	expect((await downloaded).suggestedFilename()).toBe('Episode 1.2.txt');
});

test('a user-authored label containing an arrow exports as SubRip', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	await editor.getByRole('slider', { name: 'Playhead' }).focus();
	await page.keyboard.press('Control+b');
	const title = editor.getByRole('textbox', { name: /^Edit labels:/u });
	await title.fill('Intro --> Verse');
	await title.press('Enter');
	await chooseNestedCommandAction(page, editor, 'File', ['Export other', 'Export labels']);
	const dialog = page.getByRole('dialog', { name: 'Export labels', exact: true });
	await chooseDropdown(page, dialog.getByRole('group', { name: 'Format', exact: true }), 'As SubRip (SRT)');
	const downloads = [];
	page.on('download', (download) => downloads.push(download));
	await dialog.getByRole('button', { name: 'Export labels', exact: true }).click();
	await expect(dialog.getByRole('alert')).toHaveCount(0);
	await expect.poll(() => downloads.length).toBe(1);
	expect(await readFile(await downloads[0].path(), 'utf8')).toContain('Intro --> Verse');
});

test('WebVTT readers display literal punctuation from a user-authored label', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	await editor.getByRole('slider', { name: 'Playhead' }).focus();
	await page.keyboard.press('Control+b');
	const title = '5 < 10 & 20 > 15';
	const input = editor.getByRole('textbox', { name: /^Edit labels:/u });
	await input.fill(title);
	await input.press('Enter');
	await chooseNestedCommandAction(page, editor, 'File', ['Export other', 'Export labels']);
	const dialog = page.getByRole('dialog', { name: 'Export labels', exact: true });
	await chooseDropdown(page, dialog.getByRole('group', { name: 'Format', exact: true }), 'As WebVTT');
	const downloaded = page.waitForEvent('download');
	await dialog.getByRole('button', { name: 'Export labels', exact: true }).click();
	const text = await readFile(await (await downloaded).path(), 'utf8');
	const payload = text.split('\n').slice(4).join('\n').trimEnd();
	const displayed = await page.evaluate((value) => new VTTCue(0, 1, value).getCueAsHTML().textContent, payload);
	expect(displayed).toBe(title);
});

test('custom channel routing survives saving and reopening a delivery preset', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	let dialog = await openExportDialog(page, editor);
	await dialog.getByRole('radio', { name: 'Custom channel mapping', exact: true }).check();
	await dialog.getByRole('button', { name: 'Edit mapping', exact: true }).click();
	let mapping = page.getByRole('dialog', { name: 'Edit channel mapping', exact: true });
	await mapping.getByRole('checkbox', { name: 'Route input 1 to output 1', exact: true }).uncheck();
	await mapping.getByRole('checkbox', { name: 'Route input 2 to output 1', exact: true }).check();
	await mapping.getByRole('button', { name: 'Apply', exact: true }).click();
	await saveDeliveryPreset(page, dialog, 'Right to left');
	await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
	dialog = await openExportDialog(page, editor);
	await applyDeliveryPreset(page, dialog, 'Right to left');
	await expect(dialog.getByRole('radio', { name: 'Custom channel mapping', exact: true })).toBeChecked();
	await dialog.getByRole('button', { name: 'Edit mapping', exact: true }).click();
	mapping = page.getByRole('dialog', { name: 'Edit channel mapping', exact: true });
	await expect(mapping.getByRole('checkbox', { name: 'Route input 1 to output 1', exact: true })).not.toBeChecked();
	await expect(mapping.getByRole('checkbox', { name: 'Route input 2 to output 1', exact: true })).toBeChecked();
});

test('a saved marker chapter preset keeps its marker source', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA, captionLabels]);
	await chooseNestedCommandAction(page, editor, 'Window', ['Markers']);
	await editor.getByRole('region', { name: 'Markers and named regions', exact: true })
		.getByRole('button', { name: 'Add marker at playhead', exact: true }).click();
	let dialog = await openExportDialog(page, editor);
	await chooseDropdown(page, dialog.getByRole('group', { name: 'Output', exact: true }), 'Chapters (split by markers)');
	await saveDeliveryPreset(page, dialog, 'Marker programme');
	await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
	dialog = await openExportDialog(page, editor);
	await applyDeliveryPreset(page, dialog, 'Marker programme');
	await expect(dialog.getByRole('group', { name: 'Output', exact: true }).getByRole('button'))
		.toContainText('Chapters (split by markers)');
});

test('switching from a normalized mix to label chapters exports after normalization hides', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [longTone, captionLabels]);
	const dialog = await openExportDialog(page, editor);
	await chooseDropdown(page, dialog.getByRole('group', { name: 'Loudness normalization', exact: true }), 'Streaming (-14 LUFS)');
	await chooseDropdown(page, dialog.getByRole('group', { name: 'Output', exact: true }), 'Chapters (split by labels)');
	await expect(dialog.getByRole('group', { name: 'Loudness normalization', exact: true })).toHaveCount(0);
	const downloads = [];
	page.on('download', (download) => downloads.push(download));
	await dialog.getByRole('button', { name: 'Export', exact: true }).click();
	await expect.poll(() => downloads.length, { timeout: 15_000 }).toBe(1);
	await expect(dialog.getByRole('alert')).toHaveCount(0);
});

test('applying a video preset replaces the previous platform target', async ({ page }) => {
	test.setTimeout(60_000);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [createDeterministicAvFixture('delivery.webm')]);
	const dialog = await openExportDialog(page, editor);
	await chooseDropdown(page, dialog.getByRole('group', { name: 'Format', exact: true }), 'MP4 video');
	await saveDeliveryPreset(page, dialog, 'My MP4');
	await chooseDropdown(page, dialog.getByRole('group', { name: 'Delivery target', exact: true }), 'Web 1080p (WebM)');
	await applyDeliveryPreset(page, dialog, 'My MP4');
	await expect(dialog.getByRole('group', { name: 'Delivery target', exact: true }).getByRole('button'))
		.toContainText('Custom');
	await expect(dialog.getByRole('group', { name: 'Format', exact: true }).getByRole('button'))
		.toContainText('MP4 video');
});
