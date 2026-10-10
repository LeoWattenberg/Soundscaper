/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseDropdown, chooseNestedCommandAction, clipByName, disableNativeSavePicker, importFiles, readDownloadBytes } from './audio-editor-test-helpers.js';

test('clip export uses the exact authored range of an ordinary native Title', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	await importFiles(editor, [toneA]);
	const recording = clipByName(editor, toneA.name);
	await recording.locator('.clip-header').click({ button: 'right' });
	const exportClip = page.getByRole('menuitem', { name: 'Export clip', exact: true });
	await expect(exportClip).toBeVisible();
	await exportClip.click();
	const dialog = page.getByRole('dialog', { name: /Export/u });
	await expect(dialog).toBeVisible();
	await expect(page.locator('[data-editor-toast="workspace-error"], [data-editor-toast="workspace-status-error"]')).toHaveCount(0);
	expect(await deliveredFrames(page, dialog)).toBe(38_400);
	await dialog.getByRole('button', { name: 'Close', exact: true }).click();
	await chooseNestedCommandAction(page, editor, 'Generate', ['Video Generators', 'Add Title/Text']);
	const title = editor.getByRole('group', { name: 'Video clip: Title', exact: true });
	await title.locator('.clip-header').click({ button: 'right' });
	await expect(exportClip).toBeVisible();
	await exportClip.click();
	await expect(dialog).toBeVisible();
	await expect(page.locator('[data-editor-toast="workspace-error"], [data-editor-toast="workspace-status-error"]')).toHaveCount(0);
	expect(await deliveredFrames(page, dialog)).toBe(240_000);
	await expect(editor).toHaveAttribute('data-clip-count', '2');
});

async function deliveredFrames(page, dialog) {
	await chooseDropdown(page, dialog.locator('[data-export-field="output"]'), 'Current selection');
	await dialog.getByRole('checkbox', { name: /^Include effect tails/u }).uncheck();
	const link = dialog.locator('[data-export-download]');
	const previous = await link.getAttribute('href');
	await dialog.getByRole('button', { name: 'Export', exact: true }).click();
	await expect(link).toBeVisible({ timeout: 20_000 });
	await expect(link).not.toHaveAttribute('href', previous ?? '');
	const bytes = await readDownloadBytes(page, link);
	return page.evaluate(async data => {
		const context = new OfflineAudioContext(2, 1, 48_000);
		const decoded = await context.decodeAudioData(Uint8Array.from(data).buffer);
		return decoded.length;
	}, Array.from(bytes));
}
