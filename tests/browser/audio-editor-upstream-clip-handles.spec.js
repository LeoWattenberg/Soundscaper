/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, clipByName, importFiles } from './audio-editor-test-helpers.js';

test('right stretch arrows follow their direction and Alt+S reaches the playhead', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	const clip = clipByName(editor, toneA.name);
	const fadeOut = clip.getByRole('slider', { name: 'Fade out', exact: true });
	await expect(fadeOut).toHaveAttribute('aria-valuemax', '0.8');
	await clip.focus();
	await clip.press('Control+]');
	await clip.press('s');
	const stretch = clip.getByRole('button', { name: 'Stretch right edge', exact: true });
	await expect(stretch).toBeFocused();
	await stretch.press('ArrowRight');
	await expect(fadeOut).toHaveAttribute('aria-valuemax', '0.9');
	await stretch.press('ArrowLeft');
	await expect(fadeOut).toHaveAttribute('aria-valuemax', '0.8');
	const playhead = editor.getByRole('slider', { name: 'Playhead', exact: true });
	await playhead.press('Shift+ArrowLeft');
	await playhead.press('Shift+ArrowLeft');
	await expect(playhead).toHaveAttribute('aria-valuenow', '28800');
	await clip.focus();
	await clip.press('Alt+s');
	await expect(fadeOut).toHaveAttribute('aria-valuemax', '0.6');
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(fadeOut).toHaveAttribute('aria-valuemax', '0.8');
});

for (const height of [54, 60]) test(`trim and stretch handles remain reachable inside a ${height}px collapsed clip`, async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	const clip = clipByName(editor, toneA.name);
	await clip.locator('.clip-header').click();
	const row = clip.locator('xpath=ancestor::*[@data-track-row][1]');
	const initial = await row.boundingBox();
	const header = await row.locator('[data-track-header]').boundingBox();
	expect(initial).not.toBeNull();
	expect(header).not.toBeNull();
	const resizeY = header.y + header.height - 2;
	await page.mouse.move(header.x + 40, resizeY);
	await page.mouse.down();
	await page.mouse.move(header.x + 40, resizeY + height - initial.height, { steps: 4 });
	await page.mouse.up();
	await page.mouse.move(header.x + 40, header.y - 10);
	await expect.poll(async () => (await clip.boundingBox())?.height).toBe(height);
	await expect(clip.locator('.clip-display')).toHaveClass(/clip-display--truncated/u);
	await expect(clip.locator('.clip-header')).toHaveCount(0);
	await clip.hover();
	await expect(clip.locator('.clip-header')).toBeVisible();
	const bounds = await clip.boundingBox();
	expect(bounds).not.toBeNull();
	for (const kind of ['trim', 'stretch']) {
		const handle = clip.locator(`.clip-display__handle--${kind}-right`);
		await expect(handle).toHaveCSS('pointer-events', 'auto');
		const box = await handle.boundingBox();
		expect(box).not.toBeNull();
		expect(box.y).toBeGreaterThanOrEqual(bounds.y);
		expect(box.y + box.height).toBeLessThanOrEqual(bounds.y + bounds.height);
		await expect(handle).toHaveCSS('height', `${height / 2}px`);
		await handle.hover();
		expect(await handle.evaluate(element => {
			const rect = element.getBoundingClientRect();
			return element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
		})).toBe(true);
	}
});
