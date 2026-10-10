/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, stubStorageEstimate } from './audio-editor-test-helpers.js';
import { createDeterministicSilentVideoFixture } from './fixtures/deterministic-av-media.js';
import { openAssistanceTask } from './helpers/assistance-task-menu.js';
import { completeMilestone7Run, installMilestone7LocalAssistanceFixture } from './helpers/milestone-7-local-assistance.js';

test('Guided Reframe retains its first native crop contact', async ({ page, browserName }) => {
	test.skip(browserName !== 'chromium', 'Native two-contact input uses Chromium.');
	test.setTimeout(90_000);
	await stubStorageEstimate(page, { usage: 1024 ** 2, quota: 2 * 1024 ** 3 });
	await installMilestone7LocalAssistanceFixture(page);
	const editor = await bootEditor(page, '/framescaper/en/');
	await editor.locator('[data-project-bin-input]').setInputFiles([createDeterministicSilentVideoFixture('crop-touch.webm')]);
	await editor.getByRole('button', { name: 'Add to timeline: crop-touch', exact: true }).click();
	const clip = editor.getByRole('group', { name: /^Video clip:/u }).first();
	await clip.press('Enter');
	await openAssistanceTask(page, editor, 'Reframe');
	const dialog = page.locator('[data-local-assistance]');
	page.on('dialog', async nativeDialog => { await nativeDialog.accept(); });
	await dialog.getByRole('button', { name: 'Run locally', exact: true }).click();
	await expect(dialog.getByRole('status', { name: 'Processing status' })).toHaveText('Processing selected media locally');
	await completeMilestone7Run(page);
	await expect(dialog.getByRole('status', { name: 'Processing status' })).toContainText('Processing finished.');
	await dialog.getByRole('button', { name: 'Review result', exact: true }).click();
	const review = dialog.getByRole('region', { name: 'Guided workflow review', exact: true });
	const horizontal = review.getByRole('slider', { name: 'Horizontal position', exact: true });
	await horizontal.fill('0.2');
	await expect(horizontal).toHaveValue('0.2');
	const box = await review.locator('.kw-local-assistance__crop-overlay').boundingBox();
	expect(box).not.toBeNull();
	const point = (fraction, id = 1) => ({ x: box.x + box.width * fraction,
		y: box.y + box.height * 0.5, id });
	const first = point(0.5);
	const middle = point(0.6);
	const end = point(0.65);
	const other = point(0.25, 2);
	const native = await page.context().newCDPSession(page);
	await native.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [first] });
	await native.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [end] });
	await native.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
	const healthyEnd = await horizontal.inputValue();
	expect(Number(healthyEnd)).toBeGreaterThan(0.2);
	await horizontal.fill('0.2');
	await native.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [first] });
	await native.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [middle] });
	const held = await horizontal.inputValue();
	expect(Number(held)).toBeGreaterThan(0.2);
	await native.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [middle, other] });
	await expect(horizontal).toHaveValue(held);
	await native.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [middle] });
	await native.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [end] });
	await native.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
	await expect(horizontal).toHaveValue(healthyEnd);
});
