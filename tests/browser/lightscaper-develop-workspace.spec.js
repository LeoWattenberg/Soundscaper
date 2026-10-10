/* SPDX-License-Identifier: AGPL-3.0-only */

import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { bundledLightscaperEditorCopyForLocale } from '../../src/common/i18n/lightscaper-editor-copy.ts';
import { bundledSiteCopyForLocale } from '../../src/common/i18n/site-copy.js';
import { photoDevelopCopy } from '../../src/common/i18n/lightscaper-develop-copy.ts';
import { photoDevelopMenuLabel } from '../../src/common/i18n/lightscaper-develop-menu-copy.ts';
import { expect, test } from './helpers/browser-coverage-fixture.js';
import { installNativeOpfsWorkerCompanion, assertNativeOpfsWorkerExecution } from './helpers/native-opfs-worker-companion.ts';

test.use({ browserCoverage: false });
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACAQMAAABIeJ9nAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGUExURf8gAP///4DcGxUAAAABYktHRAH/Ai3eAAAAB3RJTUUH6ggZEjoj/gYZhQAAAAxJREFUCNdjYGBgAAAABAABJzQnCgAAAABJRU5ErkJggg==', 'base64');

for (const locale of ['en', 'de']) {
	test(`${locale}: Develop remains a lazy File Photo action on an empty library`, async ({ page }) => {
		const origin = JSON.parse(process.env.SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS).lightscaper;
		await page.goto(`${origin}/${locale}/`);
		const app = page.locator('[data-lightscaper-bound="true"]'), copy = bundledLightscaperEditorCopyForLocale(locale);
		await expect(app).toBeVisible(); await expect(app.getByRole('dialog')).toHaveCount(0);
		await expect(app.locator('[data-photo-library]')).toHaveCount(0);
		await summary(page, app, copy.photoFileMenu); await summary(page, app, copy.photoPhotoMenu);
		await expect(app.getByRole('button', { name: photoDevelopMenuLabel(locale), exact: true })).toBeDisabled();
		await expect(app.locator('[data-photo-develop-workspace]')).toHaveCount(0);
	});

	test(`${locale}: keyboard Develop renders shared settings and preserves history, snapshots, versions and original bytes after reload`, async ({ page, browserName }) => {
		test.skip(browserName === 'webkit', 'The roadmap defers the full WebKit storage workflow until native Blob/OPFS support is qualified.');
		test.setTimeout(90_000);
		const origin = JSON.parse(process.env.SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS).lightscaper;
		const copy = bundledLightscaperEditorCopyForLocale(locale), messages = photoDevelopCopy(locale), errors = [];
		page.on('pageerror', error => { errors.push(error.message); });
		await page.goto(`${origin}/${locale}/`);
		const app = page.locator('[data-lightscaper-bound="true"]'); await expect(app).toBeVisible();
		await summary(page, app, copy.photoFileMenu);
		await keyboard(page, app.getByRole('button', { name: copy.photoImportPhotos, exact: true }));
		const importer = page.getByRole('dialog', { name: copy.photoImportPhotos, exact: true });
		await importer.getByLabel(copy.photoChooseFiles).setInputFiles({ name: 'Develop original.png', mimeType: 'image/png', buffer: PNG });
		await keyboard(page, importer.getByRole('button', { name: copy.photoImportAction, exact: true }));
		const library = app.getByRole('region', { name: bundledSiteCopyForLocale(locale).workspacePhoto, exact: true }), card = library.locator('[data-photo-id]');
		await expect(card).toHaveCount(1); await expect(library).toHaveAttribute('aria-busy', 'false');
		await keyboard(page, card); const photoId = await card.getAttribute('data-photo-id'), original = await observe(page, photoId);
		await openDevelop();
		const dialog = page.getByRole('dialog', { name: `${messages.title}: Develop original.png`, exact: true });
		const preview = dialog.getByRole('region', { name: messages.preview, exact: true });
		await expect(preview).toHaveAttribute('data-state', 'ready');
		const before = dialog.getByRole('img', { name: messages.before, exact: true }), after = dialog.getByRole('img', { name: messages.after, exact: true });
		expect(await extent(before)).toEqual([2, 2]); expect(await extent(after)).toEqual([2, 2]);
		const version = dialog.getByRole('combobox', { name: messages.version, exact: true }), masterVersionId = await version.inputValue();
		expect(masterVersionId).not.toBe('');
		const beforePixels = await pixels(before, [2, 2]);
		await keyboard(page, dialog.getByRole('button', { name: messages.add, exact: true }));
		await number('videoEffectParamTemperature', '0.25');
		await choose(page, dialog.getByRole('combobox', { name: messages.choose, exact: true }), 'tone-ladder-v1');
		await keyboard(page, dialog.getByRole('button', { name: messages.add, exact: true }));
		await number('videoEffectParamExposure', '-1');
		await expect.poll(async () => (await pixels(after, [2, 2]))[0]).toBeLessThan(beforePixels[0]);
		await expect(preview).toHaveAttribute('data-state', 'ready');
		const tonePixels = await pixels(after, [2, 2]);
		const mode = dialog.getByRole('combobox', { name: messages.previewMode, exact: true });
		await expect(dialog.getByRole('slider', { name: messages.divider, exact: true })).toHaveCount(0);
		await choose(page, mode, 'split');
		const divider = dialog.getByRole('slider', { name: messages.divider, exact: true });
		await expect(divider).toHaveValue('50');
		await divider.focus(); await page.keyboard.press('Home'); await expect(divider).toHaveValue('0');
		await page.keyboard.press('End'); await expect(divider).toHaveValue('100');
		await page.keyboard.press('ArrowLeft'); await expect(divider).toHaveValue('99');
		await divider.fill('50');
		const images = preview.locator('.lightscaper-develop-images'); await images.scrollIntoViewIfNeeded();
		const splitBox = await images.boundingBox(); expect(splitBox).not.toBeNull();
		const beforeBox = await before.boundingBox(), afterBox = await after.boundingBox();
		expect(beforeBox).toEqual(afterBox);
		expect(await screenPixel(page, splitBox, 0.25)).toEqual(beforePixels.slice(0, 4));
		expect(await screenPixel(page, splitBox, 0.75)).toEqual(tonePixels.slice(0, 4));
		expect(await pixels(before, [2, 2])).toEqual(beforePixels); expect(await pixels(after, [2, 2])).toEqual(tonePixels);
		await choose(page, mode, 'compare'); await expect(divider).toHaveCount(0);
		await choose(page, dialog.getByRole('combobox', { name: messages.choose, exact: true }), 'develop-geometry-v1');
		await keyboard(page, dialog.getByRole('button', { name: messages.add, exact: true }));
		await number('videoEffectParamCropWidth', '0.5');
		await expect.poll(() => extent(after)).toEqual([1, 2]);
		await expect(preview).toHaveAttribute('data-state', 'ready');
		expect(await extent(after)).toEqual([1, 2]); expect(await pixels(before, [2, 2])).toEqual(beforePixels);
		await choose(page, mode, 'split'); await expect(divider).toHaveValue('50');
		const croppedBoxes = await Promise.all([before.boundingBox(), after.boundingBox()]); expect(croppedBoxes[0]).toEqual(croppedBoxes[1]);
		expect(await before.evaluate(value => getComputedStyle(value).objectFit)).toBe('contain');
		expect(await after.evaluate(value => getComputedStyle(value).objectFit)).toBe('contain');
		await choose(page, mode, 'compare');
		await expect(dialog.getByRole('img', { name: `${messages.histogram}: ${messages.before}`, exact: true })).toBeVisible();
		await expect(dialog.getByRole('img', { name: `${messages.histogram}: ${messages.after}`, exact: true })).toBeVisible();
		await expect(dialog.getByRole('status').filter({ hasText: messages.dirty })).toBeVisible();
		await keyboard(page, dialog.getByRole('button', { name: messages.save, exact: true }));
		await expect(dialog.getByRole('button', { name: messages.save, exact: true })).toBeDisabled();
		await expect(dialog.locator('[data-photo-develop-ack]')).toContainText(messages.acknowledged);
		await expect(version).toHaveValue(masterVersionId);
		await expect(dialog.getByRole('combobox', { name: messages.history, exact: true })).toHaveValue('1');
		await expect(preview).toHaveAttribute('data-state', 'ready');
		const rendered = await pixels(dialog.getByRole('img', { name: messages.after, exact: true }), [1, 2]);
		await dialog.getByLabel(messages.snapshotName, { exact: true }).fill('Warm crop');
		await keyboard(page, dialog.getByRole('button', { name: messages.saveSnapshot, exact: true }));
		await expect(dialog.getByRole('button', { name: `${messages.restoreSnapshot}: Warm crop`, exact: true })).toBeEnabled();
		await choose(page, dialog.getByRole('combobox', { name: messages.history, exact: true }), '0');
		await expect(dialog.getByRole('combobox', { name: messages.history, exact: true })).toHaveValue('0');
		await expect.poll(() => extent(after)).toEqual([2, 2]);
		await expect(preview).toHaveAttribute('data-state', 'ready'); expect(await extent(after)).toEqual([2, 2]);
		await keyboard(page, dialog.getByRole('button', { name: `${messages.restoreSnapshot}: Warm crop`, exact: true }));
		await expect.poll(() => extent(after)).toEqual([1, 2]);
		await expect(preview).toHaveAttribute('data-state', 'ready'); expect(await pixels(after, [1, 2])).toEqual(rendered);
		await dialog.getByLabel(messages.copyName, { exact: true }).fill('Alternative');
		await keyboard(page, dialog.getByRole('button', { name: messages.createCopy, exact: true }));
		await expect(version.locator('option')).toHaveCount(2); expect(await version.inputValue()).not.toBe(masterVersionId);
		await expect(dialog.getByRole('combobox', { name: messages.history, exact: true }).locator('option')).toHaveCount(1);
		await choose(page, version, masterVersionId); await expect(dialog.getByRole('button', { name: messages.useVersion, exact: true })).toBeEnabled();
		await keyboard(page, dialog.getByRole('button', { name: messages.useVersion, exact: true }));
		await expect(dialog.getByRole('button', { name: messages.cancel, exact: true })).toBeDisabled();
		await expect(version).toHaveValue(masterVersionId);
		await expect(dialog.getByRole('combobox', { name: messages.history, exact: true })).toHaveValue('1');
		await expect(dialog.getByRole('button', { name: messages.useVersion, exact: true })).toBeDisabled();
		await closeDevelop();
		const saved = await observe(page, photoId);
		expect({ ...saved.photo, schemaVersion: original.photo.schemaVersion, revision: original.photo.revision, versions: original.photo.versions }).toEqual(original.photo);
		expect(saved.photo.schemaVersion).toBe(original.photo.schemaVersion); expect(saved.photo.revision).toBe(original.photo.revision + 6);
		const master = saved.photo.versions.find(value => value.id === masterVersionId);
		expect(master.develop.processVersion).toBe(1); expect(master.workspace.schemaVersion).toBe(1);
		expect(saved.photo.original.contentSha256).toBe(createHash('sha256').update(PNG).digest('hex')); expect(saved.bytes).toEqual(Array.from(PNG));
		await page.reload(); await expect(app).toBeVisible(); await expect(app.locator('[data-photo-library]')).toHaveCount(0);
		await summary(page, app, copy.photoViewMenu); await keyboard(page, app.getByRole('button', { name: copy.photoShowLibrary, exact: true }));
		await expect(card).toHaveCount(1); await keyboard(page, card); await openDevelop();
		await expect(preview).toHaveAttribute('data-state', 'ready');
		await expect(mode).toHaveValue('compare'); await expect(divider).toHaveCount(0);
		await expect(version).toHaveValue(masterVersionId); await expect(version.locator('option')).toHaveCount(2);
		await expect(dialog.getByRole('combobox', { name: messages.history, exact: true }).locator('option')).toHaveCount(2);
		await expect(dialog.getByRole('spinbutton', { name: exact('videoEffectParamCropWidth'), exact: true })).toHaveValue('0.5');
		expect(await pixels(before, [2, 2])).toEqual(beforePixels); expect(await pixels(after, [1, 2])).toEqual(rendered); expect(await observe(page, photoId)).toEqual(saved);
		await keyboard(page, dialog.getByRole('button', { name: `${messages.deleteSnapshot}: Warm crop`, exact: true }));
		await expect(dialog.getByRole('button', { name: `${messages.restoreSnapshot}: Warm crop`, exact: true })).toHaveCount(0);
		await closeDevelop(); expect(errors).toEqual([]);

		function exact(key) { return `${messages.shared.videoEffectExactValue}: ${messages.shared[key]}`; }
		async function number(key, value) { const control = dialog.getByRole('spinbutton', { name: exact(key), exact: true });
			await control.fill(value); await control.press('Enter'); await expect(control).toHaveValue(value); }
		async function openDevelop() { await summary(page, app, copy.photoFileMenu); await summary(page, app, copy.photoPhotoMenu);
			await keyboard(page, app.getByRole('button', { name: photoDevelopMenuLabel(locale), exact: true })); }
		async function closeDevelop() { await keyboard(page, dialog.getByRole('button', { name: messages.close, exact: true }).filter({ hasText: messages.close }));
			await expect(dialog).toHaveCount(0); }
	});
}

