/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, clipByName, importFiles } from './audio-editor-test-helpers.js';
import { chooseTrackMenuAction } from './helpers/track-menu.js';
import { createDeterministicSilentVideoFixture } from './fixtures/deterministic-av-media.js';

for (const kind of ['audio', 'video']) test(`locked ${kind} clips stop offering a protected fade edit`, async ({ page }) => {
	const editor = await bootEditor(page, kind === 'video' ? '/framescaper/embed/en/' : '/embed/en/');
	if (kind === 'video') {
		await editor.locator('[data-project-bin-input]').setInputFiles(createDeterministicSilentVideoFixture('locked-fade.webm'));
		await editor.locator('[data-project-bin-item]').first().getByRole('button', { name: /Add to timeline/u }).click();
	} else await importFiles(editor, [toneA]);
	const clip = kind === 'video' ? editor.getByRole('group', { name: /^Video clip:/u }).first() : clipByName(editor, toneA.name);
	await clip.locator('.clip-header').click();
	const fade = clip.getByRole('slider', { name: 'Fade in', exact: true });
	const initial = await fade.getAttribute('aria-valuenow');
	await fade.press('ArrowRight');
	await expect.poll(async () => Number(await fade.getAttribute('aria-valuenow'))).toBeGreaterThan(Number(initial));
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(fade).toHaveAttribute('aria-valuenow', initial);
	const track = clip.locator('xpath=ancestor::div[@data-track-row][1]');
	await chooseTrackMenuAction(page, editor, track, 'Lock track');
	await expect(fade).toBeDisabled();
	await chooseTrackMenuAction(page, editor, track, 'Unlock track');
	await expect(fade).toBeEnabled();
	await fade.press('ArrowRight');
	await expect.poll(async () => Number(await fade.getAttribute('aria-valuenow'))).toBeGreaterThan(Number(initial));
	const completed = await fade.getAttribute('aria-valuenow');
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(fade).toHaveAttribute('aria-valuenow', initial);
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	await expect(fade).toHaveAttribute('aria-valuenow', completed);
});

test('a locked audio header preserves clip selection without a refused movement preview', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	const clip = clipByName(editor, toneA.name);
	await clip.locator('.clip-header').click();
	const original = await clip.boundingBox();
	expect(original).not.toBeNull();
	await moveHeader(page, clip, 24);
	await expect.poll(async () => (await clip.boundingBox()).x).toBeGreaterThan(original.x);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect.poll(async () => (await clip.boundingBox()).x).toBe(original.x);
	const track = clip.locator('xpath=ancestor::div[@data-track-row][1]');
	await chooseTrackMenuAction(page, editor, track, 'Lock track');
	const header = await clip.locator('.clip-header').boundingBox();
	expect(header).not.toBeNull();
	await page.mouse.move(header.x + header.width / 2, header.y + header.height / 2);
	await page.mouse.down();
	await page.mouse.move(header.x + header.width / 2 + 24, header.y + header.height / 2, { steps: 3 });
	await expect.poll(async () => (await clip.boundingBox()).x).toBe(original.x);
	await page.mouse.up();
	await expect.poll(async () => (await clip.boundingBox()).x).toBe(original.x);
	await chooseTrackMenuAction(page, editor, track, 'Unlock track');
	await moveHeader(page, clip, 24);
	await expect.poll(async () => (await clip.boundingBox()).x).toBeGreaterThan(original.x);
	const completed = (await clip.boundingBox()).x;
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect.poll(async () => (await clip.boundingBox()).x).toBe(original.x);
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	await expect.poll(async () => (await clip.boundingBox()).x).toBe(completed);
});

async function moveHeader(page, clip, delta) {
	const header = await clip.locator('.clip-header').boundingBox();
	expect(header).not.toBeNull();
	await page.mouse.move(header.x + header.width / 2, header.y + header.height / 2);
	await page.mouse.down();
	await page.mouse.move(header.x + header.width / 2 + delta, header.y + header.height / 2, { steps: 3 });
	await page.mouse.up();
}
