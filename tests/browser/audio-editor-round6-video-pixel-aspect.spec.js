/* SPDX-License-Identifier: AGPL-3.0-only */

import { readFile } from 'node:fs/promises';
import { expect } from '@playwright/test';
import { test } from './audio-editor-test-fixtures.js';
import { resolveBrowserProductTestUrl } from './helpers/browser-product-test-url.js';
import { openFramescaperSourcePropertiesFromBin } from './helpers/framescaper-source-properties.js';

test('ordinary NTSC camera import retains its declared pixel aspect ratio', async ({ page }) => {
	await page.goto(resolveBrowserProductTestUrl('/framescaper/en/'));
	const editor = page.locator('[data-audio-editor]');
	await expect(editor).toHaveAttribute('data-audio-editor-bound', 'true');
	await expect(editor.locator('[data-status]')).toHaveAttribute('data-state', 'success');
	const decline = page.getByRole('button', { name: 'Decline', exact: true });
	if (await decline.isVisible()) await decline.click();
	await editor.locator('[data-project-bin-input]').setInputFiles({
		name: 'ntsc-camera.mp4', mimeType: 'video/mp4',
		buffer: Buffer.from(await readFile(new URL('./fixtures/ntsc-anamorphic-pasp.mp4.base64', import.meta.url), 'utf8'), 'base64'),
	});
	await expect(editor.getByRole('button', { name: 'More file actions: ntsc-camera', exact: true })).toBeVisible();
	const properties = await openFramescaperSourcePropertiesFromBin(page, editor, 'ntsc-camera');
	await expect(properties.locator('[data-source-property="Coded size"] dd')).toHaveText('720 × 480');
	await expect(properties.locator('[data-source-property="Display size"] dd')).toHaveText('873 × 480');
	await expect(properties.locator('[data-source-property="Pixel aspect ratio"] dd')).toHaveText('40:33');
	await expect(properties.locator('[data-source-note]')).toHaveCount(0);
});
