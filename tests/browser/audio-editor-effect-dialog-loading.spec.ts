/* SPDX-License-Identifier: AGPL-3.0-only */

import { setTimeout as delay } from 'node:timers/promises';
import { expect, test } from './audio-editor-test-fixtures.js';
import { addRackEffect, bootEditor, closeDialog, openEffectsForTrack } from './audio-editor-test-helpers.js';

for (const name of ['Reverb', 'Echo']) {
	test(`${name} settings expose Close only with their loaded controls`, async ({ page }) => {
		let requested = false;
		await page.route('**/EffectParameterEditor-*.js', async route => {
			requested = true;
			// Deliberately model a cold chunk, not a wait for the application to settle.
			await delay(1000);
			await route.continue();
		});
		await page.addInitScript(() => {
			Reflect.set(globalThis, 'effectDialogExposedBeforeControls', false);
			new MutationObserver(() => {
				const dialog = document.querySelector('.audio-editor-effect-settings-dialog');
				if (dialog && !dialog.querySelector('[data-effect-param]')) {
					Reflect.set(globalThis, 'effectDialogExposedBeforeControls', true);
				}
			}).observe(document, { childList: true, subtree: true });
		});
		const editor = await bootEditor(page, '/embed/en/');
		const panel = await openEffectsForTrack(editor, 0);
		await addRackEffect(page, panel, 'track', name);
		const dialog = page.getByRole('dialog', { name, exact: true });
		await expect(dialog.locator('[data-effect-param]').first()).toBeVisible();
		expect(requested).toBe(true);
		// A partial centered dialog moves Close when its delayed body arrives,
		// losing a real pointer activation already in progress.
		expect(await page.evaluate(() => Reflect.get(globalThis, 'effectDialogExposedBeforeControls'))).toBe(false);
		await closeDialog(dialog);
		await expect(page.locator('[data-effects-window-host]')).toHaveCount(0);
	});
}
