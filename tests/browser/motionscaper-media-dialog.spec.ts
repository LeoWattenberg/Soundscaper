/* SPDX-License-Identifier: AGPL-3.0-only */

import { readFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { motionWavFixture } from '../helpers/motion-media-fixture.ts';
import { expect, test } from './helpers/browser-coverage-fixture.js';
import { motionRetainedVideoFixture } from './helpers/motionscaper-tracking-source.ts';
import { attemptMotionVideoDelivery, assertMotionPngDeliveryMatchesPreview, snapshotMotionPreviewFrames } from './helpers/motionscaper-preview-delivery.ts';

async function menu(page: Page, top: string, command: string): Promise<void> {
	await page.getByRole('menuitem', { name: top, exact: true }).click();
	await page.getByRole('menuitem', { name: command, exact: true }).click();
}

test('media is imported through File and retained for preview after saving and reopening', async ({ page }: { page: Page }) => {
	await page.addInitScript(() => { Object.defineProperty(globalThis, 'showSaveFilePicker', { value: undefined, configurable: true }); });
	await page.goto('/embed/en/'); await menu(page, 'File', 'New Composition');
	await page.getByLabel('Project title', { exact: true }).fill('Media preview');
	await page.getByLabel('Width', { exact: true }).fill('64'); await page.getByLabel('Height', { exact: true }).fill('64');
	await page.getByLabel('Duration in frames', { exact: true }).fill('30');
	await page.getByRole('button', { name: 'Create', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0);
	const image = await page.evaluate(async () => {
		const canvas = new OffscreenCanvas(64, 64); const context = canvas.getContext('2d')!;
		context.fillStyle = '#ff0000'; context.fillRect(0, 0, 64, 64);
		return Array.from(new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer()));
	});
	await menu(page, 'File', 'Import Media');
	await expect(page.getByRole('dialog')).toContainText('64 MiB');
	await page.getByLabel('Media file', { exact: true }).setInputFiles({ name: 'Red.png', mimeType: 'application/octet-stream', buffer: Buffer.from(image) });
	await expect(page.getByRole('dialog')).toHaveCount(0);
	await menu(page, 'File', 'Import Media');
	await page.getByLabel('Media file', { exact: true }).setInputFiles({ name: 'Tone.wav', mimeType: 'audio/wav', buffer: Buffer.from(motionWavFixture(2, 48000)) });
	await expect(page.getByRole('dialog')).toHaveCount(0);
	await menu(page, 'File', 'Save'); await expect(page.locator('[data-motion-save-status]')).toHaveText('Saved on this device');
	await page.reload(); await menu(page, 'File', 'Project Library');
	await page.getByRole('button', { name: 'Media preview', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0);
	await menu(page, 'View', 'Composition Preview');
	const dialog = page.getByRole('dialog', { name: 'Composition Preview', exact: true });
	const canvas = dialog.locator('canvas'); await expect(canvas).toHaveAttribute('data-motion-frame', '0');
	expect(await canvas.evaluate((element: HTMLCanvasElement) => Array.from(element.getContext('2d')!.getImageData(32, 32, 1, 1).data))).toEqual([255, 0, 0, 255]);
	await dialog.getByRole('button', { name: 'Play', exact: true }).click();
	await expect.poll(async () => Number(await canvas.getAttribute('data-motion-frame'))).toBeGreaterThan(0);
	await dialog.getByRole('button', { name: 'Pause', exact: true }).click();
	await dialog.getByLabel('Frame', { exact: true }).fill('0'); await expect(canvas).toHaveAttribute('data-motion-frame', '0');
	await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0);
	await menu(page, 'File', 'Render'); const render = page.getByRole('dialog', { name: 'Render Composition', exact: true });
	await render.getByLabel('Output format', { exact: true }).selectOption('webm');
	const download = await attemptMotionVideoDelivery(page, render, { audio: true });
	if (download) {
		const path = await download.path(); if (!path) throw new Error('Media render file is unavailable.');
		const { Input, BufferSource, ALL_FORMATS } = await import('mediabunny');
		const input = new Input({ source: new BufferSource(await readFile(path)), formats: ALL_FORMATS });
		try {
			const track = await input.getPrimaryAudioTrack(); expect(track).not.toBeNull();
			expect(await track!.getSampleRate()).toBe(48000); expect(await track!.getNumberOfChannels()).toBe(2);
			expect((await input.getPrimaryVideoTrack())?.codec).toBe('vp9');
		} finally { input.dispose(); }
	}
	await page.keyboard.press('Escape'); await expect(render).toHaveCount(0);
	if (!download) await assertMotionPngDeliveryMatchesPreview(page, await snapshotMotionPreviewFrames(page, [0]));
	// Decode and edit the independent AV source on every engine, including when encoding is refused.
	const bytes = motionRetainedVideoFixture('redAudio30');
	await menu(page, 'File', 'New Composition');
	await page.getByLabel('Width', { exact: true }).fill('64'); await page.getByLabel('Height', { exact: true }).fill('64');
	await page.getByRole('button', { name: 'Create', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0);
	await menu(page, 'File', 'Import Media');
	await page.getByLabel('Media file', { exact: true }).setInputFiles({ name: 'Retained.mp4', mimeType: 'video/mp4', buffer: bytes });
	await expect(page.getByRole('dialog')).toHaveCount(0);
	await menu(page, 'View', 'Timeline'); const timeline = page.getByRole('dialog', { name: 'Timeline', exact: true });
	await timeline.getByRole('checkbox', { name: 'Retained.mp4', exact: true }).check();
	const footageAudio = timeline.getByLabel('Footage audio enabled', { exact: true }); await expect(footageAudio).toBeChecked();
	await footageAudio.click(); await expect(footageAudio).not.toBeChecked();
	await timeline.getByRole('button', { name: 'Undo', exact: true }).click(); await expect(footageAudio).toBeChecked();
	await timeline.getByRole('button', { name: 'Close', exact: true }).last().click(); await expect(timeline).toHaveCount(0);
	await menu(page, 'View', 'Composition Preview');
	await expect(canvas).toHaveAttribute('data-motion-frame', '0');
	const pixel = await canvas.evaluate((element: HTMLCanvasElement) => Array.from(element.getContext('2d')!.getImageData(32, 32, 1, 1).data));
	expect(pixel[0]).toBeGreaterThan(245); expect(pixel[1]).toBeLessThan(8); expect(pixel[2]).toBeLessThan(8);
	await dialog.getByLabel('Frame', { exact: true }).fill('20'); await expect(canvas).toHaveAttribute('data-motion-frame', '20');
	await dialog.getByRole('button', { name: 'Play', exact: true }).click();
	await expect.poll(async () => Number(await canvas.getAttribute('data-motion-frame'))).toBeGreaterThan(20);
	await dialog.getByRole('button', { name: 'Pause', exact: true }).click();
	await expect(dialog.getByRole('alert')).toHaveCount(0);
	await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0);

});

test('German media admission and invalid-file feedback remain reachable from the menu', async ({ page }: { page: Page }) => {
	await page.goto('/embed/de/'); await menu(page, 'Datei', 'Neue Komposition');
	await page.getByRole('button', { name: 'Erstellen', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0);
	await menu(page, 'Datei', 'Medien importieren');
	await expect(page.getByRole('dialog')).toContainText('64 MiB');
	await page.getByLabel('Mediendatei', { exact: true }).setInputFiles({ name: 'Invalid.png', mimeType: 'image/png', buffer: Buffer.from('invalid') });
	await expect(page.getByRole('alert')).toContainText('Medium konnte nicht importiert werden');
	await page.keyboard.press('Escape'); await expect(page.getByRole('dialog')).toHaveCount(0);
});


test('unavailable audio output stays inside the preview error and retry workflow', async ({ page }: { page: Page }) => {
	const failures: string[] = []; page.on('pageerror', (error) => failures.push(error.message));
	await page.addInitScript(() => { const scope = globalThis as unknown as { audioContextConstructions: number }; scope.audioContextConstructions = 0;
		Object.defineProperty(globalThis, 'AudioContext', { configurable: true, value: class {
		constructor() { scope.audioContextConstructions++; throw new Error('Audio output unavailable'); }
	} }); });
	await page.goto('/embed/en/'); await menu(page, 'File', 'New Composition');
	await page.getByRole('button', { name: 'Create', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0);
	await menu(page, 'File', 'Import Media');
	await page.getByLabel('Media file', { exact: true }).setInputFiles({ name: 'Tone.wav', mimeType: 'audio/wav', buffer: Buffer.from(motionWavFixture()) });
	await expect(page.getByRole('dialog')).toHaveCount(0); await menu(page, 'View', 'Composition Preview');
	const dialog = page.getByRole('dialog', { name: 'Composition Preview', exact: true }); const canvas = dialog.locator('canvas');
	const constructions = () => page.evaluate(() => (globalThis as unknown as { audioContextConstructions: number }).audioContextConstructions);
	await expect(canvas).toHaveAttribute('data-motion-frame', '0'); await expect(dialog.getByRole('alert')).toHaveCount(0); expect(await constructions()).toBe(0);
	await dialog.getByLabel('Frame', { exact: true }).fill('1'); await expect(canvas).toHaveAttribute('data-motion-frame', '1'); expect(await constructions()).toBe(0);
	await dialog.getByRole('button', { name: 'Play', exact: true }).click();
	await expect(page.getByRole('alert')).toContainText('Audio output unavailable');
	expect(await constructions()).toBe(1);
	await page.getByRole('button', { name: 'Retry', exact: true }).click();
	await expect(canvas).toHaveAttribute('data-motion-frame', '0'); await expect(dialog.getByRole('alert')).toHaveCount(0); expect(await constructions()).toBe(1);
	await dialog.getByRole('button', { name: 'Play', exact: true }).click();
	await expect(page.getByRole('alert')).toContainText('Audio output unavailable'); expect(await constructions()).toBe(2); expect(failures).toEqual([]);
	await page.keyboard.press('Escape'); await expect(page.getByRole('dialog')).toHaveCount(0);
});
