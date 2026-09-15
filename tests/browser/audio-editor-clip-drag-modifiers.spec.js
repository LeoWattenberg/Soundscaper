import { expect, test, toneA, toneB } from './audio-editor-test-fixtures.js';
import {
	bootEditor, clipByName, clipField, closeDialog, collectClientErrors,
	importFiles, openClipProperties, registerAudioEditorHooks,
} from './audio-editor-test-helpers.js';

test.describe('clip header drag modifiers', () => {
	registerAudioEditorHooks();

	test('Ctrl drag changes tracks while preserving an off-grid start, with one undo', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);
		const clip = clipByName(editor, toneA.name);
		const source = clip.locator('xpath=ancestor::*[@data-track-row][1]');
		const sourceId = await source.getAttribute('data-track-id');
		const destination = editor.locator('[data-track-row]').filter({ hasNot: clip }).first();
		const destinationId = await destination.getAttribute('data-track-id');
		const properties = await openClipProperties(page, editor, clip);
		await clipField(properties, 'startFrame').fill('12345');
		await clipField(properties, 'startFrame').press('Tab');
		await closeDialog(properties);
		const box = await clip.boundingBox();
		const lane = await destination.boundingBox();
		expect(box).not.toBeNull();
		expect(lane).not.toBeNull();
		await page.keyboard.down('Control');
		await page.mouse.move(box.x + 32, box.y + 10);
		await page.mouse.down();
		await page.mouse.move(box.x + 95, lane.y + 60, { steps: 8 });
		await page.mouse.up();
		await page.keyboard.up('Control');
		await expect(clip.locator('xpath=ancestor::*[@data-track-row][1]')).toHaveAttribute('data-track-id', destinationId);
		const movedProperties = await openClipProperties(page, editor, clip);
		await expect(clipField(movedProperties, 'startFrame')).toHaveValue('12345');
		await closeDialog(movedProperties);
		await editor.getByRole('button', { name: 'Undo', exact: true }).click();
		await expect(clip.locator('xpath=ancestor::*[@data-track-row][1]')).toHaveAttribute('data-track-id', sourceId);
		expect(errors).toEqual([]);
	});

	test('Shift drag moves every clip on the source track and leaves other tracks in place', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA, toneB]);
		const clip = clipByName(editor, toneA.name);
		const sourceId = await clip.locator('xpath=ancestor::*[@data-track-row][1]').getAttribute('data-track-id');
		const source = editor.locator(`[data-track-row][data-track-id="${sourceId}"]`);
		const originalBox = await clip.boundingBox();
		expect(originalBox).not.toBeNull();
		const splitTool = editor.getByRole('button', { name: 'Split tool', exact: true });
		await splitTool.click();
		await clip.click({ position: { x: originalBox.width / 2, y: 60 } });
		await splitTool.click();
		const clips = source.locator('[data-clip-id]');
		await expect(clips).toHaveCount(2);
		const boxes = await Promise.all([clips.nth(0).boundingBox(), clips.nth(1).boundingBox()]);
		const other = clipByName(editor, toneB.name);
		const otherBox = await other.boundingBox();
		expect(boxes[0]).not.toBeNull();
		expect(boxes[1]).not.toBeNull();
		await page.keyboard.down('Shift');
		await page.mouse.move(boxes[0].x + 16, boxes[0].y + 10);
		await page.mouse.down();
		await page.mouse.move(boxes[0].x + 64, boxes[0].y + 10, { steps: 6 });
		await page.mouse.up();
		await page.keyboard.up('Shift');
		await expect.poll(async () => (await clips.nth(0).boundingBox()).x).toBeGreaterThan(boxes[0].x + 20);
		await expect.poll(async () => (await clips.nth(1).boundingBox()).x).toBeGreaterThan(boxes[1].x + 20);
		expect((await other.boundingBox()).x).toBeCloseTo(otherBox.x, 0);
		await editor.getByRole('button', { name: 'Undo', exact: true }).click();
		await expect.poll(async () => (await clips.nth(0).boundingBox()).x).toBeCloseTo(boxes[0].x, 0);
		await expect.poll(async () => (await clips.nth(1).boundingBox()).x).toBeCloseTo(boxes[1].x, 0);
		expect(errors).toEqual([]);
	});

	test('clip menu exposes whole-track selection and time-preserving track moves', async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);
		const clip = clipByName(editor, toneA.name);
		await clip.click({ button: 'right', position: { x: 32, y: 10 } });
		const menu = page.locator('.audio-editor-clip-context-menu');
		await menu.getByRole('menuitem', { name: /^Select all clips on this track/u }).click();
		await expect(clip.locator('.clip-display')).toHaveAttribute('data-selected', 'true');
		await clip.click({ button: 'right', position: { x: 32, y: 10 } });
		const move = menu.getByRole('menuitem', { name: /^Move to track \(preserve time\)/u });
		await move.hover();
		await move.getByRole('menuitem').first().click();
		const properties = await openClipProperties(page, editor, clip);
		await expect(clipField(properties, 'startFrame')).toHaveValue('0');
	});
});
