/* SPDX-License-Identifier: AGPL-3.0-only */

import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { bundledLightscaperEditorCopyForLocale } from '../../src/common/i18n/lightscaper-editor-copy.ts';
import { photoDevelopCopy } from '../../src/common/i18n/lightscaper-develop-copy.ts';
import { photoDevelopMenuLabel } from '../../src/common/i18n/lightscaper-develop-menu-copy.ts';
import { importPhotoCatalogArchiveV5 } from '../../src/lightscaper/archive/catalog-archive-import-v5.ts';
import { WHEEL_PNG_BASE64, WHEEL_SOURCE, WHEEL_REFERENCES } from './helpers/lightscaper-color-wheels-reference.ts';
import { requireNativeWheelAxis } from './helpers/native-wheel-axis.ts';
import { expect, test } from './helpers/browser-coverage-fixture.js';

const PNG = Buffer.from(WHEEL_PNG_BASE64, 'base64'), NAME = 'Wheel reference.png';

for (const locale of ['en', 'de']) test(`${locale}: Photo wheels author through keyboard and native capture, preserve canceled numeric edits and persist literal pixels through reload`, async ({ page, browserName }) => {
	test.skip(browserName === 'webkit', 'The roadmap defers the full WebKit storage workflow until native Blob/OPFS support is qualified.');
	test.setTimeout(90_000);
	const copy = bundledLightscaperEditorCopyForLocale(locale), messages = photoDevelopCopy(locale), errors = [];
	const [shadow, gain] = WHEEL_REFERENCES;
	page.on('pageerror', error => { errors.push(error.message); });
	await page.addInitScript(() => { Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: undefined }); });
	const origin = JSON.parse(process.env.SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS).lightscaper;
	await page.goto(`${origin}/${locale}/`);
	const app = page.locator('[data-lightscaper-bound="true"]'); await expect(app).toBeVisible();
	await action(page, app, copy.photoFileMenu, copy.photoImportPhotos);
	const importer = named(page, 'dialog', copy.photoImportPhotos);
	await importer.getByLabel(copy.photoChooseFiles, { exact: true }).setInputFiles({ name: NAME, mimeType: 'image/png', buffer: PNG });
	await keyboard(page, named(importer, 'button', copy.photoImportAction)); await expect(importer).toHaveCount(0);
	const library = app.locator('[data-photo-library]'), card = library.getByRole('button').filter({ has: page.getByText(NAME, { exact: true }) });
	await expect(card).toHaveCount(1); await expect(library).toHaveAttribute('aria-busy', 'false');
	const initial = await backupPhoto(page, app, copy); expect(initial.original).toEqual(PNG);
	await keyboard(page, card); await open();
	const dialog = named(page, 'dialog', `${messages.title}: ${NAME}`), history = named(dialog, 'combobox', messages.history), version = named(dialog, 'combobox', messages.version);
	await expect(history).toHaveValue('0'); const versionId = await version.inputValue(); expect(versionId).toBe(initial.document.activeVersionId);
	await expectPixels(dialog, messages.before, WHEEL_SOURCE); await expectPixels(dialog, messages.after, WHEEL_SOURCE);
	await chooseFamily(page, named(dialog, 'combobox', messages.choose), 'color-wheels-v1');
	await keyboard(page, named(dialog, 'button', messages.add));
	await expect(dialog.locator('[data-video-color-wheel]')).toHaveCount(3);
	for (const group of ['Shadows', 'Midtones', 'Highlights']) await expect(wheel(dialog, messages, group)).toBeEnabled();
	const shadows = wheel(dialog, messages, 'Shadows');
	await shadows.focus(); await expect(shadows).toBeFocused();
	await page.keyboard.press('End'); await expect(parameter(dialog, messages, 'Shadows', 'Saturation')).toHaveValue('100');
	await page.keyboard.press('ArrowRight'); await expect(parameter(dialog, messages, 'Shadows', 'Hue')).toHaveValue('1');
	await page.keyboard.press('ArrowLeft'); await expect(parameter(dialog, messages, 'Shadows', 'Hue')).toHaveValue('0');
	await page.keyboard.press('Home'); await expect(parameter(dialog, messages, 'Shadows', 'Saturation')).toHaveValue('0');
	await page.keyboard.press('End'); await expectPixels(dialog, messages.after, shadow.pixels); await expectHistogram(dialog, messages, shadow, locale);
	await reset(page, dialog, messages, 'Shadows'); await expectPixels(dialog, messages.after, WHEEL_SOURCE);
	await observeCapture(shadows);
	try {
		const luminance = parameter(dialog, messages, 'Shadows', 'Luminance');
		await luminance.fill('20'); await luminance.fill('101');
		await expect(dialog.getByRole('alert')).toHaveText(messages.shared.videoEffectWheelInvalid);
		// The first real pointerdown cancels the invalid numeric preview before
		// acquiring native capture; no second click or synthetic pointer event.
		await shadows.scrollIntoViewIfNeeded(); const bounds = await integralWheelBounds(shadows);
		const x = bounds.left + bounds.width / 2, y = bounds.top + bounds.height / 2;
		await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + bounds.width, y);
		await requireAxis(shadows, 'horizontal');
		await expect(shadows).toHaveAttribute('data-wheel-native-got', '1');
		await expect(shadows).toHaveAttribute('data-wheel-native-trusted', 'true');
		await expect(luminance).toHaveValue('0'); await expect(dialog.getByRole('alert')).toHaveCount(0);
		await page.mouse.up(); await expect(shadows).toHaveAttribute('data-wheel-native-lost', '1');
		await expect(parameter(dialog, messages, 'Shadows', 'Saturation')).toHaveValue('100');
		await expect(parameter(dialog, messages, 'Shadows', 'Hue')).toHaveValue('0');
		await expectPixels(dialog, messages.after, shadow.pixels); await expectHistogram(dialog, messages, shadow, locale);
		// Loss of actual native capture cancels this second drag and retains
		// the previously accepted red shadow recipe.
		await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x, y - bounds.height);
		await requireAxis(shadows, 'vertical');
		await expect(shadows).toHaveAttribute('data-wheel-native-got', '2');
		await expect(parameter(dialog, messages, 'Shadows', 'Hue')).toHaveValue('-90');
		await shadows.evaluate(element => {
			const id = Number(element.getAttribute('data-wheel-native-id'));
			if (!element.hasPointerCapture(id)) throw Error('The second drag must own actual native capture.');
			element.releasePointerCapture(id);
		});
		await page.mouse.move(x, y); await expect(shadows).toHaveAttribute('data-wheel-native-lost', '2'); await page.mouse.up();
		await expect(parameter(dialog, messages, 'Shadows', 'Hue')).toHaveValue('0');
		await expect(parameter(dialog, messages, 'Shadows', 'Saturation')).toHaveValue('100');
		await expect(luminance).toHaveValue('0'); await expectPixels(dialog, messages.after, shadow.pixels);
	} finally { if (await shadows.count()) await stopCapture(shadows); }
	await reset(page, dialog, messages, 'Shadows'); await expectPixels(dialog, messages.after, WHEEL_SOURCE);
	await number(parameter(dialog, messages, 'Highlights', 'Luminance'), '100');
	await expectPixels(dialog, messages.before, WHEEL_SOURCE); await expectPixels(dialog, messages.after, gain.pixels); await expectHistogram(dialog, messages, gain, locale);
	await expect(dialog.getByRole('alert')).toHaveCount(0);
	await keyboard(page, named(dialog, 'button', messages.save));
	await expect(dialog.locator('[data-photo-develop-ack]')).toContainText(messages.acknowledged);
	await expect(named(dialog, 'button', messages.cancel)).toBeDisabled(); await expect(library).toHaveAttribute('aria-busy', 'false');
	await expect(history).toHaveValue('1'); await expect(version).toHaveValue(versionId); await expectPixels(dialog, messages.after, gain.pixels); await close();
	const saved = await backupPhoto(page, app, copy), savedVersion = active(saved.document);
	assertOriginal(saved, initial); expect(savedVersion.id).toBe(versionId);
	expect(savedVersion.develop.effects).toHaveLength(1);
	expect(savedVersion.develop.effects[0]).toMatchObject({ type: 'color-wheels-v1', enabled: true, params: gain.params });
	expect(savedVersion.develop.effects[0].params).toEqual(gain.params); expect(savedVersion.develop.processVersion).toBe(1);
	expect(savedVersion.develop.geometry).toEqual(active(initial.document).develop.geometry);
	expect(savedVersion.develop.masks).toEqual([]); expect(savedVersion.develop.maskBindings).toEqual([]);
	expect(savedVersion.workspace.cursor).toBe(1); expect(savedVersion.workspace.entries).toHaveLength(2);
	expect(savedVersion.workspace.entries[0].develop).toEqual(active(initial.document).develop);
	expect(savedVersion.workspace.entries[1].develop).toEqual(savedVersion.develop); expect(savedVersion.workspace.snapshots).toEqual([]);
	await page.reload(); await expect(app).toBeVisible(); await expect(library).toHaveCount(0);
	await action(page, app, copy.photoViewMenu, copy.photoShowLibrary);
	await expect(card).toHaveCount(1); await expect(library).toHaveAttribute('aria-busy', 'false'); await keyboard(page, card); await open();
	await expect(history).toHaveValue('1'); await expect(version).toHaveValue(versionId);
	await expect(dialog.locator('[data-video-color-wheel]')).toHaveCount(3);
	for (const group of ['Shadows', 'Midtones', 'Highlights']) for (const axis of ['Hue', 'Saturation', 'Luminance']) {
		await expect(parameter(dialog, messages, group, axis)).toHaveValue(String(gain.params[`${group.toLowerCase()}${axis}`]));
	}
	await expectPixels(dialog, messages.before, WHEEL_SOURCE); await expectPixels(dialog, messages.after, gain.pixels); await expectHistogram(dialog, messages, gain, locale);
	await close(); const reopened = await backupPhoto(page, app, copy); assertOriginal(reopened, initial);
	expect(active(reopened.document)).toEqual(savedVersion); expect(errors).toEqual([]);

	async function open() { await action(page, app, copy.photoFileMenu, photoDevelopMenuLabel(locale), copy.photoPhotoMenu); await expect(named(page, 'dialog', `${messages.title}: ${NAME}`)).toBeVisible(); }
	async function close() { await keyboard(page, bodyClose(dialog, messages.close)); await expect(dialog).toHaveCount(0); }
});

