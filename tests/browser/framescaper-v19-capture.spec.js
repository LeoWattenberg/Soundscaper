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

test.describe('Framescaper capture activation', () => {
	registerAudioEditorHooks();

	for (const route of ['/framescaper/en/', '/framescaper/embed/en/']) {
		test(`selected V31 keeps capture cold until menu opt-in on ${route.includes('/embed/') ? 'embedded' : 'standalone'} route`, async ({ page }) => {
			await installCapturePermissionSentinel(page);
			const editor = await bootEditor(page, route);

			await expect(editor.locator('[data-transport="record"]')).toHaveCount(0);
			await expect(editor.getByRole('button', { name: 'Recording setup', exact: true })).toHaveCount(0);
			await expect(editor.getByRole('button', { name: 'Stop and import', exact: true })).toHaveCount(0);
			await expect(editor.locator('[data-workspace-panel="recording-setup"]')).toHaveCount(0);

			const panels = await openNestedCommandMenu(page, editor, 'View', ['Panels']);
			const setup = getMenuItem(panels, 'Recording setup');
			await expect(setup).toHaveCount(1);
			await setup.click();
			await expect(editor.locator('[data-workspace-panel="recording-setup"]')).toHaveCount(1);
			await expect(editor.getByRole('button', { name: 'Recording setup', exact: true })).toHaveCount(1);
			await expect.poll(() => page.evaluate(() => globalThis.__framescaperCapturePermissionCalls))
				.toEqual([]);
		});
	}

	test('capture remains default-hidden while opt-in and recovery keep control reachable', () => {
		expect(workspacePanelAvailable(
			'framescaper', FRAMESCAPER_CAPTURE_PANEL_ID, null, { phase: 'inactive' },
		)).toBe(true);
		expect(framescaperCaptureRecordVisible('framescaper', { phase: 'inactive' }, false)).toBe(false);
		expect(framescaperCaptureRecordVisible('framescaper', { phase: 'inactive' }, true)).toBe(true);
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
			throw new DOMException('Selected V31 must not request capture permission implicitly.', 'NotAllowedError');
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
