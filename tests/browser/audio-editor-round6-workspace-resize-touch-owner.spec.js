/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, dockWorkspacePanel } from './audio-editor-test-helpers.js';

for (const secondFinger of [false, true]) test(`floating panel resizing retains ${secondFinger ? 'the first of two native fingers' : 'one native finger'}`, async ({ page, browserName }) => {
	test.skip(browserName !== 'chromium', 'Native multi-touch uses the Chromium input protocol.');
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Window', 'Markers');
	await dockWorkspacePanel(editor, 'markers', 'floating');
	const panel = editor.locator('[data-workspace-panel="markers"]');
	const handle = panel.getByRole('button', { name: 'Resize: Markers', exact: true });
	const before = await panel.boundingBox();
	const bounds = await handle.boundingBox();
	expect(before).not.toBeNull(); expect(bounds).not.toBeNull();
	const mouse = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
	await page.mouse.move(mouse.x, mouse.y);
	await page.mouse.down();
	await page.mouse.move(mouse.x + 10, mouse.y, { steps: 3 });
	await page.mouse.up();
	await expect.poll(async () => (await panel.boundingBox()).width).toBeCloseTo(before.width + 10, 0);
	const baseline = await panel.boundingBox();
	const current = await handle.boundingBox();
	const first = { x: current.x + current.width / 2, y: current.y + current.height / 2, id: 1 };
	const middle = { ...first, x: first.x + 10 };
	const second = { ...middle, id: 2 };
	const final = { ...first, x: first.x + 12 };
	const native = await page.context().newCDPSession(page);
	await native.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [first] });
	await native.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [middle] });
	await expect.poll(async () => (await panel.boundingBox()).width).toBeCloseTo(baseline.width + 10, 0);
	if (secondFinger) await native.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [middle, second] });
	await native.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: secondFinger ? [final, second] : [final] });
	await native.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
	await expect.poll(async () => (await panel.boundingBox()).width).toBeCloseTo(baseline.width + 12, 0);
});
