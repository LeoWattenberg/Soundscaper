/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, disableNativeSavePicker } from './audio-editor-test-helpers.js';

test('importing a copy of an authored program leaves the original runnable', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Tools', 'Macros palette');
	const manager = page.getByRole('dialog', { name: 'Macros palette', exact: true });
	await manager.getByRole('button', { name: 'New program', exact: true }).click();
	await manager.getByRole('textbox', { name: 'Program', exact: true }).fill("sound.log.info('Original authored program ran');");
	const [download] = await Promise.all([
		page.waitForEvent('download'),
		manager.getByRole('button', { name: 'Export program', exact: true }).click(),
	]);
	const path = await download.path();
	expect(path).not.toBeNull();
	const [chooser] = await Promise.all([
		page.waitForEvent('filechooser'),
		manager.getByRole('button', { name: 'Import program', exact: true }).click(),
	]);
	await chooser.setFiles(path);
	await expect(manager.locator('[data-macro-script-trust="imported-untrusted"]')).toHaveCount(1);
	await manager.locator('[data-macro-script-trust="authored"]').click();
	const run = manager.getByRole('button', { name: 'Run program', exact: true });
	await expect(run).toBeEnabled();
	await run.click();
	const log = manager.locator('[data-macro-script-log]');
	await expect(log).toContainText('Original authored program ran');
	await expect(log).toHaveAttribute('data-outcome', 'completed');
	await expect(manager.locator('[data-macro-script-failure]')).toHaveCount(0);
});
