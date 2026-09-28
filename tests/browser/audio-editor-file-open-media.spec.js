/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseFileAction } from './audio-editor-test-helpers.js';

test('mobile File Open starts a new project for audio while File Import keeps the active project', async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	const editor = await bootEditor(page, '/embed/en/');
	const originalId = await editor.getAttribute('data-project-id');
	const first = createWavFixture({ name: 'phone-recording.wav', frequency: 330 });

	const opening = page.waitForEvent('filechooser');
	await chooseFileAction(page, editor, 'Open');
	const chooser = await opening;
	const accepted = (await (await chooser.element()).getAttribute('accept'))?.split(',');
	expect(accepted).toEqual(expect.arrayContaining(['.aup4', 'audio/*', '.wav', '.mp4', '.cue', '.srt']));
	await chooser.setFiles(first);
	await expect.poll(() => editor.getAttribute('data-project-id')).not.toBe(originalId);
	const openedId = await editor.getAttribute('data-project-id');
	await expect(editor).toHaveAttribute('data-clip-count', '1', { timeout: 20_000 });

	const importing = page.waitForEvent('filechooser');
	await chooseFileAction(page, editor, 'Import');
	await (await importing).setFiles(createWavFixture({ name: 'second-take.wav', frequency: 660 }));
	await expect(editor).toHaveAttribute('data-clip-count', '2', { timeout: 20_000 });
	await expect(editor).toHaveAttribute('data-project-id', openedId);

	await page.setViewportSize({ width: 1280, height: 800 });
	const tabs = editor.getByRole('navigation', { name: 'Project tabs' }).getByRole('tab');
	await expect(tabs).toHaveCount(2);
	await expect(tabs.last()).toContainText('phone-recording');
	await tabs.first().click();
	await expect(editor).toHaveAttribute('data-project-id', originalId);
	await expect(editor).toHaveAttribute('data-clip-count', '0');
	await tabs.last().click();
	await expect(editor).toHaveAttribute('data-project-id', openedId);
	await expect(editor).toHaveAttribute('data-clip-count', '2');
});

test('mobile File Open creates a project before asking where to import a CUE sheet', async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	const editor = await bootEditor(page, '/embed/en/');
	const originalId = await editor.getAttribute('data-project-id');
	const choosingFile = page.waitForEvent('filechooser');
	await chooseFileAction(page, editor, 'Open');
	await (await choosingFile).setFiles({
		name: 'album.cue',
		mimeType: 'application/x-cue',
		buffer: Buffer.from('TITLE "Album"\nTRACK 01 AUDIO\n TITLE "Intro"\n INDEX 01 00:00:00\nTRACK 02 AUDIO\n TITLE "Song"\n INDEX 01 00:01:00'),
	});
	await expect.poll(() => editor.getAttribute('data-project-id')).not.toBe(originalId);
	const openedId = await editor.getAttribute('data-project-id');
	const dialog = page.getByRole('dialog', { name: 'Import', exact: true });
	await expect(dialog).toContainText('album.cue');
	await dialog.getByRole('button', { name: 'Labels', exact: true }).click();
	await expect(editor.locator('[data-label-track] [data-label-id]')).toHaveCount(2);
	await expect(editor).toHaveAttribute('data-project-id', openedId);
});
