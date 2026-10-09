/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, longTone, test, toneB } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, clipByName, importFiles, showToolbarButton } from './audio-editor-test-helpers.js';

function selectionField(editor, edge) {
	return editor.getByRole('group', { name: `Selection ${edge}`, exact: true }).locator('.timecode__display');
}

async function selectionSeconds(editor, edge) {
	const text = (await selectionField(editor, edge).textContent()).replace(/\s/gu, '');
	const digits = text.match(/(\d+)h(\d+)m(\d+(?:\.\d+)?)s/u);
	expect(digits).not.toBeNull();
	return Number(digits[1]) * 3600 + Number(digits[2]) * 60 + Number(digits[3]);
}

async function waveform(editor, name = longTone.name) {
	const clip = clipByName(editor, name);
	const display = clip.locator('.clip-display');
	const box = await display.boundingBox();
	expect(box).not.toBeNull();
	return { clip, display, box, y: box.y + box.height * 0.75 };
}

async function drag(page, startX, endX, startY, endY = startY) {
	await page.mouse.move(startX, startY);
	await page.mouse.down();
	await page.mouse.move(endX, endY, { steps: 5 });
	await page.mouse.up();
}

async function setup(page, files = [longTone]) {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, files);
	await chooseCommandAction(page, editor, 'Select', 'Select none');
	const wave = await waveform(editor);
	const xAt = seconds => wave.box.x + wave.box.width * seconds / 8;
	const playhead = editor.getByRole('slider', { name: 'Playhead', exact: true });
	return { editor, wave, xAt, playhead };
}

test('Shift arrows create and adjust audio selections while the playhead keeps its own controls', async ({ page }) => {
	const { editor, wave, playhead } = await setup(page);
	await playhead.press('Home');
	await playhead.press('Shift+ArrowRight');
	await playhead.press('Shift+ArrowRight');
	await expect(playhead).toHaveAttribute('aria-valuenow', '9600');
	await wave.clip.focus();
	await page.keyboard.press('Shift+ArrowRight');
	await expect.poll(() => selectionSeconds(editor, 'start')).toBe(0.2);
	await expect.poll(() => selectionSeconds(editor, 'end')).toBeGreaterThan(0.2);
	const end = await selectionSeconds(editor, 'end');
	await page.keyboard.press('Shift+ArrowLeft');
	await expect.poll(() => selectionSeconds(editor, 'start')).toBeLessThan(0.2);
	await expect.poll(() => selectionSeconds(editor, 'end')).toBe(end);
	await page.keyboard.press('ControlOrMeta+Shift+ArrowRight');
	await expect.poll(() => selectionSeconds(editor, 'start')).toBe(0.2);
	await page.keyboard.press('ControlOrMeta+Shift+ArrowLeft');
	await expect(editor.locator('[data-time-selection-overlay]')).toHaveCount(0);
	await expect(editor.getByRole('group', { name: 'Selection duration', exact: true }).locator('.timecode__display')).toHaveText('00h00m00.000s');
	await expect(playhead).toHaveAttribute('aria-valuenow', '9600');
	await page.keyboard.press('Shift+Home');
	await expect.poll(() => selectionSeconds(editor, 'start')).toBe(0);
	await expect.poll(() => selectionSeconds(editor, 'end')).toBe(0.2);
	await page.keyboard.press('Shift+End');
	await expect.poll(() => selectionSeconds(editor, 'end')).toBe(8);
	await playhead.press('ArrowRight');
	await expect(playhead).toHaveAttribute('aria-valuenow', '9601');
	await expect.poll(() => selectionSeconds(editor, 'end')).toBe(8);
	await editor.getByRole('button', { name: 'Jump to project end', exact: true }).click();
	await expect(playhead).toHaveAttribute('aria-valuenow', '384000');
	await chooseCommandAction(page, editor, 'Select', 'Select none');
	await wave.clip.press('Shift+ArrowRight');
	await wave.clip.press('ControlOrMeta+Shift+ArrowRight');
	await wave.clip.press('Shift+ArrowRight');
	await expect.poll(() => selectionSeconds(editor, 'start')).toBeGreaterThan(8);
	await playhead.press('Home');
	await wave.clip.press('Shift+End');
	await expect(editor.getByRole('group', { name: 'Selection duration', exact: true }).locator('.timecode__display')).toHaveText('00h00m00.000s');
	await wave.clip.press('Shift+ArrowLeft');
	await expect.poll(() => selectionSeconds(editor, 'start')).toBeLessThan(8);
	await expect.poll(() => selectionSeconds(editor, 'start')).toBeGreaterThan(7);
	await expect.poll(() => selectionSeconds(editor, 'end')).toBe(8);
	await expect(playhead).toHaveAttribute('aria-valuenow', '0');
});

test('Select Region exposes range adjustments even with a selected clip', async ({ page }) => {
	const { editor, wave, playhead } = await setup(page);
	await wave.clip.locator('.clip-header').click();
	const before = await wave.display.boundingBox();
	await chooseNestedCommandAction(page, editor, 'Select', ['Region', 'Contract selection from right']);
	await expect.poll(() => selectionSeconds(editor, 'end')).toBeLessThan(8);
	await expect.poll(() => selectionSeconds(editor, 'end')).toBeGreaterThan(7);
	await chooseNestedCommandAction(page, editor, 'Select', ['Region', 'Extend selection to project end']);
	await expect.poll(() => selectionSeconds(editor, 'end')).toBe(8);
	await expect(playhead).toHaveAttribute('aria-valuenow', '0');
	const after = await wave.display.boundingBox();
	expect(after.width).toBeCloseTo(before.width, 1);
});

