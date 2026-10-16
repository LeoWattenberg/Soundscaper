/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction } from './audio-editor-test-helpers.js';
import { createDeterministicSilentVideoFixture } from './fixtures/deterministic-av-media.js';

for (const interrupted of [false, true]) test(`a video opacity fade completes its native touch ${interrupted ? 'through a second finger' : 'alone'}`, async ({ page, browserName }) => {
	test.skip(browserName !== 'chromium', 'Native multi-touch uses the Chromium input protocol.');
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	await editor.locator('[data-project-bin-input]').setInputFiles(createDeterministicSilentVideoFixture('opacity-touch.webm'));
	await editor.locator('[data-project-bin-item]').first().getByRole('button', { name: /Add to timeline/u }).click();
	const clip = editor.getByRole('group', { name: /^Video clip:/u }).first();
	await clip.locator('.clip-header').click();
	const fade = clip.getByRole('slider', { name: 'Fade in', exact: true });
	await expect(fade).toHaveAttribute('aria-valuenow', '0');
	const value = async () => Number(await fade.getAttribute('aria-valuenow'));
	const box = await fade.boundingBox();
	expect(box).not.toBeNull();
	const first = { x: box.x + box.width / 2, y: box.y + box.height / 2, id: 1 };
	const final = { ...first, x: first.x + 20 };
	await page.mouse.move(first.x, first.y);
	await page.mouse.down();
	await page.mouse.move(final.x, final.y, { steps: 4 });
	await page.mouse.up();
	await expect.poll(value).toBeGreaterThan(0);
	const completed = await value();
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(fade).toHaveAttribute('aria-valuenow', '0');
	const releases = [];
	page.on('console', message => {
		if (message.text().startsWith('video-opacity-touch-release')) releases.push(message.text());
	});
	await fade.evaluate(element => element.ownerDocument.addEventListener('pointerup', event => {
		if (event.pointerType === 'touch') console.log('video-opacity-touch-release', event.isPrimary);
	}, true));
	const middle = { ...first, x: first.x + 10 };
	const native = await page.context().newCDPSession(page);
	await native.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [first] });
	await native.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [middle] });
	await expect.poll(value).toBeGreaterThan(0);
	if (interrupted) {
		const current = await fade.boundingBox();
		expect(current).not.toBeNull();
		const second = { x: current.x + current.width / 2, y: current.y + current.height / 2 + 2, id: 2 };
		await native.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [middle, second] });
		await native.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [second] });
		expect(releases).toEqual(['video-opacity-touch-release false']);
	}
	await native.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [final] });
	await native.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
	await expect.poll(value).toBeCloseTo(completed, 6);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(fade).toHaveAttribute('aria-valuenow', '0');
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	await expect.poll(value).toBeCloseTo(completed, 6);
});
