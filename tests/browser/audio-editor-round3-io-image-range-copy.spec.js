/* SPDX-License-Identifier: AGPL-3.0-only */

import { EDITOR_ENGLISH_COPY } from '../../src/common/i18n/editor-copy-inventory.ts';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction } from './audio-editor-test-helpers.js';
import { seekFramescaperTimecode } from './helpers/framescaper-standard-timecode.js';

// Unmodified FFmpeg 6.1.1 APNG: 1 second red followed by 4 seconds green, 2 fps.
const animation = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAACXBIWXMAAAABAAAAAQBPJcTWAAAACGFjVEwAAAAKAAAAAMP92LEAAAAaZmNUTAAAAAAAAAAQAAAAEAAAAAAAAAAAAAEAAgAAbVWenQAAABlJREFUeJxj+MvA8J8SzDBqwKgBowYMFwMAHYj8EBcwgX4AAAAaZmNUTAAAAAEAAAABAAAAAQAAAAAAAAAAAAEAAgABuBi7KgAAAA9mZEFUAAAAAnicY2AAAgAABQAB/P9moAAAABpmY1RMAAAAAwAAABAAAAAQAAAAAAAAAAAAAQACAAAbsKegAAAAHGZkQVQAAAAEeJxjYKhn+E8RHjVg1IBRA4aLAQDian4Q03NFoAAAABpmY1RMAAAABQAAAAEAAAABAAAAAAAAAAAAAQACAAG4RBq5AAAAD2ZkQVQAAAAGeJxjYAACAAAFAAH/+V3fAAAAGmZjVEwAAAAHAAAAAQAAAAEAAAAAAAAAAAABAAIAAVXSyVAAAAAPZmRBVAAAAAh4nGNgAAIAAAUAARbIjsEAAAAaZmNUTAAAAAkAAAABAAAAAQAAAAAAAAAAAAEAAgABuKH4DAAAAA9mZEFUAAAACnicY2AAAgAABQAB+vMQXgAAABpmY1RMAAAACwAAAAEAAAABAAAAAAAAAAAAAQACAAFVNyvlAAAAD2ZkQVQAAAAMeJxjYAACAAAFAAEVzrW+AAAAGmZjVEwAAAANAAAAAQAAAAEAAAAAAAAAAAABAAIAAbj9WZ8AAAAPZmRBVAAAAA54nGNgAAIAAAUAAfn1KyEAAAAaZmNUTAAAAA8AAAABAAAAAQAAAAAAAAAAAAEAAgABVWuKdgAAAA9mZEFUAAAAEHicY2AAAgAABQABHNwVwwAAABpmY1RMAAAAEQAAAAEAAAABAAAAAAAAAAAAAQACAAG5aj1mAAAAD2ZkQVQAAAASeJxjYAACAAAFAAHw54tcAAAAAElFTkSuQmCC', 'base64');

async function centrePixel(page, canvas) {
	const png = await canvas.screenshot();
	return page.evaluate(async bytes => {
		const image = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: 'image/png' }));
		const scratch = document.createElement('canvas');
		scratch.width = image.width; scratch.height = image.height;
		const context = scratch.getContext('2d');
		context.drawImage(image, 0, 0);
		const result = Array.from(context.getImageData(image.width / 2, image.height / 2, 1, 1).data);
		image.close();
		return result;
	}, Array.from(png));
}

test('copying a range of a normal APNG preserves its selected animation phase', async ({ page }) => {
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	const available = await page.evaluate(async () => typeof ImageDecoder === 'function'
		&& await ImageDecoder.isTypeSupported('image/png') && !!document.createElement('canvas').getContext('webgl2'));
	test.skip(!available, 'This host lacks animated PNG ImageDecoder or WebGL2 program-preview support.');
	const chooser = page.waitForEvent('filechooser');
	await chooseNestedCommandAction(page, editor, 'Generate', [EDITOR_ENGLISH_COPY['ui.framescaperMenus.addVideoStill']]);
	await (await chooser).setFiles({ name: 'animation.png', mimeType: 'image/png', buffer: animation });
	const clips = editor.getByRole('group', { name: 'Image clip: animation', exact: true });
	await expect(clips).toHaveCount(1);
	const preview = editor.locator('[data-video-preview]');
	if (!await preview.count()) await chooseCommandAction(page, editor, 'Window', 'Video preview');
	await expect(preview).toHaveAttribute('data-video-preview-visual-consumed-count', '1');
	const canvas = preview.locator('[data-video-preview-canvas]');
	await expect.poll(async () => (await centrePixel(page, canvas))[0]).toBeGreaterThan(200);
	await seekFramescaperTimecode(page, editor, '00:00:01:15');
	await expect.poll(async () => (await centrePixel(page, canvas))[1]).toBeGreaterThan(100);
	await chooseCommandAction(page, editor, 'Window', 'Video preview');
	const box = await clips.boundingBox();
	const ruler = await editor.locator('[data-ruler-interaction]').boundingBox();
	expect(box).not.toBeNull(); expect(ruler).not.toBeNull();
	const lane = clips.locator('xpath=ancestor::*[@data-track-lane][1]');
	const laneBox = await lane.boundingBox();
	expect(laneBox).not.toBeNull();
	await lane.click({ position: { x: box.x + box.width + 15 - laneBox.x, y: laneBox.height * 0.75 } });
	await expect(lane).toHaveAttribute('data-selected', 'true');
	await page.mouse.move(box.x + box.width / 4, ruler.y + ruler.height * 0.8);
	await page.mouse.down();
	await page.mouse.move(box.x + box.width * 0.7, ruler.y + ruler.height * 0.8, { steps: 5 });
	await page.mouse.up();
	await expect(editor.locator('[data-time-selection-overlay]').first()).toBeVisible();
	await chooseCommandAction(page, editor, 'Edit', 'Copy');
	await chooseCommandAction(page, editor, 'Select', 'Select none');
	await seekFramescaperTimecode(page, editor, '00:00:05:00');
	await chooseNestedCommandAction(page, editor, 'Edit', ['Paste', 'Paste']);
	await expect(clips).toHaveCount(2);
	await seekFramescaperTimecode(page, editor, '00:00:05:03');
	await chooseCommandAction(page, editor, 'Window', 'Video preview');
	await expect(preview).toHaveAttribute('data-video-preview-visual-consumed-count', '1');
	await expect.poll(async () => (await centrePixel(page, canvas))[1]).toBeGreaterThan(100);
	await expect.poll(async () => (await centrePixel(page, canvas))[0]).toBeLessThan(20);
});
