/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	collectClientErrors,
	importFiles,
	registerAudioEditorHooks,
} from './audio-editor-test-helpers.js';
import { arrangeWithMacro } from './helpers/macro-arrange.js';

registerAudioEditorHooks();

test('large timelines cull distant tracks, preserve scroll geometry and reveal keyboard destinations', async ({ page }) => {
	test.setTimeout(90_000);
	const errors = collectClientErrors(page);
	await page.setViewportSize({ width: 1_200, height: 800 });
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	await arrangeWithMacro(page, editor, `
		const tracks = await sound.project.tracks();
		for (let index = tracks.length; index < 200; index += 1) {
			await sound.command('NewMonoTrack');
		}
		await sound.select.none();
	`, { timeout: 60_000 });
	await expect(editor).toHaveAttribute('data-track-count', '200');
	const timeline = editor.locator('[data-timeline]');
	const slots = editor.locator('[data-track-viewport-row]');
	await expect(slots).toHaveCount(200);
	const mounted = editor.locator('[data-track-viewport-row][data-track-mounted="true"]');
	await expect.poll(() => mounted.count()).toBeLessThan(12);
	expect(await timeline.locator('canvas').count()).toBeLessThan(18);
	const height = await slots.first().evaluate((element) => element.getBoundingClientRect().height);
	const originalScrollHeight = await timeline.evaluate((element) => element.scrollHeight);
	expect(originalScrollHeight).toBeGreaterThanOrEqual(height * 200);
	await timeline.evaluate((element) => { element.scrollTop = element.scrollHeight; });
	await expect(slots.last()).toHaveAttribute('data-track-mounted', 'true');
	await expect(slots.first()).toHaveAttribute('data-track-mounted', 'false');
	await expect(slots.last().locator('[data-track-header]')).toBeVisible();
	await expect.poll(() => mounted.count()).toBeLessThan(12);
	expect(await timeline.evaluate((element) => element.scrollHeight)).toBe(originalScrollHeight);

	// Scroll a named lightweight header into view, then use the real track's
	// keyboard route to a row that has been culled by another vertical scroll.
	await slots.first().locator('[data-track-header]').scrollIntoViewIfNeeded();
	await expect(slots.first()).toHaveAttribute('data-track-mounted', 'true');
	await slots.first().locator('.track').focus();
	await expect(slots.first().locator('.track')).toBeFocused();
	await timeline.evaluate((element) => { element.scrollTop = element.scrollHeight; });
	await expect(slots.last()).toHaveAttribute('data-track-mounted', 'true');
	await expect(slots.first()).toHaveAttribute('data-track-mounted', 'true');
	await expect(slots.nth(1)).toHaveAttribute('data-track-mounted', 'false');
	await page.keyboard.press('ArrowDown');
	await expect(slots.nth(1).locator('.track')).toBeFocused();
	await expect.poll(() => timeline.evaluate((element) => element.scrollTop)).toBeLessThan(height * 3);
	await expect(slots.last()).toHaveAttribute('data-track-mounted', 'false');

	// Native sequential focus can also enter an unmounted row through its
	// placeholder; the focus immediately transfers to the mounted track.
	await timeline.evaluate((element) => { element.scrollTop = 0; });
	await expect(slots.nth(100)).toHaveAttribute('data-track-mounted', 'false');
	await slots.nth(100).locator('.track').focus();
	await expect(slots.nth(100)).toHaveAttribute('data-track-mounted', 'true');
	await expect(slots.nth(100).locator('.track')).toBeFocused();
	await expect.poll(() => mounted.count()).toBeLessThan(12);
	expect(await timeline.evaluate((element) => element.scrollHeight)).toBe(originalScrollHeight);

	// Resize starts in the timeline's capture handler, which stops propagation
	// before a row listener can run. Keep that source alive after scrolling it
	// away, publish the new height, then release it after the pointer finishes.
	await editor.getByRole('button', { name: 'Add track', exact: true }).focus();
	await timeline.evaluate((element) => { element.scrollTop = 0; });
	await expect(slots.nth(1)).toHaveAttribute('data-track-mounted', 'true');
	const resizeSource = slots.nth(1);
	const sourceHeight = await resizeSource.evaluate((element) => element.getBoundingClientRect().height);
	const headerBox = await resizeSource.locator('[data-track-header]').boundingBox();
	expect(headerBox).not.toBeNull();
	const resizeX = headerBox.x + Math.min(30, headerBox.width / 2);
	const resizeY = headerBox.y + headerBox.height - 3;
	await page.mouse.move(resizeX, resizeY);
	await page.mouse.down();
	await timeline.evaluate((element) => { element.scrollTop = element.scrollHeight; });
	await expect(slots.last()).toHaveAttribute('data-track-mounted', 'true');
	await expect(resizeSource).toHaveAttribute('data-track-mounted', 'true');
	await page.mouse.move(resizeX, resizeY + 32);
	await expect.poll(() => resizeSource.evaluate((element) => element.getBoundingClientRect().height))
		.toBeGreaterThan(sourceHeight + 20);
	await page.mouse.up();
	await expect(resizeSource).toHaveAttribute('data-track-mounted', 'false');
	await expect.poll(() => resizeSource.evaluate((element) => element.getBoundingClientRect().height))
		.toBeGreaterThan(sourceHeight + 20);

	// A pointer-owned row survives scrolling even after focus leaves it. Native
	// drag startup cancels its pointer, so dragend owns that final release.
	await editor.getByRole('button', { name: 'Add track', exact: true }).focus();
	await timeline.evaluate((element) => { element.scrollTop = 0; });
	await expect(slots.first()).toHaveAttribute('data-track-mounted', 'true');
	await slots.first().dispatchEvent('pointerdown', { pointerId: 21, button: 0 });
	await slots.first().dispatchEvent('dragstart');
	await page.evaluate(() => { document.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 21 })); });
	await timeline.evaluate((element) => { element.scrollTop = element.scrollHeight; });
	await expect(slots.last()).toHaveAttribute('data-track-mounted', 'true');
	await expect(slots.first()).toHaveAttribute('data-track-mounted', 'true');
	await page.evaluate(() => { document.dispatchEvent(new Event('dragend')); });
	await expect(slots.first()).toHaveAttribute('data-track-mounted', 'false');
	expect(errors).toEqual([]);
});
