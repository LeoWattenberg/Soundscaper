/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	getMenuItem,
	openNestedCommandMenu,
	registerAudioEditorHooks,
} from './audio-editor-test-helpers.js';

/** The script requests the page has made for the deferred capture runtime's own chunk. */
async function captureChunkRequests(page) {
	return page.evaluate(() => performance.getEntriesByType('resource')
		.map((entry) => entry.name)
		.filter((name) => /editor-optional-capture/u.test(name)));
}

test.describe('Framescaper deferred capture runtime', () => {
	registerAudioEditorHooks();

	test('a cold boot leaves the capture stack unfetched until setup opens', async ({ page }) => {
		// The startup budget measures the static graph, so only the browser can
		// prove the deferral is real: nothing may fetch the capture chunk before a
		// setup gesture, and the first such gesture must fetch it and settle the
		// panel out of its idle "checking" state.
		const editor = await bootEditor(page, '/framescaper/en/');
		await expect(editor.locator('[data-workspace-panel="recording-setup"]')).toHaveCount(0);
		expect(await captureChunkRequests(page)).toEqual([]);

		const panels = await openNestedCommandMenu(page, editor, 'View', ['Panels']);
		const setupItem = getMenuItem(panels, 'Recording setup');
		await setupItem.focus();
		await setupItem.press('Enter');

		const setup = editor.locator('[data-workspace-panel="recording-setup"] [data-framescaper-recording-setup]');
		await expect(setup).toBeVisible();
		await expect.poll(async () => (await captureChunkRequests(page)).length).toBeGreaterThan(0);
		await expect(setup.getByRole('status')).not.toContainText('Checking capture support');
	});
});