test('selection edges show directional cursors and resize without moving the playhead or trimming clips', async ({ page }) => {
	const { editor, wave, xAt, playhead } = await setup(page);
	await drag(page, xAt(0.2), xAt(0.6), wave.y);
	await expect.poll(() => selectionSeconds(editor, 'start')).toBe(0.2);
	await expect.poll(() => selectionSeconds(editor, 'end')).toBe(0.6);
	await expect(playhead).toHaveAttribute('aria-valuenow', '9600');
	await playhead.press('Home');
	await playhead.press('Shift+ArrowRight');
	await page.mouse.move(xAt(0.2), wave.y);
	await expect.poll(() => wave.display.evaluate(element => getComputedStyle(element).cursor)).toContain('url(');
	const leftCursor = await wave.display.evaluate(element => getComputedStyle(element).cursor);
	await drag(page, xAt(0.2), xAt(0.1), wave.y);
	await expect.poll(() => selectionSeconds(editor, 'start')).toBe(0.1);
	await expect.poll(() => selectionSeconds(editor, 'end')).toBe(0.6);
	await page.mouse.move(xAt(0.6), wave.y);
	await expect.poll(() => wave.display.evaluate(element => getComputedStyle(element).cursor)).toContain('url(');
	expect(await wave.display.evaluate(element => getComputedStyle(element).cursor)).not.toBe(leftCursor);
	await drag(page, xAt(0.6), xAt(0.8), wave.y);
	await expect.poll(() => selectionSeconds(editor, 'end')).toBe(0.8);
	await expect(playhead).toHaveAttribute('aria-valuenow', '4800');
	await expect(editor.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
	expect((await wave.display.boundingBox()).width).toBeCloseTo(wave.box.width, 1);
});

test('Shift click edits the nearest selection edge and Escape cancels a crossing drag', async ({ page }) => {
	const { editor, wave, xAt, playhead } = await setup(page);
	await drag(page, xAt(0.2), xAt(0.6), wave.y);
	await playhead.press('Home');
	await page.keyboard.down('Shift');
	await page.mouse.click(xAt(0.1), wave.y);
	await page.keyboard.up('Shift');
	await expect.poll(() => selectionSeconds(editor, 'start')).toBe(0.1);
	await expect.poll(() => selectionSeconds(editor, 'end')).toBe(0.6);
	await page.keyboard.down('Shift');
	await page.mouse.click(xAt(1), wave.y);
	await page.keyboard.up('Shift');
	await expect.poll(() => selectionSeconds(editor, 'end')).toBe(1);
	await page.mouse.move(xAt(0.1), wave.y);
	await page.mouse.down();
	await page.mouse.move(xAt(1.2), wave.y, { steps: 5 });
	await page.keyboard.press('Escape');
	await page.mouse.up();
	await expect.poll(() => selectionSeconds(editor, 'start')).toBe(0.1);
	await expect.poll(() => selectionSeconds(editor, 'end')).toBe(1);
	await drag(page, xAt(0.1), xAt(1.2), wave.y);
	await expect.poll(() => selectionSeconds(editor, 'start')).toBe(1);
	await expect.poll(() => selectionSeconds(editor, 'end')).toBe(1.2);
	await expect(playhead).toHaveAttribute('aria-valuenow', '0');
});

test('resizing an edge keeps the existing multitrack selection scope', async ({ page }) => {
	const { editor, wave, xAt, playhead } = await setup(page, [longTone, toneB]);
	const other = await waveform(editor, toneB.name);
	await drag(page, xAt(0.2), xAt(0.6), wave.y, other.y);
	await expect(editor.locator('[data-time-selection-overlay]')).toHaveCount(2);
	await playhead.press('Home');
	await drag(page, xAt(0.6), xAt(0.7), other.y, wave.y);
	await expect.poll(() => selectionSeconds(editor, 'start')).toBe(0.2);
	await expect.poll(() => selectionSeconds(editor, 'end')).toBe(0.7);
	await expect(editor.locator('[data-time-selection-overlay]')).toHaveCount(2);
	await expect(playhead).toHaveAttribute('aria-valuenow', '0');
});

test('selection edge snapping preserves the opposite endpoint off the grid', async ({ page }) => {
	const { editor, wave, xAt, playhead } = await setup(page);
	await drag(page, xAt(0.2), xAt(0.6), wave.y);
	await showToolbarButton(page, editor, 'Snap');
	await editor.getByRole('checkbox', { name: 'Snap', exact: true }).click();
	await playhead.press('Home');
	await drag(page, xAt(0.6), xAt(1.1), wave.y);
	await expect.poll(() => selectionSeconds(editor, 'start')).toBe(0.2);
	await expect.poll(() => selectionSeconds(editor, 'end')).toBe(1);
	await expect(playhead).toHaveAttribute('aria-valuenow', '0');
});

test('keyboard selection editing leaves running playback uninterrupted', async ({ page }) => {
	const { editor, wave, xAt, playhead } = await setup(page);
	await drag(page, xAt(2), xAt(6), wave.y);
	await editor.getByRole('button', { name: 'Play', exact: true }).click();
	await expect(editor.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
	const position = Number(await playhead.getAttribute('aria-valuenow'));
	await wave.clip.press('Shift+ArrowLeft');
	await expect.poll(() => selectionSeconds(editor, 'start')).toBeLessThan(2);
	await expect.poll(() => selectionSeconds(editor, 'end')).toBe(6);
	await expect(editor.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
	const after = Number(await playhead.getAttribute('aria-valuenow'));
	expect(after).toBeGreaterThanOrEqual(position);
	expect(after).toBeLessThan(position + 48_000);
	await editor.getByRole('button', { name: 'Stop', exact: true }).click();
});
