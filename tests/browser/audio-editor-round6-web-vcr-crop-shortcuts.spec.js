/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction } from './audio-editor-test-helpers.js';
import { installWebVcrHost } from './helpers/web-vcr-host.js';

test('Web VCR manual crop releases modified arrows and keeps ordinary movement', async ({ page, browserName }) => {
	test.skip(browserName !== 'chromium', 'The packaged Web VCR host uses Chromium capture support.');
	await installWebVcrHost(page);
	const editor = await bootEditor(page, '/framescaper/en/');
	await chooseCommandAction(page, editor, 'Window', 'Recording setup');
	const setup = editor.locator('[data-workspace-panel="recording-setup"] [data-framescaper-recording-setup]');
	await expect(setup.getByRole('status')).not.toContainText('Checking capture support');
	await editor.getByRole('button', { name: 'Capture options', exact: true }).click();
	await page.getByRole('menuitem', { name: 'Web VCR', exact: true }).click();
	const panel = editor.locator('[data-workspace-panel="web-vcr"] [data-framescaper-web-vcr]');
	await expect(panel).toHaveAttribute('data-web-vcr-phase', 'ready');
	await panel.getByRole('checkbox', { name: 'Auto-crop', exact: true }).uncheck();
	const crop = panel.locator('.kw-web-vcr__crop--manual');
	const move = panel.getByRole('button', { name: 'Move crop area', exact: true });
	const initial = await crop.getAttribute('style');
	await move.press('ArrowRight');
	await expect(crop).not.toHaveAttribute('style', initial);
	const ordinary = await crop.getAttribute('style');
	await move.press('Control+ArrowRight');
	await expect(crop).toHaveAttribute('style', ordinary);
	await move.press('ArrowLeft');
	await expect(crop).toHaveAttribute('style', initial);
});