function wheel(dialog, messages, group) { return named(dialog, 'slider', messages.shared[`videoEffectWheel${group}`]); }
function parameter(dialog, messages, group, axis) { return named(dialog, 'spinbutton', `${messages.shared.videoEffectExactValue}: ${messages.shared[`videoEffectWheel${group}`]}: ${messages.shared[`videoEffectParam${axis}`]}`); }
async function number(control, value) { await control.fill(value); await control.press('Enter'); await expect(control).toHaveValue(value); }
async function reset(page, dialog, messages, group) { await keyboard(page, named(dialog, 'button', `${messages.shared.videoEffectWheelReset}: ${messages.shared[`videoEffectWheel${group}`]}`)); }
async function chooseFamily(page, control, value) {
	const values = await control.locator('option').evaluateAll(options => options.map(option => option.value)), target = values.indexOf(value);
	expect(values).toEqual(['white-balance-v1', 'tone-ladder-v1', 'develop-geometry-v1', 'chroma-v1', 'black-white-mix-v1', 'hsl-mixer-v1',
		'point-curves-v1', 'parametric-curves-v1', 'color-wheels-v1', 'detail-sharpen-v1', 'post-crop-vignette-v1', 'clarity-v1',
		'noise-reduction-v1', 'grain-v1', 'texture-v1', 'dehaze-v1', 'cube-lut-profile-v1']); expect(target).toBeGreaterThanOrEqual(0);
	await control.focus(); await expect(control).toBeFocused(); await page.keyboard.press('Home');
	for (let index = 0; index < target; index++) await page.keyboard.press('ArrowDown');
	await page.keyboard.press('Tab'); await expect(control).toHaveValue(value);
}
async function observeCapture(control) {
	await control.evaluate(element => {
		let got = 0, lost = 0;
		const gained = event => { element.setAttribute('data-wheel-native-got', String(++got)); element.setAttribute('data-wheel-native-id', String(event.pointerId)); element.setAttribute('data-wheel-native-trusted', String(event.isTrusted)); };
		const released = () => { element.setAttribute('data-wheel-native-lost', String(++lost)); };
		element.__wheelAxisRecords = { down: null, move: null };
		const recorded = event => {
			if (event.buttons !== 1) return;
			const { left, top, width, height } = element.getBoundingClientRect();
			element.__wheelAxisRecords[event.type === 'pointerdown' ? 'down' : 'move'] = { trusted: event.isTrusted, buttons: event.buttons, clientX: event.clientX, clientY: event.clientY, rect: { left, top, width, height } };
		};
		element.addEventListener('pointerdown', recorded, { capture: true, passive: true }); element.addEventListener('pointermove', recorded, { capture: true, passive: true });
		element.addEventListener('gotpointercapture', gained); element.addEventListener('lostpointercapture', released);
		element.__wheelCaptureObserver = () => { element.removeEventListener('gotpointercapture', gained); element.removeEventListener('lostpointercapture', released);
			element.removeEventListener('pointerdown', recorded, true); element.removeEventListener('pointermove', recorded, true); };
	});
}
async function stopCapture(control) { await control.evaluate(element => { element.__wheelCaptureObserver(); element.__wheelRestoreAxis?.();
	delete element.__wheelCaptureObserver; delete element.__wheelRestoreAxis; delete element.__wheelAxisRecords;
	for (const name of ['got', 'lost', 'id', 'trusted']) element.removeAttribute(`data-wheel-native-${name}`); }); }
