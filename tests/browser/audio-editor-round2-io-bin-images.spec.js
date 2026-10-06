/* SPDX-License-Identifier: AGPL-3.0-only */

import { EDITOR_ENGLISH_COPY } from '../../src/common/i18n/editor-copy-inventory.ts';
import { createPngFixture } from '../helpers/png-fixture.mjs';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction } from './audio-editor-test-helpers.js';

test('an ordinary still image can return from Project Bin to the video timeline', async ({ page }) => {
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	const chooser = page.waitForEvent('filechooser');
	await chooseNestedCommandAction(page, editor, 'Generate', [EDITOR_ENGLISH_COPY['ui.framescaperMenus.addVideoStill']]);
	await (await chooser).setFiles({ name: 'poster.png', mimeType: 'image/png', buffer: createPngFixture(16) });
	const clip = editor.getByRole('group', { name: 'Image clip: poster', exact: true });
	await expect(clip).toBeVisible();
	await clip.press('Enter');
	await clip.click({ button: 'right' });
	await page.getByRole('menuitem', { name: 'Move to Project bin', exact: true }).click();
	const card = editor.locator('[data-project-bin-item]').first();
	await expect(card).toBeVisible();
	await expect(clip).toHaveCount(0);
	await expect(card.locator('.kw-audio-editor__project-bin-meta')).toContainText('0:05.0');
	await expect(card.locator('.kw-audio-editor__project-bin-meta')).toContainText('PNG · 16×16');
	await card.getByRole('button', { name: /^Add to timeline:/u }).click();
	await expect(clip).toBeVisible();
	const name = card.locator('[data-project-bin-name]');
	await name.click();
	await name.fill('Renamed poster');
	await expect(name).toHaveValue('Renamed poster');
	await name.press('Enter');
	const renamed = editor.getByRole('group', { name: 'Image clip: Renamed poster', exact: true });
	await expect(renamed).toBeVisible();
	await card.getByRole('button', { name: /^Select all instances:/u }).click();
	await expect(renamed.locator('.clip-display')).toHaveClass(/clip-display--selected/u);
	await card.getByRole('button', { name: /^More file actions:/u }).click();
	await expect(page.getByRole('menuitem', { name: 'Replace', exact: true })).toHaveAttribute('aria-disabled', 'true');
	await page.getByRole('menuitem', { name: 'Remove from Project bin', exact: true }).click();
	await expect(card).toHaveCount(0);
	await expect(renamed).toBeVisible();
	await chooseNestedCommandAction(page, editor, 'Edit', ['Undo']);
	await expect(card).toBeVisible();
	await card.getByRole('button', { name: /^More file actions:/u }).click();
	await page.getByRole('menuitem', { name: 'Remove from project', exact: true }).click();
	await page.getByRole('alertdialog').getByRole('button', { name: 'Remove from project', exact: true }).click();
	await expect(card).toHaveCount(0);
	await expect(renamed).toHaveCount(0);
	await chooseNestedCommandAction(page, editor, 'Edit', ['Undo']);
	await expect(card).toBeVisible();
	await expect(renamed).toBeVisible();
});
