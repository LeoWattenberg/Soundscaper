/* SPDX-License-Identifier: AGPL-3.0-only */

import { readFile } from 'node:fs/promises';
import { expect } from '@playwright/test';
import { test } from './audio-editor-test-fixtures.js';
import { resolveBrowserProductTestUrl } from './helpers/browser-product-test-url.js';
import { openFramescaperSourcePropertiesFromBin } from './helpers/framescaper-source-properties.js';

test('ordinary NTSC camera import retains its declared pixel aspect ratio', async ({ page }) => {
	const bytes = Buffer.from(await readFile(new URL('./fixtures/ntsc-anamorphic-pasp.mp4.base64', import.meta.url), 'utf8'), 'base64');
	await page.goto(resolveBrowserProductTestUrl('/framescaper/en/'));
	const editor = page.locator('[data-audio-editor]');
	await expect(editor).toHaveAttribute('data-audio-editor-bound', 'true');
	await expect(editor.locator('[data-status]')).toHaveAttribute('data-state', 'success');
	const decline = page.getByRole('button', { name: 'Decline', exact: true });
	if (await decline.isVisible()) await decline.click();
	const native = await page.evaluate(async encoded => {
		const bytes = Uint8Array.from(atob(encoded), character => character.charCodeAt(0));
		const url = URL.createObjectURL(new Blob([bytes], { type: 'video/mp4' }));
		const video = document.createElement('video');
		video.preload = 'metadata';
		try {
			return await new Promise((resolve, reject) => {
				video.onloadedmetadata = () => { resolve({ width: video.videoWidth, height: video.videoHeight }); };
				video.onerror = () => { reject(new Error('The native decoder could not read the ordinary camera file.')); };
				video.src = url;
			});
		} finally {
			video.removeAttribute('src');
			video.load();
			URL.revokeObjectURL(url);
		}
	}, bytes.toString('base64'));
	await test.info().attach('native-camera-display-size', { body: JSON.stringify(native), contentType: 'application/json' });
	expect(native.width > 0 && native.height > 0).toBe(true);
	expect(native.width === 720 || native.height === 480).toBe(true);
	expect(Math.abs(native.width * 480 / native.height - 720 * 40 / 33)).toBeLessThan(1);
	await editor.locator('[data-project-bin-input]').setInputFiles({
		name: 'ntsc-camera.mp4', mimeType: 'video/mp4',
		buffer: bytes,
	});
	await expect(editor.getByRole('button', { name: 'More file actions: ntsc-camera', exact: true })).toBeVisible();
	const properties = await openFramescaperSourcePropertiesFromBin(page, editor, 'ntsc-camera');
	await expect(properties.locator('[data-source-property="Coded size"] dd')).toHaveText('720 × 480');
	await expect(properties.locator('[data-source-property="Display size"] dd')).toHaveText(`${String(native.width)} × ${String(native.height)}`);
	await expect(properties.locator('[data-source-property="Pixel aspect ratio"] dd')).toHaveText('40:33');
	await expect(properties.locator('[data-source-note]')).toHaveCount(0);
});
