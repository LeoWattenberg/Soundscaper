/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA, toneB } from './audio-editor-test-fixtures.js';
import {
	bootEditor, clipByName, clipField, closeClipProperties, collectClientErrors,
	importFiles, openClipProperties, registerAudioEditorHooks,
} from './audio-editor-test-helpers.js';

test.describe('clip pointer edit workflows', () => {
	registerAudioEditorHooks();

	test('moves and trims clips with frame-canonical pointer edits', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);
		const clip = clipByName(editor, toneA.name);
		await clip.scrollIntoViewIfNeeded();
		await clip.click({ position: { x: 32, y: 10 } });
		let clipDialog = await openClipProperties(page, editor);
		await expect(clipField(clipDialog, 'startFrame')).toHaveValue('0');
		await expect(clipField(clipDialog, 'durationFrame')).toHaveValue('38400');
		await closeClipProperties(clipDialog);
		await clip.scrollIntoViewIfNeeded();

		const box = await clip.boundingBox();
		expect(box).not.toBeNull();
		await page.mouse.move(box.x + 32, box.y + 10);
		await page.mouse.down();
		await page.mouse.move(box.x + 80, box.y + 10, { steps: 4 });
		await expect.poll(async () => (await clip.boundingBox())?.x || 0).toBeGreaterThan(box.x + 20);
		await page.mouse.up();
		await clip.locator('.clip-header').click();
		clipDialog = await openClipProperties(page, editor);
		await expect.poll(async () => Number(await clipField(clipDialog, 'startFrame').inputValue())).toBeGreaterThan(0);

		const movedDuration = Number(await clipField(clipDialog, 'durationFrame').inputValue());
		await closeClipProperties(clipDialog);
		await clip.scrollIntoViewIfNeeded();
		await clip.hover();
		const trimBox = await clip.locator('.clip-display__handle--trim-right').boundingBox();
		expect(trimBox).not.toBeNull();
		const trimX = trimBox.x + trimBox.width / 2;
		const trimY = trimBox.y + trimBox.height / 2;
		await page.mouse.move(trimX, trimY);
		await page.mouse.down();
		await page.mouse.move(trimX - 24, trimY, { steps: 4 });
		await page.mouse.up();
		clipDialog = await openClipProperties(page, editor);
		await expect.poll(async () => Number(await clipField(clipDialog, 'durationFrame').inputValue())).toBeLessThan(movedDuration);
		await closeClipProperties(clipDialog);
		const selectedClipBox = await clip.boundingBox();
		expect(selectedClipBox).not.toBeNull();
		await page.mouse.move(selectedClipBox.x + 32, selectedClipBox.y + 48);
		await page.mouse.down();
		await page.mouse.move(selectedClipBox.x + 80, selectedClipBox.y + 48, { steps: 4 });
		await page.mouse.up();
		await expect(editor.getByRole('button', { name: 'Loop selection' })).toBeEnabled();
		await expect.poll(async () => (await clip.boundingBox())?.x || 0).toBeLessThan(selectedClipBox.x + 2);
		expect(errors).toEqual([]);
	});

	test('moves, trims, and stretches a multi-selection as one clip set', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA, toneB]);
		const firstClip = clipByName(editor, toneA.name);
		const secondClip = clipByName(editor, toneB.name);
		await firstClip.locator('.clip-header').click();
		await secondClip.locator('.clip-header').click({ modifiers: ['Shift'] });
		await expect(firstClip.locator('.clip-display')).toHaveClass(/clip-display--selected/);
		await expect(secondClip.locator('.clip-display')).toHaveClass(/clip-display--selected/);
		await expect(firstClip).toHaveCSS('z-index', '1001');
		await expect(secondClip).toHaveCSS('z-index', '1001');

		const firstStart = await firstClip.boundingBox();
		const secondStart = await secondClip.boundingBox();
		expect(firstStart).not.toBeNull();
		expect(secondStart).not.toBeNull();
		await page.mouse.move(secondStart.x + 28, secondStart.y + 10);
		await page.mouse.down();
		await page.mouse.move(secondStart.x + 76, secondStart.y + 10, { steps: 4 });
		await page.mouse.up();
		await expect.poll(async () => (await firstClip.boundingBox())?.x || 0).toBeGreaterThan(firstStart.x + 20);
		await expect.poll(async () => (await secondClip.boundingBox())?.x || 0).toBeGreaterThan(secondStart.x + 20);
		await firstClip.locator('.clip-header').click();
		await secondClip.locator('.clip-header').click({ modifiers: ['Shift'] });

		const firstBeforeTrim = await firstClip.boundingBox();
		const secondBeforeTrim = await secondClip.boundingBox();
		const trimHandle = secondClip.locator('.clip-display__handle--trim-right');
		const trimBox = await trimHandle.boundingBox();
		expect(firstBeforeTrim).not.toBeNull();
		expect(secondBeforeTrim).not.toBeNull();
		expect(trimBox).not.toBeNull();
		const trimWaveform = secondClip.locator('canvas.clip-body__waveform');
		const waveformBeforeTrim = await trimWaveform.evaluate((canvas) => {
			globalThis.__trimPreviewWaveformPlan = canvas.__kwWaveformPlan;
			return {
				pixelsPerSample: canvas.__kwWaveformPlan.pixelsPerSample,
				drawScale: canvas.getBoundingClientRect().width / canvas.__kwWaveformPlan.pixelWidth,
			};
		});
		const trimX = trimBox.x + trimBox.width / 2;
		await page.mouse.move(trimX, trimBox.y + trimBox.height / 2);
		await page.mouse.down();
		await page.mouse.move(trimX - 24, trimBox.y + trimBox.height / 2, { steps: 4 });
		await expect.poll(async () => (await secondClip.boundingBox())?.width || 0).toBeLessThan(secondBeforeTrim.width - 10);
		const waveformDuringTrim = await trimWaveform.evaluate((canvas) => ({
			reusedPlan: canvas.__kwWaveformPlan === globalThis.__trimPreviewWaveformPlan,
			pixelsPerSample: canvas.__kwWaveformPlan.pixelsPerSample,
			drawScale: canvas.getBoundingClientRect().width / canvas.__kwWaveformPlan.pixelWidth,
		}));
		expect(waveformDuringTrim.reusedPlan).toBe(false);
		expect(waveformDuringTrim.pixelsPerSample).toBeCloseTo(waveformBeforeTrim.pixelsPerSample, 4);
		expect(waveformDuringTrim.drawScale).toBeCloseTo(waveformBeforeTrim.drawScale, 2);
		await page.mouse.up();
		await expect.poll(async () => (await firstClip.boundingBox())?.width || 0).toBeLessThan(firstBeforeTrim.width - 10);
		await expect.poll(async () => (await secondClip.boundingBox())?.width || 0).toBeLessThan(secondBeforeTrim.width - 10);

		const firstBeforeStretch = await firstClip.boundingBox();
		const secondBeforeStretch = await secondClip.boundingBox();
		const stretchHandle = secondClip.locator('.clip-display__handle--stretch-right');
		const stretchBox = await stretchHandle.boundingBox();
		expect(firstBeforeStretch).not.toBeNull();
		expect(secondBeforeStretch).not.toBeNull();
		expect(stretchBox).not.toBeNull();
		const stretchX = stretchBox.x + stretchBox.width / 2;
		await page.mouse.move(stretchX, stretchBox.y + stretchBox.height / 2);
		await page.mouse.down();
		await page.mouse.move(stretchX + 24, stretchBox.y + stretchBox.height / 2, { steps: 4 });
		await page.mouse.up();
		await expect.poll(async () => (await firstClip.boundingBox())?.width || 0).toBeGreaterThan(firstBeforeStretch.width + 10);
		await expect.poll(async () => (await secondClip.boundingBox())?.width || 0).toBeGreaterThan(secondBeforeStretch.width + 10);
		expect(errors).toEqual([]);
	});
});
