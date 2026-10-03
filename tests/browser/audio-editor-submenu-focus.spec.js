/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	getMenuItem,
	openNestedCommandMenu,
	registerAudioEditorHooks,
} from './audio-editor-test-helpers.js';

test.describe('application submenu focus', () => {
	registerAudioEditorHooks();

	test('does not reclaim focus after the user moves to another submenu command', async ({ page }) => {
		await page.addInitScript(() => {
			// Hold submenu focus timers until after the next item is focused.
			const schedule = window.setTimeout.bind(window);
			window.setTimeout = (callback, delay, ...args) => schedule(
				callback,
				globalThis.__delaySubmenuTimers && delay === 0 ? 150 : delay,
				...args,
			);
		});
		const editor = await bootEditor(page, '/embed/en/');
		await page.evaluate(() => { globalThis.__delaySubmenuTimers = true; });
		const submenu = await openNestedCommandMenu(page, editor, 'View', ['Workspace']);
		const audacity = getMenuItem(submenu, 'Audacity');
		await audacity.focus();
		await expect(audacity).toBeFocused();
		await page.waitForTimeout(400);
		await expect(audacity).toBeFocused();
	});
});