async function integralWheelBounds(control) {
	return control.evaluate(element => {
		const original = element.style.getPropertyValue('transform'), priority = element.style.getPropertyPriority('transform');
		if (getComputedStyle(element).transform !== 'none') throw Error('The native axis fixture expects an untransformed wheel.');
		element.__wheelRestoreAxis = () => { if (original) element.style.setProperty('transform', original, priority); else element.style.removeProperty('transform'); };
		const rect = element.getBoundingClientRect(), x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
		// Firefox delivers integer native mouse coordinates. Arrange the actual
		// DOM center on that shared grid instead of rounding production input.
		// Move inward to the next grid point so focus does not scroll the wheel
		// back across the viewport inset after the first native pointerdown.
		element.style.setProperty('transform', `translate(${Math.ceil(x) - x}px, ${Math.ceil(y) - y}px)`);
		const { left, top, width, height } = element.getBoundingClientRect();
		if (!Number.isInteger(left + width / 2) || !Number.isInteger(top + height / 2)) throw Error('Native wheel center alignment did not settle exactly.');
		return { left, top, width, height };
	});
}
async function requireAxis(control, axis) {
	const records = await control.evaluate(element => element.__wheelAxisRecords);
	await test.info().attach(`native-wheel-${axis}-axis`, { body: JSON.stringify(records), contentType: 'application/json' });
	requireNativeWheelAxis(records.down, 'center'); requireNativeWheelAxis(records.move, axis);
}
async function expectPixels(dialog, name, expected) {
	await expect.poll(() => named(dialog, 'img', name).evaluate(canvas => canvas.width !== 2 || canvas.height !== 2 ? null
		: Array.from(canvas.getContext('2d').getImageData(0, 0, 2, 2).data))).toEqual(expected);
}
async function expectHistogram(dialog, messages, reference, locale) {
	const histogram = named(dialog, 'img', `${messages.histogram}: ${messages.after}`);
	await expect.poll(() => histogram.evaluate(svg => [...svg.querySelectorAll('polyline')].map(line => ({ channel: line.getAttribute('stroke'),
		bins: line.getAttribute('points').split(' ').flatMap(point => { const [bin, y] = point.split(',').map(Number); return y === 100 ? [] : [[bin, (100 - y) / 50]]; }) })))).toEqual(
		['red', 'green', 'blue'].map(channel => ({ channel, bins: reference.bins[channel] })));
	const formatter = new Intl.NumberFormat(locale);
	await expect.poll(() => histogram.evaluate(svg => [...svg.parentElement.querySelectorAll('dl > *')].map(row => row.textContent))).toEqual(
		[messages.samples, formatter.format(4), messages.low, formatter.format(reference.low), messages.high, formatter.format(reference.high)]);
}
async function backupPhoto(page, app, copy) {
	await action(page, app, copy.photoFileMenu, copy.photoBackupTitle);
	const dialog = named(page, 'dialog', copy.photoBackupTitle), pending = page.waitForEvent('download');
	await keyboard(page, named(dialog, 'button', copy.photoBackupSave)); const download = await pending, bytes = await readFile(await download.path());
	await expect(dialog.locator('[data-photo-backup-receipt]')).toContainText(copy.photoBackupDownloadStarted.replace('{name}', download.suggestedFilename()));
	await keyboard(page, bodyClose(dialog, copy.photoBackupClose)); await expect(dialog).toHaveCount(0);
	let photo = null;
	await importPhotoCatalogArchiveV5(new Blob([bytes]), async (root, state, presets, luts) => {
		expect(root.photoCount).toBe(1); expect(state).toBeNull(); expect(presets).toBeNull(); expect(luts).toEqual([]);
		return { async writePhoto(document, chunks) { expect(photo).toBeNull(); const parts = []; let length = 0;
			expect(document.schemaVersion).toBe(1);
			for (const version of document.versions) { expect(version.develop.processVersion).toBe(1); if (version.workspace) expect(version.workspace.schemaVersion).toBe(1); }
			for await (const chunk of chunks) { length += chunk.byteLength; expect(length).toBeLessThanOrEqual(PNG.byteLength); parts.push(Buffer.from(chunk)); }
			photo = { document, original: Buffer.concat(parts) };
		}, async writeStack() { throw Error('Unexpected stack.'); }, async writeSavedCollection() { throw Error('Unexpected saved collection.'); },
		async writeDevelopPresets() { throw Error('Unexpected preset.'); }, async writeLut() { throw Error('Unexpected LUT resource.'); },
		async publish() {}, async rollback() { throw Error('Wheel backup authentication rolled back.'); } };
	});
	expect(photo).not.toBeNull(); return photo;
}
function assertOriginal(actual, initial) {
	expect(actual.original).toEqual(PNG); expect(actual.original).toEqual(initial.original);
	expect(actual.document.original.contentSha256).toBe(createHash('sha256').update(PNG).digest('hex'));
	expect({ ...actual.document, revision: initial.document.revision, versions: initial.document.versions }).toEqual(initial.document);
	expect(actual.document.revision).toBe(initial.document.revision + 1);
}
function active(document) { const value = document.versions.find(version => version.id === document.activeVersionId); expect(value).toBeDefined(); return value; }
function named(scope, role, name) { return scope.getByRole(role, { name, exact: true }); }
function bodyClose(scope, name) { return named(scope, 'button', name).filter({ hasText: new RegExp(`^${escape(name)}$`, 'u') }); }
function escape(value) { return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'); }
async function keyboard(page, control) { await expect(control).toBeEnabled(); await control.focus(); await expect(control).toBeFocused(); await page.keyboard.press('Enter'); }
async function action(page, app, menu, name, submenu) {
	await keyboard(page, app.locator('nav > details > summary').filter({ hasText: new RegExp(`^${escape(menu)}$`, 'u') }));
	if (submenu) await keyboard(page, app.locator('summary').filter({ hasText: new RegExp(`^${escape(submenu)}$`, 'u') }));
	await keyboard(page, named(app, 'button', name));
}
