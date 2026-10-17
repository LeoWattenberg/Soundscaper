/* SPDX-License-Identifier: AGPL-3.0-only */

import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { bundledLightscaperEditorCopyForLocale } from '../../src/common/i18n/lightscaper-editor-copy.ts';
import { photoDevelopCopy } from '../../src/common/i18n/lightscaper-develop-copy.ts';
import { photoDevelopMenuLabel } from '../../src/common/i18n/lightscaper-develop-menu-copy.ts';
import { importPhotoCatalogArchiveV5 } from '../../src/lightscaper/archive/catalog-archive-import-v5.ts';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { browserProductSiteForBuild } from '../../scripts/lib/browser-product-site-plan.mjs';
import { DEHAZE_PNG_BASE64, DEHAZE_SOURCE, DEHAZE_PARAMS, DEHAZE_PIXELS, DEHAZE_BINS } from './helpers/lightscaper-dehaze-reference.ts';
import { dehazeReferenceV1 } from '../helpers/video-dehaze-reference.ts';
import { expect, test } from './helpers/browser-coverage-fixture.js';

const syntheticRouteTest = test.extend({ browserCoverage: false });
const PNG=Buffer.from(DEHAZE_PNG_BASE64,'base64'),NAME='Dehaze reference.png';
const REFERENCE={type:'dehaze-v1',params:DEHAZE_PARAMS,pixels:DEHAZE_PIXELS,low:0,high:0,bins:DEHAZE_BINS};
const ENTRY=new URL('./helpers/lightscaper-dehaze-reference.ts',import.meta.url),MODULE='/__dehaze_native.js';

for (const locale of ['en', 'de']) {
	const reference=REFERENCE;
	test(`${locale}: keyboard Photo ${reference.type} preserves literal proxy pixels, histogram and durable recipe through history and reload`, async ({ page, browserName }) => {
		test.skip(browserName === 'webkit', 'The roadmap defers the full WebKit storage workflow until native Blob/OPFS support is qualified.');
		const copy = bundledLightscaperEditorCopyForLocale(locale), messages = photoDevelopCopy(locale), errors = [];
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
		const dialog = named(page, 'dialog', `${messages.title}: ${NAME}`), preview = named(dialog, 'region', messages.preview);
		const history = named(dialog, 'combobox', messages.history), version = named(dialog, 'combobox', messages.version);
		await expect(history).toHaveValue('0'); const versionId = await version.inputValue();
		expect(versionId).toBe(initial.document.activeVersionId);
		await expectPixels(dialog, messages.before, DEHAZE_SOURCE); await expectPixels(dialog, messages.after, DEHAZE_SOURCE);
		await chooseFamily(page, named(dialog, 'combobox', messages.choose), reference.type);
		await keyboard(page, named(dialog, 'button', messages.add));
		await authorDehaze(dialog,messages);
		await expect(preview).toHaveAttribute('data-state', 'ready');
		await expectPixels(dialog, messages.before, DEHAZE_SOURCE); await expectPixels(dialog, messages.after, reference.pixels);
		await expectHistogram(dialog, messages, reference, locale);
		await expect(dialog.getByRole('alert')).toHaveCount(0);
		await keyboard(page, named(dialog, 'button', messages.save));
		await expect(dialog.locator('[data-photo-develop-ack]')).toContainText(messages.acknowledged);
		await settled(); await expect(history).toHaveValue('1'); await expect(version).toHaveValue(versionId);
		await expectPixels(dialog, messages.after, reference.pixels); await close();
		const saved = await backupPhoto(page, app, copy), savedVersion = active(saved.document);
		assertOriginal(saved, initial, 1); expect(savedVersion.id).toBe(versionId);
		expect(savedVersion.develop.effects).toHaveLength(1);
		expect(savedVersion.develop.effects[0]).toMatchObject({ type: reference.type, enabled: true, params: reference.params });
		expect(savedVersion.develop.processVersion).toBe(1);
		expect(savedVersion.develop.geometry).toEqual(active(initial.document).develop.geometry);
		expect(savedVersion.develop.masks).toEqual([]); expect(savedVersion.develop.maskBindings).toEqual([]);
		expect(savedVersion.workspace.cursor).toBe(1); expect(savedVersion.workspace.entries).toHaveLength(2);
		expect(savedVersion.workspace.entries[0].develop).toEqual(active(initial.document).develop);
		expect(savedVersion.workspace.entries[1].develop).toEqual(savedVersion.develop); expect(savedVersion.workspace.snapshots).toEqual([]);
		await page.reload(); await expect(app).toBeVisible(); await expect(library).toHaveCount(0);
		await action(page, app, copy.photoViewMenu, copy.photoShowLibrary);
		await expect(card).toHaveCount(1); await expect(library).toHaveAttribute('aria-busy', 'false');
		await keyboard(page, card); await open();
		await expect(history).toHaveValue('1'); await expect(version).toHaveValue(versionId);
		await expectPixels(dialog, messages.after, reference.pixels); await expectHistogram(dialog, messages, reference, locale);
		for(const[key,value]of Object.entries(reference.params))await expect(parameter(dialog,messages,`videoEffectDehaze${key[0].toUpperCase()}${key.slice(1)}`)).toHaveValue(String(value));
		await chooseHistory(page, history, '0'); await settled(); await expect(history).toHaveValue('0');
		await expectPixels(dialog, messages.after, DEHAZE_SOURCE);
		await expect(named(dialog, 'combobox', messages.history).locator('option')).toHaveCount(2);
		await chooseHistory(page, history, '1'); await settled(); await expect(history).toHaveValue('1');
		await expectPixels(dialog, messages.after, reference.pixels); await expectPixels(dialog, messages.before, DEHAZE_SOURCE);
		await close();
		const restored = await backupPhoto(page, app, copy); assertOriginal(restored, initial, 3);
		expect(active(restored.document)).toEqual(savedVersion);
		expect(errors).toEqual([]);

		async function open() { await action(page, app, copy.photoFileMenu, photoDevelopMenuLabel(locale), copy.photoPhotoMenu);
			await expect(named(page, 'dialog', `${messages.title}: ${NAME}`)).toBeVisible(); }
		async function close() { await keyboard(page, bodyClose(dialog, messages.close)); await expect(dialog).toHaveCount(0); }
		async function settled() { await expect(named(dialog, 'button', messages.cancel)).toBeDisabled(); await expect(library).toHaveAttribute('aria-busy', 'false'); }
	});
}