async function keyboard(page, locator) { await expect(locator).toBeEnabled(); await locator.focus(); await expect(locator).toBeFocused(); await page.keyboard.press('Enter'); }
async function choose(page, combo, value) {
	const index = await combo.locator('option').evaluateAll((options, value) => options.findIndex(option => option.value === value), value);
	expect(index).toBeGreaterThanOrEqual(0); expect(index).toBeLessThan(64); await combo.focus(); await expect(combo).toBeFocused(); await page.keyboard.press('Home');
	for (let step = 0; step < index; step++) await page.keyboard.press('ArrowDown'); await expect(combo).toHaveValue(value);
}
async function summary(page, app, name) { await keyboard(page, app.locator('summary').filter({ hasText: new RegExp(`^${name}$`, 'u') })); }
async function extent(canvas) { return canvas.evaluate(value => [value.width, value.height]); }
async function screenPixel(page, box, position) {
	const body = await page.screenshot({ clip: { x: Math.floor(box.x + box.width * position), y: Math.floor(box.y + box.height / 2), width: 1, height: 1 }, scale: 'css' });
	return page.evaluate(async bytes => {
		const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: 'image/png' }));
		try { const canvas = new OffscreenCanvas(1, 1), context = canvas.getContext('2d'); context.drawImage(bitmap, 0, 0);
			return Array.from(context.getImageData(0, 0, 1, 1).data);
		} finally { bitmap.close(); }
	}, Array.from(body));
}
async function pixels(canvas, expectedExtent) {
	let captured;
	await expect.poll(async () => {
		const value = await canvas.evaluate((element, extent) => {
			if (element.width !== extent[0] || element.height !== extent[1]) return null;
			return Array.from(element.getContext('2d').getImageData(0, 0, element.width, element.height).data);
		}, expectedExtent);
		if (value !== null) captured = value;
		return value !== null;
	}).toBe(true);
	return captured;
}
async function observe(page, photoId) {
	await installNativeOpfsWorkerCompanion(page);
	const result = await build({ entryPoints: [fileURLToPath(new URL('../helpers/lightscaper-current-app-fixture.tsx', import.meta.url))],
		bundle: true, write: false, format: 'esm', platform: 'browser', external: ['module'] });
	await page.route('**/__develop_original_observer.js', route => route.fulfill({ contentType: 'text/javascript', body: result.outputFiles[0].text }));
	const observed = await page.evaluate(async id => {
		const module = await import(new URL('/__develop_original_observer.js', location.href).href);
		return (await module.readResidentPhotoLibraryCurrent([id], indexedDB, () => globalThis.__assertNativeOpfsWorkerExecution())).photos[0];
	}, photoId);
	await assertNativeOpfsWorkerExecution(page); return observed;
}
