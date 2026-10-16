/* SPDX-License-Identifier: AGPL-3.0-only */

import { Buffer } from 'node:buffer';

import { expect, test } from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	chooseExportProjectFileAction,
	chooseFileAction,
	chooseNestedCommandAction,
	closeWorkspacePanel,
	collectClientErrors,
	commitInput,
	disableNativeSavePicker,
	downloadBytes,
	waitForEditor,
	waitForProjectActivation,
} from './audio-editor-test-helpers.js';

const syntheticRouteTest = test.extend({ browserCoverage: false });

async function openRecordingNotes(page, editor) {
	await chooseNestedCommandAction(page, editor, 'Window', ['Recording notes']);
	const notes = editor.getByRole('textbox', { name: 'Recording notes', exact: true });
	await expect(notes).toBeVisible();
	return notes;
}

async function renameProject(page, editor, title) {
	await chooseNestedCommandAction(page, editor, 'File', ['Project management', 'Rename project']);
	const dialog = page.getByRole('dialog', { name: 'Rename project', exact: true });
	await commitInput(dialog.getByRole('textbox', { name: 'Project name', exact: true }), title);
	await dialog.getByRole('button', { name: 'Save name', exact: true }).click();
	await expect(dialog).toHaveCount(0);
}

test.describe('optional project recording notes', () => {
	test.use({ viewport: { width: 1_440, height: 1_000 } });

	syntheticRouteTest('opens from Window, formats selected text and previews Markdown safely', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await expect(editor.getByRole('textbox', { name: 'Recording notes', exact: true })).toHaveCount(0);
		const notes = await openRecordingNotes(page, editor);
		const panel = editor.locator('[data-workspace-panel="recording-notes"]');
		await notes.fill('First take');
		await notes.press('End');
		await notes.press('!');
		await expect(notes).toHaveValue('First take!');
		await notes.press('ControlOrMeta+z');
		await expect(notes).toHaveValue('First take');
		await notes.press('ControlOrMeta+Shift+z');
		await expect(notes).toHaveValue('First take!');
		await notes.press('Backspace');
		await notes.press('ControlOrMeta+A');
		await panel.getByRole('button', { name: 'Bold', exact: true }).click();
		await expect(notes).toHaveValue('**First take**');
		await expect(notes).toBeFocused();

		const markdown = [
			'# Field session',
			'',
			'**First take** with *soft attack* and `room tone`.',
			'',
			'- Clap sync',
			'- Check noise',
			'',
			'1. Main take',
			'2. Pickup',
			'',
			'<img src=x onerror="window.recordingNotesUnsafe=true">',
			'',
			'[unsafe](javascript:window.recordingNotesUnsafe=true)',
		].join('\n');
		await notes.fill(markdown);
		await panel.getByRole('button', { name: 'Preview', exact: true }).click();
		const preview = panel.getByRole('region', { name: 'Recording notes preview', exact: true });
		await expect(preview).toBeVisible();
		await expect(preview.getByRole('heading', { name: 'Field session', level: 1 })).toBeVisible();
		await expect(preview.locator('strong')).toHaveText('First take');
		await expect(preview.locator('em')).toHaveText('soft attack');
		await expect(preview.locator('code')).toHaveText('room tone');
		await expect(preview.getByRole('list')).toHaveCount(2);
		await expect(preview.getByRole('listitem')).toHaveText(['Clap sync', 'Check noise', 'Main take', 'Pickup']);
		await expect(preview).toContainText('<img src=x onerror="window.recordingNotesUnsafe=true">');
		await expect(preview.getByRole('link')).toHaveCount(0);
		await expect(preview.locator('img, script')).toHaveCount(0);
		expect(await page.evaluate(() => globalThis.recordingNotesUnsafe ?? false)).toBe(false);
		await panel.getByRole('button', { name: 'Edit', exact: true }).click();
		await expect(notes).toHaveValue(markdown);
		await closeWorkspacePanel(editor, 'recording-notes');
		await expect(notes).toHaveCount(0);
		await openRecordingNotes(page, editor);
		await expect(notes).toHaveValue(markdown);
		expect(errors).toEqual([]);
	});

	test('keeps notes with their project when switching immediately and reloading', async ({ page }) => {
		const errors = collectClientErrors(page);
		let editor = await bootEditor(page, '/embed/en/');
		await renameProject(page, editor, 'Field session');
		let notes = await openRecordingNotes(page, editor);
		const firstNotes = '# Field session\n\n- Café ambience\n- Take **three** is best.\n';
		await notes.fill(firstNotes);
		await chooseFileAction(page, editor, 'New');
		await waitForProjectActivation(editor);
		await expect(notes).toHaveValue('');
		await renameProject(page, editor, 'Pickup session');
		const secondNotes = '## Pickups\n\nRecord *one more* quiet take.';
		await notes.fill(secondNotes);
		await chooseNestedCommandAction(page, editor, 'Window', ['Field session']);
		await waitForProjectActivation(editor);
		await expect(notes).toHaveValue(firstNotes);
		await chooseNestedCommandAction(page, editor, 'Window', ['Pickup session']);
		await waitForProjectActivation(editor);
		await expect(notes).toHaveValue(secondNotes);
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');

		await page.reload();
		editor = await waitForEditor(page);
		await waitForProjectActivation(editor);
		notes = editor.getByRole('textbox', { name: 'Recording notes', exact: true });
		await expect(notes).toHaveValue(secondNotes);
		await chooseNestedCommandAction(page, editor, 'File', ['Project management', 'Local projects']);
		const projects = page.getByRole('dialog', { name: 'Local projects', exact: true });
		await projects.getByRole('button', { name: /^Field session Last edited:/u }).click();
		await expect(projects).toHaveCount(0);
		await waitForProjectActivation(editor);
		await expect(notes).toHaveValue(firstNotes);
		expect(errors).toEqual([]);
	});

	test('saves a notes-only project archive and restores its notes when reopened as a copy', async ({ page }) => {
		test.setTimeout(60_000);
		await disableNativeSavePicker(page);
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		const notes = await openRecordingNotes(page, editor);
		const markdown = '# Recording plan\n\n1. **Check levels**\n2. Capture `room tone`\n';
		await notes.fill(markdown);
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
		const originalProjectId = await editor.getAttribute('data-project-id');
		const downloading = page.waitForEvent('download');
		await chooseExportProjectFileAction(page, editor);
		const download = await downloading;
		expect(download.suggestedFilename()).toMatch(/\.sscape$/u);
		const archive = await downloadBytes(download);
		await download.delete();
		await notes.fill('Changes made after the archive was saved.');
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');

		const choosing = page.waitForEvent('filechooser');
		await chooseFileAction(page, editor, 'Open');
		await (await choosing).setFiles({
			name: 'recording-notes.sscape',
			mimeType: 'application/vnd.soundscaper.scape+zip',
			buffer: Buffer.from(archive),
		});
		const collision = page.getByRole('dialog', { name: 'Project already exists', exact: true });
		await expect(collision).toBeVisible({ timeout: 20_000 });
		await collision.getByRole('button', { name: 'Open as copy', exact: true }).click();
		await expect.poll(() => editor.getAttribute('data-project-id'), { timeout: 20_000 })
			.not.toBe(originalProjectId);
		await waitForProjectActivation(editor);
		await expect(notes).toHaveValue(markdown);
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
		expect(errors).toEqual([]);
	});
});
