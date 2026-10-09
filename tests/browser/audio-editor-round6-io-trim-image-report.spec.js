/* SPDX-License-Identifier: AGPL-3.0-only */

import { EDITOR_ENGLISH_COPY } from '../../src/common/i18n/editor-copy-inventory.ts';
import { createPngFixture } from '../helpers/png-fixture.mjs';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction } from './audio-editor-test-helpers.js';

test('Trim media reports a live image as retained and preserves its saved clip', async ({ page }) => {
	const editor = await bootEditor(page, '/framescaper/en/');
	const projectId = await editor.getAttribute('data-project-id');
	const chooser = page.waitForEvent('filechooser');
	await chooseNestedCommandAction(page, editor, 'Generate', [EDITOR_ENGLISH_COPY['ui.framescaperMenus.addVideoStill']]);
	await (await chooser).setFiles({ name: 'poster.png', mimeType: 'image/png', buffer: createPngFixture(16) });
	const clip = editor.getByRole('group', { name: 'Image clip: poster', exact: true });
	await expect(clip).toBeVisible();
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	await chooseNestedCommandAction(page, editor, 'File', ['Project management', 'Trim media to what is used']);
	await expect(editor.locator('[data-status]')).toHaveAttribute('data-state', 'success');
	await chooseCommandAction(page, editor, 'File', 'Delivery Report');
	const report = page.getByRole('dialog', { name: 'Delivery Report', exact: true });
	await expect(report).not.toContainText('No clip references this source');
	await expect(report.locator('dl > div').filter({ has: page.getByText('Preserved', { exact: true }) }).locator('dd')).toHaveText('1');
	await expect(report.locator('[data-severity="warning"]')).toHaveCount(0);
	await report.getByRole('button', { name: 'Close', exact: true }).last().click();
	await page.reload();
	await expect(editor).toHaveAttribute('data-audio-editor-bound', 'true');
	await expect(editor).toHaveAttribute('data-project-id', projectId);
	await expect(clip).toBeVisible();
	await expect(clip.locator('[data-product-visual-thumbnail]')).toHaveCount(1);
});
