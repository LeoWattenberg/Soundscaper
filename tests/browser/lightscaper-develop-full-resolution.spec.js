/* SPDX-License-Identifier: AGPL-3.0-only */

import { bundledLightscaperEditorCopyForLocale } from '../../src/common/i18n/lightscaper-editor-copy.ts';
import { photoDevelopCopy } from '../../src/common/i18n/lightscaper-develop-copy.ts';
import { photoDevelopSettingsCopy } from '../../src/common/i18n/lightscaper-develop-settings-copy.ts';
import { photoDevelopMenuLabel } from '../../src/common/i18n/lightscaper-develop-menu-copy.ts';
import { RESOLUTION_PNG_BASE64, RESOLUTION_WIDTH, RESOLUTION_HEIGHT, resolutionPixels, resolutionBins } from './helpers/lightscaper-resolution-reference.ts';
import { expect, test } from './helpers/browser-coverage-fixture.js';

const PNG = Buffer.from(RESOLUTION_PNG_BASE64, 'base64'), NAME = 'Resolution reference.png';

for (const locale of ['en', 'de']) test(`${locale}: keyboard full-resolution inspection renders original spatial detail, scrolls at100% and resets without authoring history`, async ({ page, browserName }) => {
	test.skip(browserName === 'webkit', 'The roadmap defers the full WebKit storage workflow until native Blob/OPFS support is qualified.');
	test.setTimeout(90_000);
	const copy = bundledLightscaperEditorCopyForLocale(locale), messages = photoDevelopCopy(locale), settings = photoDevelopSettingsCopy(locale), errors = [];
	page.on('pageerror', error => { errors.push(error.message); });
	const origin = JSON.parse(process.env.SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS).lightscaper;
	await page.goto(`${origin}/${locale}/`); const app = page.locator('[data-lightscaper-bound="true"]'); await expect(app).toBeVisible();
	await action(page, app, copy.photoFileMenu, copy.photoImportPhotos);
	const importer = named(page, 'dialog', copy.photoImportPhotos);
	await importer.getByLabel(copy.photoChooseFiles, { exact: true }).setInputFiles({ name: NAME, mimeType: 'image/png', buffer: PNG });
	await keyboard(page, named(importer, 'button', copy.photoImportAction)); await expect(importer).toHaveCount(0);
	const library = app.locator('[data-photo-library]'), card = library.getByRole('button').filter({ has: page.getByText(NAME, { exact: true }) });
	await expect(card).toHaveCount(1); await expect(library).toHaveAttribute('aria-busy', 'false'); await keyboard(page, card); await open();
	const dialog = named(page, 'dialog', `${messages.title}: ${NAME}`), history = named(dialog, 'combobox', messages.history);
	await expect(history).toHaveValue('0'); await dimensions(2048); await expect(named(dialog, 'button', messages.fullResolution)).toBeHidden();
	await menu(); const started = Date.now(); await keyboard(page, named(dialog, 'button', messages.fullResolution));
	await fullPixels(false); const elapsedMs = Date.now() - started; expect(elapsedMs).toBeLessThanOrEqual(5000);
	await histogram(false); await expect(history).toHaveValue('0'); await expect(named(dialog, 'button', messages.save)).toBeDisabled();
	const viewport = named(dialog, 'region', messages.imageViewport);
	await viewport.focus(); await expect(viewport).toBeFocused(); await page.keyboard.press('ArrowRight');
	await expect.poll(() => viewport.evaluate(element => element.scrollLeft)).toBeGreaterThan(0);
	await expect.poll(() => named(dialog, 'img', messages.after).evaluate(canvas => ({ cssWidth: canvas.getBoundingClientRect().width, cssHeight: canvas.getBoundingClientRect().height })))
		.toEqual({ cssWidth: RESOLUTION_WIDTH, cssHeight: RESOLUTION_HEIGHT });
	await chooseFamily(page, named(dialog, 'combobox', messages.choose), 'detail-sharpen-v1'); await keyboard(page, named(dialog, 'button', messages.add));
	const amount = named(dialog, 'spinbutton', `${messages.shared.videoEffectExactValue}: ${messages.shared.videoEffectDetailSharpenAmount}`);
	await amount.fill('50'); await amount.press('Enter'); await expect(amount).toHaveValue('50');
	await fullPixels(true); await histogram(true); await expect(history).toHaveValue('0');
	await keyboard(page, named(dialog, 'button', messages.save)); await expect(dialog.locator('[data-photo-develop-ack]')).toContainText(messages.acknowledged);
	await expect(history).toHaveValue('1'); await expect(named(dialog, 'button', messages.cancel)).toBeDisabled();
	await expect(library).toHaveAttribute('aria-busy', 'false'); await fullPixels(true);
	await menu(); await keyboard(page, named(dialog, 'button', messages.fitResolution)); await dimensions(2048); await expect(history).toHaveValue('1');
	await menu(); await keyboard(page, named(dialog, 'button', messages.fullResolution)); await fullPixels(true); await expect(history).toHaveValue('1');
	await close(); await open(); await dimensions(2048); await expect(named(dialog, 'region', messages.imageViewport)).toHaveCount(0);
	await menu(); await expect(named(dialog, 'button', messages.fitResolution)).toHaveAttribute('aria-pressed', 'true');
	await keyboard(page, named(dialog, 'button', messages.fullResolution)); await fullPixels(true); await expect(history).toHaveValue('1');
	await close(); await page.reload(); await expect(app).toBeVisible(); await action(page, app, copy.photoViewMenu, copy.photoShowLibrary);
	await expect(card).toHaveCount(1); await expect(library).toHaveAttribute('aria-busy', 'false'); await keyboard(page, card); await open();
	await dimensions(2048); await expect(history).toHaveValue('1'); await expect(amount).toHaveValue('50');
	await menu(); await keyboard(page, named(dialog, 'button', messages.fullResolution)); await fullPixels(true); await histogram(true);
	await expect(dialog.getByRole('alert')).toHaveCount(0); await close(); expect(errors).toEqual([]);
	await test.info().attach('full-resolution-observation', { body: JSON.stringify({ locale, browserName, width: RESOLUTION_WIDTH,
		height: RESOLUTION_HEIGHT, sourcePixels: RESOLUTION_WIDTH * RESOLUTION_HEIGHT, firstInspectionElapsedMs: elapsedMs, firstInspectionBudgetMs: 5000 }), contentType: 'application/json' });

	async function open() { await action(page, app, copy.photoFileMenu, photoDevelopMenuLabel(locale), copy.photoPhotoMenu); await expect(dialogLocator()).toBeVisible(); }
	function dialogLocator() { return named(page, 'dialog', `${messages.title}: ${NAME}`); }
	async function close() { await keyboard(page, named(dialog, 'button', messages.close).filter({ hasText: new RegExp(`^${escape(messages.close)}$`, 'u') })); await expect(dialog).toHaveCount(0); }
	async function menu() { const summary = dialog.locator('summary').filter({ hasText: new RegExp(`^${escape(settings.menu)}$`, 'u') });
		if (!await summary.evaluate(element => element.parentElement.open)) await keyboard(page, summary); }
	async function dimensions(width) {
		await expect.poll(() => named(dialog, 'img', messages.after).evaluate(canvas => ({ width: canvas.width, height: canvas.height })))
			.toEqual({ width, height: RESOLUTION_HEIGHT });
	}
	async function fullPixels(developed) {
		for (const [label, changed] of [[messages.before, false], [messages.after, developed]]) {
			await expect.poll(() => named(dialog, 'img', label).evaluate(canvas => canvas.width !== 2052 || canvas.height !== 8 ? null
				: Array.from(canvas.getContext('2d').getImageData(0,0,2052,8).data)), { timeout: 5000 }).toEqual([...resolutionPixels(changed)]);
		}
	}
	async function histogram(developed) {
		const value = named(dialog, 'img', `${messages.histogram}: ${messages.after}`), counts = resolutionBins(developed), maximum = Math.max(...counts);
		const points = counts.map((count, index) => `${index},${100 - count / maximum * 100}`).join(' ');
		await expect.poll(() => value.evaluate(svg => [...svg.querySelectorAll('polyline')].map(line => line.getAttribute('points')))).toEqual([points,points,points]);
		const format = new Intl.NumberFormat(locale);
		await expect.poll(() => value.evaluate(svg => [...svg.parentElement.querySelectorAll('dl > *')].map(row => row.textContent))).toEqual(
			[messages.samples, format.format(RESOLUTION_WIDTH * RESOLUTION_HEIGHT), messages.low, format.format(0), messages.high, format.format(0)]);
	}
});

