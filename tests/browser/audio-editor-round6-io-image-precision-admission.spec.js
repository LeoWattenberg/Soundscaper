/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { createPngFixture } from '../helpers/png-fixture.mjs';
import { ordinaryHighPrecisionPng } from '../helpers/framescaper-ordinary-high-precision-image-fixture.ts';
import { bootEditor, chooseNestedCommandAction } from './audio-editor-test-helpers.js';

for (const highPrecision of [false, true]) test(`ordinary ${highPrecision ? '16-bit' : '8-bit'} PNG respects native image precision admission`, async ({ page }, testInfo) => {
	const editor = await bootEditor(page, '/framescaper/en/');
	const bytes = highPrecision ? ordinaryHighPrecisionPng() : createPngFixture(16);
	expect(bytes[24]).toBe(highPrecision ? 16 : 8);
	await testInfo.attach('ordinary-png.png', { body: bytes, contentType: 'image/png' });
	const chooser = page.waitForEvent('filechooser');
	await chooseNestedCommandAction(page, editor, 'Generate', ['Add Images']);
	await (await chooser).setFiles({ name: 'ordinary.png', mimeType: 'image/png', buffer: bytes });
	if (highPrecision) {
		await expect(editor.locator('[data-status]')).toHaveAttribute('data-state', 'error');
		await expect(editor.locator('[data-status]')).toContainText(/precision|16.bit/iu);
		await expect(editor.getByRole('group', { name: 'Image clip: ordinary', exact: true })).toHaveCount(0);
	} else {
		await expect(editor.getByRole('group', { name: 'Image clip: ordinary', exact: true })).toBeVisible();
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
		await page.reload();
		await expect(editor.getByRole('group', { name: 'Image clip: ordinary', exact: true })).toBeVisible();
	}
});
