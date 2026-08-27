/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from '@playwright/test';

test('browser preferences do not retain the legacy offline FFmpeg runtime', async ({ page }) => {
	const runtimeRequests = [];
	page.on('request', (request) => {
		if (/assets\.soundscaper\.org\/runtime\/ffmpeg|ffmpeg-core\.(?:js|wasm)/iu.test(request.url())) {
			runtimeRequests.push(request.url());
		}
	});

	await page.goto('/en/');
	const editor = page.locator('[data-audio-editor]');
	await expect(editor).toHaveAttribute('data-audio-editor-bound', 'true', { timeout: 20_000 });
	await chooseCommand(page, editor, 'Edit', 'Preferences');

	const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await expect(preferences.getByRole('tab', { name: /Offline$/u })).toHaveCount(0);
	await expect(preferences.locator('[data-offline-ffmpeg-runtime]')).toHaveCount(0);
	expect(runtimeRequests).toEqual([]);
});

async function chooseCommand(page, editor, menuName, commandName) {
	const menubar = editor.getByRole('menubar', { name: 'Application menu', exact: true });
	await menubar.getByRole('menuitem', { name: menuName, exact: true }).click();
	const menu = page.getByRole('menu', { name: menuName, exact: true });
	await expect(menu).toBeVisible();
	await menu.getByRole('menuitem', { name: new RegExp(`^${commandName}(?:\\s|$)`) }).first().click();
}
