/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { createPngFixture } from '../helpers/png-fixture.mjs';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, closeWorkspacePanel, openClipProperties } from './audio-editor-test-helpers.js';

for (const kind of ['title', 'image']) test(`sequence rate preserves an ordinary ${kind}'s wall-clock duration`, async ({ page }) => {
	// Four property inspections plus Undo/Redo take nearly 30 seconds in WebKit.
	test.setTimeout(60_000);
	const editor = await bootEditor(page, '/framescaper/en/');
	await chooseNestedCommandAction(page, editor, 'File', ['Project management', 'Project properties']);
	const metadata = editor.locator('[data-workspace-panel="metadata"]');
	await metadata.getByRole('tab', { name: 'Sequence timing', exact: true }).click();
	const rate = metadata.getByRole('combobox', { name: 'Frame rate', exact: true });
	await expect(rate).toHaveValue('30/1');
	if (kind === 'title') {
		await rate.selectOption('25/1');
		await expect(rate).toHaveValue('25/1');
		await chooseCommandAction(page, editor, 'Edit', 'Undo');
		await expect(rate).toHaveValue('30/1');
	}
	if (kind === 'title') {
		await chooseNestedCommandAction(page, editor, 'Generate', ['Video Generators', 'Add Title/Text']);
	} else {
		const chooser = page.waitForEvent('filechooser');
		await chooseNestedCommandAction(page, editor, 'Generate', ['Add Images']);
		await (await chooser).setFiles({ name: 'poster.png', mimeType: 'image/png', buffer: createPngFixture(16) });
	}
	const clip = editor.getByRole('group', { name: kind === 'title' ? 'Video clip: Title' : 'Image clip: poster', exact: true });
	await expect(clip).toBeVisible();
	const readDuration = async () => {
		const properties = await openClipProperties(page, editor, clip);
		await properties.locator('summary').filter({ hasText: 'Media settings' }).click();
		const digits = await properties.getByRole('group', { name: 'Duration', exact: true }).locator('.timecode-digit').allTextContents();
		await closeWorkspacePanel(editor, 'clip-properties');
		return digits.join('');
	};
	expect(await readDuration()).toBe('000005000');
	await rate.selectOption('25/1');
	await expect(rate).toHaveValue('25/1');
	expect(await readDuration()).toBe('000005000');
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(rate).toHaveValue('30/1');
	expect(await readDuration()).toBe('000005000');
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	await expect(rate).toHaveValue('25/1');
	expect(await readDuration()).toBe('000005000');
});