async function chooseFamily(page, control, value) {
	const values = await control.locator('option').evaluateAll(options => options.map(option => option.value)), target = values.indexOf(value);
	expect(values).toEqual(['white-balance-v1', 'tone-ladder-v1', 'develop-geometry-v1', 'chroma-v1', 'black-white-mix-v1', 'hsl-mixer-v1',
		'point-curves-v1', 'parametric-curves-v1', 'color-wheels-v1', 'detail-sharpen-v1', 'post-crop-vignette-v1', 'clarity-v1',
		'noise-reduction-v1', 'grain-v1', 'texture-v1', 'dehaze-v1', 'cube-lut-profile-v1']); expect(target).toBeGreaterThanOrEqual(0);
	await control.focus(); await expect(control).toBeFocused();
	await page.keyboard.press('Home'); for (let index = 0; index < target; index++) await page.keyboard.press('ArrowDown');
	await page.keyboard.press('Tab'); await expect(control).toHaveValue(value);
}
function named(scope, role, name) { return scope.getByRole(role, { name, exact: true }); }
function escape(value) { return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'); }
async function keyboard(page, control) { await expect(control).toBeEnabled(); await control.focus(); await expect(control).toBeFocused(); await page.keyboard.press('Enter'); }
async function action(page, app, menu, name, submenu) {
	await keyboard(page, app.locator('nav > details > summary').filter({ hasText: new RegExp(`^${escape(menu)}$`, 'u') }));
	if (submenu) await keyboard(page, app.locator('summary').filter({ hasText: new RegExp(`^${escape(submenu)}$`, 'u') }));
	await keyboard(page, named(app, 'button', name));
}
