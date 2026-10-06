/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction } from './audio-editor-test-helpers.js';

async function newProgram(page) {
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Tools', 'Macros palette');
	const manager = page.getByRole('dialog', { name: 'Macros palette', exact: true });
	await manager.getByRole('button', { name: 'New program', exact: true }).click();
	return manager;
}

async function reimportProgram(page) {
	const manager = await newProgram(page);
	await manager.getByRole('textbox', { name: 'Program', exact: true }).fill("sound.log.info('hello');");
	const [download] = await Promise.all([
		page.waitForEvent('download'),
		manager.getByRole('button', { name: 'Export program', exact: true }).click(),
	]);
	const file = await download.path();
	expect(file).not.toBeNull();
	await manager.getByRole('button', { name: 'Delete program', exact: true }).click();
	const [chooser] = await Promise.all([
		page.waitForEvent('filechooser'),
		manager.getByRole('button', { name: 'Import program', exact: true }).click(),
	]);
	await chooser.setFiles(file);
	return manager;
}

test('clicking the review checkbox enables an exported and reimported program', async ({ page }) => {
	await page.setViewportSize({ width: 1280, height: 1000 });
	const manager = await reimportProgram(page);
	const review = manager.locator('[data-macro-script-review]');
	await review.getByRole('checkbox').click();
	await expect(review.getByRole('checkbox')).toBeChecked();
	await manager.locator('.audio-editor-macro-script__actions').getByRole('button').click();
	await expect(manager.getByRole('button', { name: 'Run program', exact: true })).toBeEnabled();
});

test('the program import message leaves its review checkbox reachable in a normal window', async ({ page }) => {
	await page.setViewportSize({ width: 1280, height: 720 });
	const manager = await reimportProgram(page);
	const checkbox = manager.locator('[data-macro-script-review]').getByRole('checkbox');
	await checkbox.scrollIntoViewIfNeeded();
	const reachable = await checkbox.evaluate((element) => {
		const bounds = element.getBoundingClientRect();
		return element.contains(element.ownerDocument.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2));
	});
	expect(reachable).toBe(true);
	await checkbox.click();
	await expect(checkbox).toBeChecked();
});

test('Escape then Tab leaves the program textarea without closing the palette', async ({ page }) => {
	const manager = await newProgram(page);
	const program = manager.getByRole('textbox', { name: 'Program', exact: true });
	await program.focus();
	await program.press('Escape');
	await expect(manager).toBeVisible();
	await program.press('Tab');
	await expect(program).not.toBeFocused();
	await expect(manager).toBeVisible();
});
