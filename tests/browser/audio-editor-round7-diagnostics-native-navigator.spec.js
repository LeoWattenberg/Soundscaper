/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, collectClientErrors } from './audio-editor-test-helpers.js';

for (const { product, path } of [
	{ product: 'soundscaper', path: '/embed/en/' },
	{ product: 'framescaper', path: '/framescaper/embed/en/' },
]) test(`${product} Diagnostics exports the actual native browser environment`, async ({ page }) => {
	const errors = collectClientErrors(page);
	const editor = await bootEditor(page, path);
	const native = await page.evaluate(() => ({ platform: navigator.platform, userAgent: navigator.userAgent }));
	expect(native.platform).toMatch(/Linux/u);
	const version = /(?:Chrome|Chromium)\/([0-9.]+)/u.exec(native.userAgent)?.[1];
	expect(version).toBeTruthy();
	await chooseCommandAction(page, editor, 'Help', 'Diagnostics');
	const dialog = page.getByRole('dialog', { name: 'Local Diagnostics', exact: true });
	await expect(dialog.getByRole('button', { name: 'Export local diagnostic report', exact: true })).toHaveCount(0);
	await dialog.getByRole('button', { name: 'Generate local diagnostic report', exact: true }).click();
	await expect(dialog.getByRole('heading', { name: 'Environment', exact: true })).toBeVisible();
	const downloadEvent = page.waitForEvent('download');
	await dialog.getByRole('button', { name: 'Export local diagnostic report', exact: true }).click();
	const download = await downloadEvent;
	expect(download.suggestedFilename()).toMatch(new RegExp(`^${product}-diagnostics-\\d{4}-\\d{2}-\\d{2}\\.json$`, 'u'));
	const chunks = [];
	for await (const chunk of await download.createReadStream()) chunks.push(chunk);
	const bytes = Buffer.concat(chunks);
	expect(bytes.byteLength).toBeLessThanOrEqual(128 * 1024);
	const text = new TextDecoder().decode(bytes);
	const report = JSON.parse(text);
	expect(report.kind).toBe('soundscaper-local-diagnostics');
	expect(report.product).toEqual({ id: product });
	expect(report.environment.kind).toBe('browser');
	expect(report.environment.locale).toBe('en');
	expect(text).not.toMatch(/"(?:title|path|message|stack|transcript|media|sources|clips|userAgent)"/u);
	expect(report.environment.platform).toBe('linux');
	expect(report.environment.architecture).toBe('x64');
	expect(report.environment.browser).toEqual({ name: 'chromium', version });
	await expect(dialog).toContainText('browser; linux; x64; en');
	expect(errors).toEqual([]);
});
