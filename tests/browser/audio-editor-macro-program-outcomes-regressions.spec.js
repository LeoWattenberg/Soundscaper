/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction } from './audio-editor-test-helpers.js';

async function programEditor(page, source) {
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Tools', 'Macros palette');
	const manager = page.getByRole('dialog', { name: 'Macros palette', exact: true });
	await manager.getByRole('button', { name: 'New program', exact: true }).click();
	await manager.getByRole('textbox', { name: 'Program', exact: true }).fill(source);
	await manager.getByRole('button', { name: 'Run program', exact: true }).click();
	return manager;
}

test('canceling a long macro program reports cancellation without a failure alert', async ({ page }) => {
	const manager = await programEditor(page, 'for (let i = 0; i < 10000; i++) await sound.project.tracks();');
	await manager.getByRole('button', { name: 'Cancel run', exact: true }).click();
	await expect(manager.locator('[data-macro-script-log]')).toHaveAttribute('data-outcome', 'cancelled');
	await expect(manager.locator('[data-macro-script-failure]')).toHaveCount(0);
	await expect(manager.getByRole('button', { name: 'Run program', exact: true })).toBeEnabled();
});

test('a failed program retains the diagnostic log written before its error', async ({ page }) => {
	const manager = await programEditor(page, "sound.log.info('before error'); throw new Error('example error');");
	await expect(manager.locator('[data-macro-script-failure]')).toContainText('example error');
	await expect(manager.locator('[data-macro-script-log]')).toContainText('before error');
});