async function authorDehaze(dialog,messages) {
	const amount=parameter(dialog,messages,'videoEffectDehazeAmount');await number(amount,'37.125');
	await amount.fill('101');await expect(dialog.getByRole('alert')).toHaveText(messages.shared.videoEffectParametersInvalid);
	await amount.press('Escape');await expect(amount).toHaveValue('37.125');await expect(dialog.getByRole('alert')).toHaveCount(0);
	await amount.fill('-50');await amount.press('Escape');await expect(amount).toHaveValue('37.125');
}

function parameter(dialog, messages, key) { return named(dialog, 'spinbutton', `${messages.shared.videoEffectExactValue}: ${messages.shared[key]}`); }
async function number(control, value) { await control.fill(value); await control.press('Enter'); await expect(control).toHaveValue(value); }
async function chooseFamily(page, control, value) {
	const values = await control.locator('option').evaluateAll(options => options.map(option => option.value)), target = values.indexOf(value);
	expect(values).toEqual(['white-balance-v1', 'tone-ladder-v1', 'develop-geometry-v1', 'chroma-v1', 'black-white-mix-v1', 'hsl-mixer-v1',
		'point-curves-v1', 'parametric-curves-v1', 'color-wheels-v1', 'detail-sharpen-v1', 'post-crop-vignette-v1', 'clarity-v1',
		'noise-reduction-v1', 'grain-v1', 'texture-v1', 'dehaze-v1', 'cube-lut-profile-v1']); expect(target).toBeGreaterThanOrEqual(0);
	await control.focus(); await expect(control).toBeFocused(); await page.keyboard.press('Home');
	for (let index = 0; index < target; index++) await page.keyboard.press('ArrowDown');
	await page.keyboard.press('Tab'); await expect(control).toHaveValue(value);
}
async function chooseHistory(page, control, value) {
	const values = await control.locator('option').evaluateAll(options => options.map(option => option.value));
	expect(values).toEqual(['0', '1']);
	const current = values.indexOf(await control.inputValue()), target = values.indexOf(value);
	expect(Math.abs(target - current)).toBe(1);
	await control.focus(); await expect(control).toBeFocused();
	// Exactly one native change starts the one revision-fenced writer; no intermediate history selection is issued.
	await page.keyboard.press(target < current ? 'ArrowUp' : 'ArrowDown');
	await page.keyboard.press('Tab');
}
async function expectPixels(dialog, name, expected) {
	// Acquire a current canvas and capture extent+pixels together; proxy retirement may replace its backing at any await.
	await expect.poll(() => named(dialog, 'img', name).evaluate(canvas => canvas.width !== 2 || canvas.height !== 2 ? null
		: Array.from(canvas.getContext('2d').getImageData(0, 0, 2, 2).data))).toEqual(expected);
}
async function expectHistogram(dialog, messages, reference, locale) {
	// The committed literal green151 bin has two samples; the production SVG
	// shares that maximum across every channel, so exact heights are count/2.
	const histogram = named(dialog, 'img', `${messages.histogram}: ${messages.after}`);
	await expect.poll(() => histogram.evaluate(svg => [...svg.querySelectorAll('polyline')].map(line => ({ channel: line.getAttribute('stroke'),
		bins: line.getAttribute('points').split(' ').flatMap(point => { const [bin, y] = point.split(',').map(Number); return y === 100 ? [] : [[bin, (100 - y) / 100]]; }) })))).toEqual(
		['red', 'green', 'blue'].map(channel => ({ channel, bins: reference.bins[channel].map(([bin,count]) => [bin,count/2]) })));
	const number = new Intl.NumberFormat(locale);
	await expect.poll(() => histogram.evaluate(svg => [...svg.parentElement.querySelectorAll('dl > *')].map(row => row.textContent))).toEqual(
		[messages.samples, number.format(4), messages.low, number.format(reference.low), messages.high, number.format(reference.high)]);
}
async function backupPhoto(page, app, copy) {
	await action(page, app, copy.photoFileMenu, copy.photoBackupTitle);
	const dialog = named(page, 'dialog', copy.photoBackupTitle), pending = page.waitForEvent('download');
	await keyboard(page, named(dialog, 'button', copy.photoBackupSave)); const download = await pending;
	const bytes = await readFile(await download.path());
	await expect(dialog.locator('[data-photo-backup-receipt]')).toContainText(copy.photoBackupDownloadStarted.replace('{name}', download.suggestedFilename()));
	await keyboard(page, bodyClose(dialog, copy.photoBackupClose)); await expect(dialog).toHaveCount(0);
	let photo = null;
	// The actual File backup supplies selected-namespace bytes. This generic decoder authenticates them, not a durable restore.
	await importPhotoCatalogArchiveV5(new Blob([bytes]), async (root, state, presets, luts) => {
		expect(root.photoCount).toBe(1); expect(state).toBeNull(); expect(presets).toBeNull(); expect(luts).toEqual([]);
		return { async writePhoto(document, chunks) { expect(photo).toBeNull(); const parts = []; let length = 0;
			expect(document.schemaVersion).toBe(1);
			for (const version of document.versions) { expect(version.develop.processVersion).toBe(1); if (version.workspace) expect(version.workspace.schemaVersion).toBe(1); }
			for await (const chunk of chunks) { length += chunk.byteLength; expect(length).toBeLessThanOrEqual(PNG.byteLength); parts.push(Buffer.from(chunk)); }
			photo = { document, original: Buffer.concat(parts) };
		}, async writeStack() { throw Error('Unexpected stack.'); }, async writeSavedCollection() { throw Error('Unexpected saved collection.'); },
		async writeDevelopPresets() { throw Error('Unexpected preset.'); }, async writeLut() { throw Error('Unexpected LUT resource.'); },
		async publish() {}, async rollback() { throw Error('Dehaze backup authentication rolled back.'); } };
	});
	expect(photo).not.toBeNull(); return photo;
}
function assertOriginal(actual, initial, revisionDelta) {
	expect(actual.original).toEqual(PNG); expect(actual.original).toEqual(initial.original);
	expect(actual.document.original.contentSha256).toBe(createHash('sha256').update(PNG).digest('hex'));
	expect({ ...actual.document, revision: initial.document.revision, versions: initial.document.versions }).toEqual(initial.document);
	expect(actual.document.revision).toBe(initial.document.revision + revisionDelta);
}
function active(document) { const version = document.versions.find(value => value.id === document.activeVersionId); expect(version).toBeDefined(); return version; }
function named(scope, role, name) { return scope.getByRole(role, { name, exact: true }); }
function bodyClose(scope, name) { return named(scope, 'button', name).filter({ hasText: new RegExp(`^${escape(name)}$`, 'u') }); }
function escape(value) { return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'); }
async function keyboard(page, control) { await expect(control).toBeEnabled(); await control.focus(); await expect(control).toBeFocused(); await page.keyboard.press('Enter'); }
async function action(page, app, menu, name, submenu) {
	await keyboard(page, app.locator('nav > details > summary').filter({ hasText: new RegExp(`^${escape(menu)}$`, 'u') }));
	if (submenu) await keyboard(page, app.locator('summary').filter({ hasText: new RegExp(`^${escape(submenu)}$`, 'u') }));
	await keyboard(page, named(app, 'button', name));
}


syntheticRouteTest('actual native Dehaze33 shader matches independent fractional37.125 hazy2x2 literal bytes',async({page})=>{
	await prepareNative(page);const result=await qualify(page,DEHAZE_SOURCE,2,DEHAZE_PARAMS);
	expect(result.pixels).toEqual(DEHAZE_PIXELS);expect(result.cpuPixels).toEqual(DEHAZE_PIXELS);
	expect(result.dehazeProgramLinked).toBe(true);expect(result.passCodes).toEqual([33]);expect(result.authoredTypes).toEqual(['dehaze-v1']);
	expect(result.nativeWebgl2).toBe(true);expect(result.nativeReadbacks).toBe(1);expect(result.glError).toBe(0);expect(result.source).toEqual(result.before);
	const failed=await qualify(page,DEHAZE_SOURCE,2,DEHAZE_PARAMS,'fault');
	expect(failed.rejectedWithReason).toBe(true);expect(failed.abandonedOutputZero).toBe(true);expect(failed.reasonTraps).toBe(0);
	expect(failed.nativeReadbacks).toBe(1);expect(failed.nativeWebgl2).toBe(true);expect(failed.source).toEqual(DEHAZE_SOURCE);
});

syntheticRouteTest('native Dehaze retains all256alpha and signed fractional atmospheric endpoints against independent dark-channel neighborhoods',async({page})=>{
	await prepareNative(page);const source=Array.from({length:256},(_,n)=>[n,255-n,(n*17)%256,n]).flat();
	for(const amount of [37.125,-37.125,-100,100]){
		const result=await qualify(page,source,16,{amount}),expected=dehazeReferenceV1(source,16,amount);
		expect(result.pixels).toEqual(expected);expect(result.cpuPixels).toEqual(expected);expect(result.dehazeProgramLinked).toBe(true);
		expect(result.pixels.filter((_,n)=>n%4===3)).toEqual(Array.from({length:256},(_,n)=>n));expect(result.pixels.slice(0,4)).toEqual(source.slice(0,4));
		expect(result.nativeWebgl2).toBe(true);expect(result.nativeReadbacks).toBe(1);expect(result.glError).toBe(0);expect(result.source).toEqual(source);
	}
});

syntheticRouteTest('actual persisted mixed Frame Dehaze preserves straight alpha and joins opaque canceled native readback',async({page})=>{
	await prepareNative(page);const source=[64,96,128,0,128,160,192,1,160,160,160,127,224,192,96,255];
	const result=await qualify(page,source,2,DEHAZE_PARAMS,'frame');
	expect(result.pixels).toEqual(dehazeReferenceV1(source,2,DEHAZE_PARAMS.amount));expect(result.authoredTypes).toEqual(['dehaze-v1','color-adjust']);
	expect(result.nativeReadbacks).toBe(1);expect(result.nativeWebgl2).toBe(true);expect(result.source).toEqual(source);
	const canceled=await qualify(page,source,2,DEHAZE_PARAMS,'cancel');
	expect(canceled.rejectedWithReason).toBe(true);expect(canceled.abandonedOutputZero).toBe(true);expect(canceled.reasonTraps).toBe(0);
	expect(canceled.nativeReadbacks).toBe(1);expect(canceled.nativeWebgl2).toBe(true);expect(canceled.source).toEqual(source);
});

async function prepareNative(page){
	const bundle=await build({stdin:{resolveDir:fileURLToPath(new URL('.',ENTRY)),contents:`export {qualifyDehazeNativeV1} from ${JSON.stringify(fileURLToPath(ENTRY))};`},
		bundle:true,write:false,format:'esm',platform:'browser',logLevel:'silent'});
	await page.context().route(`**${MODULE}`,route=>route.fulfill({contentType:'text/javascript',body:bundle.outputFiles[0].text,
		headers:{'Cross-Origin-Embedder-Policy':'require-corp','Cross-Origin-Resource-Policy':'same-origin'}}));
	const origin=process.env.SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS?JSON.parse(process.env.SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS).framescaper:browserProductSiteForBuild('framescaper').origin;
	await page.goto(`${origin}/en/`);
}
async function qualify(page,source,height,params,mode='target'){
	return page.evaluate(async({path,request})=>(await import(new URL(path,location.href).href)).qualifyDehazeNativeV1(request),{path:MODULE,request:{source,height,params,mode}});
}
