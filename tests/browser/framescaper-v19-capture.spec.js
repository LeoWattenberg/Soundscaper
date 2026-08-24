/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	expect,
	test,
} from './audio-editor-test-fixtures.js';
import {
	FRAMESCAPER_CAPTURE_PANEL_ID,
	framescaperCaptureRecordVisible,
	workspacePanelAvailable,
} from '../../src/common/editor/ui/framescaper-capture-ui-model.ts';
import {
	bootEditor,
	getMenuItem,
	openNestedCommandMenu,
	registerAudioEditorHooks,
} from './audio-editor-test-helpers.js';

test.describe('Framescaper dormant capture boundary', () => {
	registerAudioEditorHooks();

	for (const route of ['/framescaper/en/', '/framescaper/embed/en/']) {
		test(`selected V28 exposes no capture authoring on ${route.includes('/embed/') ? 'embedded' : 'standalone'} route`, async ({ page }) => {
			await installCapturePermissionSentinel(page);
			const editor = await bootEditor(page, route);

			await expect(editor.locator('[data-transport="record"]')).toHaveCount(0);
			await expect(editor.getByRole('button', { name: 'Recording setup', exact: true })).toHaveCount(0);
			await expect(editor.getByRole('button', { name: 'Stop and import', exact: true })).toHaveCount(0);
			await expect(editor.locator('[data-workspace-panel="recording-setup"]')).toHaveCount(0);

			const panels = await openNestedCommandMenu(page, editor, 'View', ['Panels']);
			await expect(getMenuItem(panels, 'Recording setup')).toHaveCount(0);
			await page.keyboard.press('Escape');
			await page.keyboard.press('Escape');

			await editor.getByRole('button', { name: 'Customize toolbar', exact: true }).click();
			const toolbar = page.getByRole('dialog', { name: 'Customize toolbar', exact: true });
			await expect(toolbar.getByRole('checkbox', { name: 'Recording setup', exact: true })).toHaveCount(0);
			await page.keyboard.press('Escape');
			await expect.poll(() => page.evaluate(() => globalThis.__framescaperCapturePermissionCalls))
				.toEqual([]);
		});
	}

	test('historical recovery visibility stays bounded to an existing recovery state', () => {
		expect(workspacePanelAvailable(
			'framescaper', FRAMESCAPER_CAPTURE_PANEL_ID, null, { phase: 'inactive' },
		)).toBe(false);
		expect(framescaperCaptureRecordVisible('framescaper', { phase: 'inactive' }, true)).toBe(false);
		expect(workspacePanelAvailable(
			'framescaper', FRAMESCAPER_CAPTURE_PANEL_ID, null, { phase: 'recovery' },
		)).toBe(true);
		expect(framescaperCaptureRecordVisible('framescaper', { phase: 'recovery' }, false)).toBe(true);
	});
});

async function installCapturePermissionSentinel(page) {
	await page.addInitScript(() => {
		const calls = [];
		const reject = async (kind) => {
			calls.push(kind);
			throw new DOMException('Selected V28 must not request capture permission.', 'NotAllowedError');
		};
		Object.defineProperty(globalThis, '__framescaperCapturePermissionCalls', {
			configurable: true,
			value: calls,
		});
		Object.defineProperty(navigator, 'mediaDevices', {
			configurable: true,
			value: Object.freeze({
				enumerateDevices: async () => [],
				getUserMedia: async () => reject('user'),
				getDisplayMedia: async () => reject('display'),
			}),
		});
	});
}
