/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, dockWorkspacePanel } from './audio-editor-test-helpers.js';
import { installWebVcrHost } from './helpers/web-vcr-host.js';

test('Web VCR manual crop retains its first native touch gesture', async ({ page, browserName }) => {
	test.skip(browserName !== 'chromium', 'The packaged host and native multi-touch protocol use Chromium.');
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
	await dockWorkspacePanel(editor, 'web-vcr', 'floating');
	const crop = panel.locator('.kw-web-vcr__crop--manual');
	const preview = panel.locator('[data-web-vcr-preview]');
	const move = panel.getByRole('button', { name: 'Move crop area', exact: true });
	const bounds = await preview.boundingBox();
	const handle = await move.boundingBox();
	expect(bounds).not.toBeNull();
	expect(handle).not.toBeNull();
	const initial = await crop.evaluate(element => parseFloat(element.style.left));
	const start = { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2, id: 1 };
	await page.mouse.move(start.x, start.y);
	await page.mouse.down();
	await page.mouse.move(start.x + 10, start.y, { steps: 3 });
	await page.mouse.up();
	await expect.poll(() => crop.evaluate(element => parseFloat(element.style.left))).toBeCloseTo(initial + 1000 / bounds.width, 2);
	const baseline = await crop.evaluate(element => parseFloat(element.style.left));
	const now = await move.boundingBox();
	const first = { x: now.x + now.width / 2, y: now.y + now.height / 2, id: 1 };
	const middle = { ...first, x: first.x + 10 };
	const secondary = { ...middle, id: 2 };
	const final = { ...first, x: first.x + 20 };
	const native = await page.context().newCDPSession(page);
	await native.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [first] });
	await native.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [middle] });
	await native.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [middle, secondary] });
	await native.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [final, secondary] });
	await native.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
	await expect.poll(() => crop.evaluate(element => parseFloat(element.style.left))).toBeCloseTo(baseline + 2000 / bounds.width, 2);
});
