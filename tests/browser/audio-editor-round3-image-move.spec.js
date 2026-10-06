/* SPDX-License-Identifier: AGPL-3.0-only */

import { EDITOR_ENGLISH_COPY } from '../../src/common/i18n/editor-copy-inventory.ts';
import { createPngFixture } from '../helpers/png-fixture.mjs';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction } from './audio-editor-test-helpers.js';

test('a still image header can move into a new picture track', async ({ page }) => {
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	const chooser = page.waitForEvent('filechooser');
	await chooseNestedCommandAction(page, editor, 'Generate', [EDITOR_ENGLISH_COPY['ui.framescaperMenus.addVideoStill']]);
	await (await chooser).setFiles({ name: 'poster.png', mimeType: 'image/png', buffer: createPngFixture(16) });
	const clip = editor.getByRole('group', { name: 'Image clip: poster', exact: true });
	await expect(clip).toBeVisible();
	await expect(editor).not.toHaveAttribute('data-edit-block-reason', /.+/u);
	await clip.scrollIntoViewIfNeeded();
	const clipBox = await clip.boundingBox();
	const surface = await editor.locator('.audio-editor-timeline-inner').boundingBox();
	const lastTrack = await editor.locator('.audio-editor-track-row').last().boundingBox();
	expect(clipBox).not.toBeNull();
	expect(surface).not.toBeNull();
	expect(lastTrack).not.toBeNull();
	const previousTrackCount = Number(await editor.getAttribute('data-track-count'));
	const targetY = Math.min(surface.y + surface.height - 16, lastTrack.y + lastTrack.height + 32);
	await page.mouse.move(clipBox.x + 32, clipBox.y + 10);
	await page.mouse.down();
	await page.mouse.move(clipBox.x + 32, targetY, { steps: 6 });
	await expect(editor.locator('.audio-editor-new-track-drop-preview')).toBeVisible();
	await page.mouse.up();
	await expect(editor).toHaveAttribute('data-track-count', String(previousTrackCount + 1));
	await expect(editor.locator('[data-track-row]').last().getByRole('group', { name: 'Image clip: poster', exact: true })).toBeVisible();
	await chooseNestedCommandAction(page, editor, 'Edit', ['Undo']);
	await expect(editor).toHaveAttribute('data-track-count', String(previousTrackCount));
	await expect(clip).toBeVisible();
	await expect(editor).not.toHaveAttribute('data-edit-block-reason', /.+/u);
});

test('a still image header can move along its picture track', async ({ page }) => {
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	const chooser = page.waitForEvent('filechooser');
	await chooseNestedCommandAction(page, editor, 'Generate', [EDITOR_ENGLISH_COPY['ui.framescaperMenus.addVideoStill']]);
	await (await chooser).setFiles({ name: 'poster.png', mimeType: 'image/png', buffer: createPngFixture(16) });
	const clip = editor.getByRole('group', { name: 'Image clip: poster', exact: true });
	await expect(clip).toBeVisible();
	await expect(editor).not.toHaveAttribute('data-edit-block-reason', /.+/u);
	await clip.scrollIntoViewIfNeeded();
	const before = await clip.boundingBox();
	expect(before).not.toBeNull();
	await page.mouse.move(before.x + 32, before.y + 10);
	await page.mouse.down();
	await page.mouse.move(before.x + 92, before.y + 10, { steps: 6 });
	await expect.poll(async () => (await clip.boundingBox())?.x).toBeGreaterThan(before.x + 45);
	await page.mouse.up();
	await expect.poll(async () => (await clip.boundingBox())?.x).toBeGreaterThan(before.x + 45);
	await chooseNestedCommandAction(page, editor, 'Edit', ['Undo']);
	await expect.poll(async () => (await clip.boundingBox())?.x).toBe(before.x);
});
