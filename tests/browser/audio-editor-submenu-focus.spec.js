/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { flushFocusCallbacks, holdFocusCallbacks, installControlledFocusCallbacks } from './helpers/controlled-focus-callbacks.js';
import {
	bootEditor,
	getMenuItem,
	openNestedCommandMenu,
	registerAudioEditorHooks,
} from './audio-editor-test-helpers.js';

test.describe('application submenu focus', () => {
	registerAudioEditorHooks();

	test('does not reclaim focus after the user moves to another submenu command', async ({ page }) => {
		await installControlledFocusCallbacks(page, 'timeout');
		const editor = await bootEditor(page, '/embed/en/');
		await holdFocusCallbacks(page);
		const submenu = await openNestedCommandMenu(page, editor, 'View', ['Workspace']);
		const audacity = getMenuItem(submenu, 'Audacity');
		await audacity.focus();
		await expect(audacity).toBeFocused();
		expect(await flushFocusCallbacks(page)).toBeGreaterThan(0);
		await expect(audacity).toBeFocused();
	});
});
