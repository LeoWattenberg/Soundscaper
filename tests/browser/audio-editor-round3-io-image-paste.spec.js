/* SPDX-License-Identifier: AGPL-3.0-only */

import { EDITOR_ENGLISH_COPY } from '../../src/common/i18n/editor-copy-inventory.ts';
import { createPngFixture } from '../helpers/png-fixture.mjs';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction } from './audio-editor-test-helpers.js';
import { seekFramescaperTimecode } from './helpers/framescaper-standard-timecode.js';

test('Copy and Paste retain a normally imported still image in its own project', async ({ page }) => {
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	const chooser = page.waitForEvent('filechooser');
	await chooseNestedCommandAction(page, editor, 'Generate', [EDITOR_ENGLISH_COPY['ui.framescaperMenus.addVideoStill']]);
	await (await chooser).setFiles({ name: 'poster.png', mimeType: 'image/png', buffer: createPngFixture(16) });
	const clips = editor.getByRole('group', { name: 'Image clip: poster', exact: true });
	await expect(clips).toHaveCount(1);
	await expect(editor).not.toHaveAttribute('data-edit-block-reason', /.+/u);
	const original = await clips.boundingBox();
	expect(original).not.toBeNull();
	const lane = clips.locator('xpath=ancestor::*[@data-track-lane][1]');
	const laneBox = await lane.boundingBox();
	expect(laneBox).not.toBeNull();
	await lane.click({ position: { x: original.x + original.width + 15 - laneBox.x, y: laneBox.height * 0.75 } });
	await expect(lane).toHaveAttribute('data-selected', 'true');
	const ruler = await editor.locator('[data-ruler-interaction]').boundingBox();
	expect(ruler).not.toBeNull();
	await page.mouse.move(original.x + original.width / 4, ruler.y + ruler.height * 0.8);
	await page.mouse.down();
	await page.mouse.move(original.x + original.width * 0.7, ruler.y + ruler.height * 0.8, { steps: 5 });
	await page.mouse.up();
	await expect(editor.locator('[data-time-selection-overlay]').first()).toBeVisible();
	await chooseCommandAction(page, editor, 'Edit', 'Copy');
	await chooseCommandAction(page, editor, 'Select', 'Select none');
	await seekFramescaperTimecode(page, editor, '00:00:05:00');
	await chooseNestedCommandAction(page, editor, 'Edit', ['Paste', 'Paste']);
	await expect(clips).toHaveCount(2);
	const copy = await clips.last().boundingBox();
	expect(copy).not.toBeNull();
	// A drawn sample range conforms to the sequence's nearest 30 fps boundary.
	expect(Math.abs(copy.width - original.width * 0.45)).toBeLessThanOrEqual(original.width / 150);
	expect(copy.x).toBeCloseTo(original.x + original.width, 0);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(clips).toHaveCount(1);
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	await expect(clips).toHaveCount(2);
});
