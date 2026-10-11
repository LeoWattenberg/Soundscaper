/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { browserProductSiteForBuild } from '../../scripts/lib/browser-product-site-plan.mjs';
import { collectsBrowserCoverage } from '../../scripts/lib/browser-coverage-profile.mjs';
import { bundledLightscaperEditorCopyForLocale } from '../../src/common/i18n/lightscaper-editor-copy.ts';
import { photoDevelopCopy } from '../../src/common/i18n/lightscaper-develop-copy.ts';
import { photoDevelopMenuLabel } from '../../src/common/i18n/lightscaper-develop-menu-copy.ts';
import { createDevelopProxyPngV1, developProxyReferenceFactsV1, developProxyReferenceWitnessesV1 } from './helpers/lightscaper-develop-proxy-reference.ts';
import { expect, test, installNativeImageHandoffRuntime, observeNativePhotoDevelopProxyCustody,
	validateNativePhotoDevelopProxyCanvas } from './helpers/lightscaper-image-handoff-native-fixture.js';

const SERIAL = [75, 25, 100, 75, 125, 50], BURST = [25, 100, 50], AMOUNTS = [25, 50, 75, 100, 125];
const BEFORE = '[data-photo-develop-before]', AFTER = '[data-photo-develop-after]';
const PROTOCOL = Object.freeze({ start: 'trusted-finite-input', end: 'current-ready-plus-one-raf', warmupTrials: 1,
	measuredTrials: 5, workers: 1, retries: 0, caseDeadlineMs: 90_000, p95Method: 'nearest-rank-per-locale-then-worst' });

for (const locale of ['en', 'de']) test(`${locale}: real Develop proxy inputs preserve current ordered spatial pixels and emit an unthresholded latency baseline`, async ({ page, browser, browserName }) => {
	test.skip(browserName === 'webkit', 'The roadmap defers the full native WebKit storage workflow.');
	const instrumentation = collectsBrowserCoverage(browserName) ? 'v8-browser' : 'none';
	const protocol = Object.freeze({ ...PROTOCOL, caseDeadlineMs: instrumentation === 'v8-browser' ? 180_000 : PROTOCOL.caseDeadlineMs });
	test.setTimeout(protocol.caseDeadlineMs);
	expect(test.info().config.workers).toBe(1); expect(test.info().retry).toBe(0);
	const fixture = await createDevelopProxyPngV1(), copy = bundledLightscaperEditorCopyForLocale(locale), words = photoDevelopCopy(locale);
	const errors = [], canvasChecks = []; page.on('pageerror', error => { errors.push(error.message); });
	const references = Object.fromEntries(['before', 'dehaze', ...AMOUNTS].map(stage => [stage, developProxyReferenceFactsV1(stage)]));
	const witnesses = Object.fromEntries(['before', 'dehaze', ...AMOUNTS].map(stage => [stage, developProxyReferenceWitnessesV1(stage)]));
	const raw = { schemaVersion: 1, profile: 'deterministic-photo-develop-proxy-spatial-v1', workloadId: 'l4-photo-develop-proxy-spatial',
		fixtureId: 'lightscaper-develop-proxy-spatial-4096x3072-v1', locale, environmentId: process.env.LIGHTSCAPER_L4_OBSERVED_ENVIRONMENT_ID ?? 'local-runtime-diagnostics',
		browser: { name: browserName, version: browser.version() }, rendererClass: 'unknown',
		instrumentation, runtime: null, protocol,
		fixture: { width: fixture.width, height: fixture.height, proxyWidth: 2048, proxyHeight: 1536, sourceRgbaByteLength: 50_331_648,
			proxyRgbaByteLength: 12_582_912, pngSrgbIntent: 0, encodedByteLength: fixture.byteLength, encodedSha256: fixture.contentSha256,
			sourceRgbaSha256: fixture.rgbaSha256, proxyRgbaSha256: references.before.rgbaSha256, dehazeRgbaSha256: references.dehaze.rgbaSha256,
			goldens: AMOUNTS.map(amount => ({ amount, afterSha256: references[amount].rgbaSha256 })) },
		observations: { coldOpen: null, beforeActualSha256: null, beforePixelMismatchCount: null, initialAfterActualSha256: null,
			initialAfterPixelMismatchCount: null, serialTrials: [], burstTrials: [], close: null, custody: null } };
	let completed = false;
	try {
		expect(fixture.width).toBe(4096); expect(fixture.height).toBe(3072); expect(fixture.byteLength).toBe(fixture.bytes.byteLength);
		expect(fixture.byteLength).toBeLessThanOrEqual(64 * 1024 * 1024); expect(sha(fixture.bytes)).toBe(fixture.contentSha256);
		await installNativeImageHandoffRuntime(page);
		const origin = process.env.SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS ? JSON.parse(process.env.SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS).lightscaper : browserProductSiteForBuild('lightscaper').origin;
		await page.goto(`${origin}/${locale}/`); const app = page.locator('[data-lightscaper-bound="true"]'); await expect(app).toBeVisible();
		raw.runtime = await page.evaluate(() => ({ platform: navigator.platform, userAgent: navigator.userAgent,
			hardwareConcurrency: navigator.hardwareConcurrency, deviceMemoryGiB: typeof navigator.deviceMemory === 'number' ? navigator.deviceMemory : null,
			viewportWidth: innerWidth, viewportHeight: innerHeight, deviceScaleFactor: devicePixelRatio, decodePath: 'unknown' }));
		await action(page, app, copy.photoFileMenu, copy.photoImportPhotos);
		const importer = named(page, 'dialog', copy.photoImportPhotos);
		await importer.getByLabel(copy.photoChooseFiles, { exact: true }).setInputFiles({ name: fixture.fileName, mimeType: 'image/png', buffer: Buffer.from(fixture.bytes) });
		await keyboard(page, named(importer, 'button', copy.photoImportAction)); await importer.waitFor({ state: 'detached', timeout: 0 });
		const library = app.locator('[data-photo-library]'), card = library.locator('[data-photo-id]');
		await expect(card).toHaveCount(1); await expect(library).toHaveAttribute('aria-busy', 'false');
		const photoId = await card.getAttribute('data-photo-id'); expect(photoId).not.toBeNull();
		const initial = await observeNativePhotoDevelopProxyCustody(page, photoId);
		assertOriginal(initial, fixture); await keyboard(page, card);
		await action(page, app, copy.photoFileMenu, photoDevelopMenuLabel(locale), copy.photoPhotoMenu, false);
		await armColdOpen(page, photoDevelopMenuLabel(locale), words, witnesses.before);
		await keyboard(page, named(app, 'button', photoDevelopMenuLabel(locale)));
		const dialog = named(page, 'dialog', `${words.title}: ${fixture.fileName}`);
		await expect(dialog).toBeVisible();
		await page.waitForFunction(() => Number.isFinite(globalThis.__developProxyCold?.presentedAtMs), null, { timeout: 0 });
		raw.observations.coldOpen = await page.evaluate(() => globalThis.__developProxyCold.result());
		const before = await validate('before', BEFORE), neutral = await validate('before');
		raw.observations.beforeActualSha256 = before.actualRgbaSha256; raw.observations.beforePixelMismatchCount = before.mismatchCount;
		expect(neutral.actualRgbaSha256).toBe(before.actualRgbaSha256);
		const history = named(dialog, 'combobox', words.history), version = named(dialog, 'combobox', words.version);
		await expect(history).toHaveValue('0'); const versionId = await version.inputValue(); expect(versionId).toBe(initial.photo.activeVersionId);
		await choose(page, named(dialog, 'combobox', words.choose), 'dehaze-v1'); await keyboard(page, named(dialog, 'button', words.add));
		const dehaze = parameter(dialog, words, 'videoEffectDehazeAmount'); await dehaze.fill('37.125'); await dehaze.press('Enter');
		await ready('dehaze'); await validate('dehaze');
		await choose(page, named(dialog, 'combobox', words.choose), 'detail-sharpen-v1'); await keyboard(page, named(dialog, 'button', words.add));
		const amount = parameter(dialog, words, 'videoEffectDetailSharpenAmount'); await amount.fill('50'); await amount.press('Enter');
		await ready(50); const first = await validate(50);
		raw.observations.initialAfterActualSha256 = first.actualRgbaSha256; raw.observations.initialAfterPixelMismatchCount = first.mismatchCount;
		await expect(parameter(dialog, words, 'videoEffectDetailSharpenThreshold')).toHaveValue('0');
		await installInputTiming(page, dialog, words, witnesses);
		for (const [trial, value] of SERIAL.entries()) {
			const input = await edit(value); await endpoint(input.inputSequence);
			const timing = await inputRecord(input.inputSequence), checked = await validate(value);
			raw.observations.serialTrials.push({ trial, amount: value, inputSequence: timing.inputSequence, inputTrusted: timing.inputTrusted,
				inputAtMs: timing.inputAtMs, readyAtMs: timing.readyAtMs, presentedAtMs: timing.presentedAtMs,
				pendingObserved: timing.pendingObserved, actualAmount: Number(await amount.inputValue()),
				expectedAfterSha256: checked.expectedRgbaSha256, actualAfterSha256: checked.actualRgbaSha256, pixelMismatchCount: checked.mismatchCount });
			assertTiming(timing); await expect(amount).toHaveValue(String(value));
		}
		for (let trial = 0; trial < 6; trial++) {
			const inputs = [];
			for (const value of BURST) { const input = await edit(value); inputs.push(input);
				if (value === 25) await page.waitForFunction(() => globalThis.__developProxyTiming.region.getAttribute('data-state') === 'pending', null, { timeout: 0 }); }
			const final = inputs[2]; await endpoint(final.inputSequence); const timing = await inputRecord(final.inputSequence), checked = await validate(50);
			const earlierWorkPending = inputs.slice(1).map(input => input.priorState === 'pending');
			raw.observations.burstTrials.push({ trial, inputs: inputs.map(input => ({ amount: input.amount, inputSequence: input.inputSequence,
				inputTrusted: input.inputTrusted, inputAtMs: input.inputAtMs })), earlierWorkPending, pendingObserved: timing.pendingObserved,
				readyAtMs: timing.readyAtMs, presentedAtMs: timing.presentedAtMs, actualAmount: Number(await amount.inputValue()),
				expectedAfterSha256: checked.expectedRgbaSha256, actualAfterSha256: checked.actualRgbaSha256, pixelMismatchCount: checked.mismatchCount });
			expect(earlierWorkPending).toEqual([true, true]); assertTiming(timing); await expect(amount).toHaveValue('50');
		}
		await validate('before', BEFORE); await expect(history).toHaveValue('0'); await expect(dialog.getByRole('alert')).toHaveCount(0);
		await keyboard(page, named(dialog, 'button', words.save));
		await expect(dialog.locator('[data-photo-develop-ack]')).toContainText(words.acknowledged);
		await expect(named(dialog, 'button', words.cancel)).toBeDisabled(); await expect(library).toHaveAttribute('aria-busy', 'false');
		await expect(history).toHaveValue('1'); await expect(version).toHaveValue(versionId); await ready(50); await validate(50);
		const saved = await observeNativePhotoDevelopProxyCustody(page, photoId); assertOriginal(saved, fixture);
		expect(saved.original).toEqual(initial.original); expect(saved.namespace).toBe(initial.namespace);
		assertSaved(initial.photo, saved.photo, versionId);
		await armRetirement(page, words); await edit(75);
		await page.waitForFunction(() => globalThis.__developProxyTiming.region.getAttribute('data-state') === 'pending', null, { timeout: 0 });
		await keyboard(page, named(dialog.locator('.lightscaper-develop-actions'), 'button', words.close)); await expect(dialog).toHaveCount(0);
		await open(); await ready(50); const reopened = await validate(50), retirement = await page.evaluate(() => globalThis.__developProxyRetirement.result());
		raw.observations.close = { pendingObserved: retirement.pendingObserved, closedWithoutLatePublication: retirement.closedWithoutLatePublication,
			expectedAfterSha256: reopened.expectedRgbaSha256, actualAfterSha256: reopened.actualRgbaSha256, pixelMismatchCount: reopened.mismatchCount };
		expect(retirement.pendingObserved).toBe(true); expect(retirement.closedWithoutLatePublication).toBe(true);
		await expect(amount).toHaveValue('50'); await expect(history).toHaveValue('1');
		await close(); expect(await observeNativePhotoDevelopProxyCustody(page, photoId)).toEqual(saved);
		await page.reload(); await expect(app).toBeVisible(); await expect(library).toHaveCount(0);
		await action(page, app, copy.photoViewMenu, copy.photoShowLibrary); await expect(card).toHaveCount(1); await keyboard(page, card);
		await open(); await ready(50); await validate(50); await validate('before', BEFORE);
		await expect(amount).toHaveValue('50'); await expect(dehaze).toHaveValue('37.125'); await expect(history).toHaveValue('1'); await expect(version).toHaveValue(versionId);
		const reloaded = await observeNativePhotoDevelopProxyCustody(page, photoId); expect(reloaded).toEqual(saved);
		raw.observations.custody = { beforeSha256: initial.original.sha256, afterSaveSha256: saved.original.sha256, afterReloadSha256: reloaded.original.sha256,
			savedRecipe: recipe(saved.photo), reloadedRecipe: recipe(reloaded.photo) };
		await expect(dialog.getByRole('alert')).toHaveCount(0); await close(); expect(errors).toEqual([]); completed = true;
		console.log(`LIGHTSCAPER_DEVELOP_PROXY_DIAGNOSTIC ${JSON.stringify(raw)}`);

		async function ready(stage) {
			await page.waitForFunction(({ label, pixels }) => {
				const region = document.querySelector('[data-photo-develop-preview]'), canvas = document.querySelector('[data-photo-develop-after]');
				if (region?.getAttribute('aria-label') !== label || region.getAttribute('data-state') !== 'ready' || canvas?.width !== 2048 || canvas.height !== 1536) return false;
				const context = canvas.getContext('2d'); return pixels.every(({ x, y, rgba }) => context.getImageData(x, y, 1, 1).data.every((value, index) => value === rgba[index]));
			}, { label: words.preview, pixels: witnesses[stage] }, { timeout: 0 });
			await page.evaluate(() => new Promise(resolve => { requestAnimationFrame(() => resolve()); }));
		}
		async function validate(stage, selector = AFTER) {
			const checked = await validateNativePhotoDevelopProxyCanvas(page, selector, stage), expected = references[stage];
			canvasChecks.push({ stage, selector, ...checked });
			expect(checked.mismatchCount).toBe(0); expect(checked.maximumChannelError).toBe(0); expect(checked.firstMismatch).toBeNull();
			expect([checked.width, checked.height, checked.byteLength]).toEqual([2048, 1536, 12_582_912]);
			expect(checked.actualRgbaSha256).toBe(expected.rgbaSha256); expect(checked.expectedRgbaSha256).toBe(expected.rgbaSha256);
			expect(checked.histogram).toEqual(expected.histogram); await histogram(dialog, words, locale, selector === BEFORE ? words.before : words.after, expected.histogram);
			return checked;
		}
		async function edit(value) {
			const prior = await page.evaluate(() => globalThis.__developProxyTiming.records.length); await amount.fill(String(value)); await amount.press('Enter');
			const record = await page.evaluate(() => globalThis.__developProxyTiming.records.at(-1));
			expect(record.inputSequence).toBe(prior + 1); expect(record.amount).toBe(value); expect(record.inputTrusted).toBe(true); return record;
		}
		async function endpoint(sequence) { await page.waitForFunction(sequence => Number.isFinite(globalThis.__developProxyTiming.records[sequence - 1]?.presentedAtMs),
			sequence, { timeout: 0 }); }
		async function inputRecord(sequence) { return page.evaluate(sequence => ({ ...globalThis.__developProxyTiming.records[sequence - 1] }), sequence); }
		async function open() { await action(page, app, copy.photoFileMenu, photoDevelopMenuLabel(locale), copy.photoPhotoMenu); await expect(dialog).toBeVisible(); }
		async function close() { await keyboard(page, named(dialog.locator('.lightscaper-develop-actions'), 'button', words.close)); await expect(dialog).toHaveCount(0); }
	} finally {
		await test.info().attach(completed ? `develop-proxy-baseline-${locale}` : `develop-proxy-partial-${locale}`,
			{ body: JSON.stringify({ completed, diagnostic: raw, canvasChecks, pageErrors: errors }), contentType: 'application/json' });
		fixture.bytes.fill(0);
	}
});

async function armColdOpen(page, menuLabel, words, pixels) {
	await page.evaluate(({ menuLabel, words, pixels }) => {
		const cold = { inputAtMs: null, readyAtMs: null, presentedAtMs: null, scheduled: false };
		const match = () => { const region = document.querySelector('[data-photo-develop-preview]'), canvas = document.querySelector('[data-photo-develop-after]');
			return region?.getAttribute('aria-label') === words.preview && region.getAttribute('data-state') === 'ready' && canvas?.width === 2048 && canvas.height === 1536
				&& pixels.every(({ x, y, rgba }) => canvas.getContext('2d').getImageData(x, y, 1, 1).data.every((value, index) => value === rgba[index])); };
		const observer = new MutationObserver(() => {
			if (cold.inputAtMs === null || cold.scheduled || !match()) return;
			cold.scheduled = true; cold.readyAtMs = performance.now(); requestAnimationFrame(() => {
				if (!match()) { cold.scheduled = false; return; } cold.presentedAtMs = performance.now(); observer.disconnect();
			});
		});
		observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-state', 'width', 'height'] });
		document.addEventListener('click', function start(event) {
			if (!(event.target instanceof Element) || event.target.closest('button')?.textContent.trim() !== menuLabel) return;
			if (!event.isTrusted) throw new Error('Develop cold open requires a native user gesture.');
			cold.inputAtMs = performance.now(); document.removeEventListener('click', start, true);
		}, true);
		globalThis.__developProxyCold = { ...cold, get presentedAtMs() { return cold.presentedAtMs; }, result: () => ({ inputAtMs: cold.inputAtMs, readyAtMs: cold.readyAtMs, presentedAtMs: cold.presentedAtMs }) };
	}, { menuLabel, words: { preview: words.preview }, pixels });
}

async function installInputTiming(page, dialog, words, witnesses) {
	const input = await parameter(dialog, words, 'videoEffectDetailSharpenAmount').elementHandle();
	const region = await named(dialog, 'region', words.preview).elementHandle();
	await page.evaluate(({ input, region, witnesses }) => {
		if (!(input instanceof HTMLInputElement) || !(region instanceof HTMLElement)) throw new Error('The actual Sharpen input or Develop preview is unavailable.');
		const canvas = region.querySelector('[data-photo-develop-after]'), state = { region, records: [], active: null };
		const matches = record => region.getAttribute('data-state') === 'ready' && input.valueAsNumber === record.amount && canvas.width === 2048 && canvas.height === 1536
			&& witnesses[record.amount].every(({ x, y, rgba }) => canvas.getContext('2d').getImageData(x, y, 1, 1).data.every((value, index) => value === rgba[index]));
		input.addEventListener('input', event => {
			if (!Number.isFinite(input.valueAsNumber) || !Object.hasOwn(witnesses, input.valueAsNumber) || state.records.length >= 64) throw new Error('Unexpected Develop numeric input.');
			const record = { inputSequence: state.records.length + 1, amount: input.valueAsNumber, inputTrusted: event.isTrusted,
				inputAtMs: performance.now(), priorState: region.getAttribute('data-state'), pendingObserved: false, readyAtMs: null, presentedAtMs: null };
			state.records.push(record); state.active = record;
		}, true);
		new MutationObserver(mutations => {
			const record = state.active; if (!record || record.presentedAtMs !== null) return;
			if (region.getAttribute('data-state') === 'pending' || mutations.some(mutation => mutation.attributeName === 'data-state' && mutation.oldValue === 'pending')) record.pendingObserved = true;
			if (!record.pendingObserved || record.readyAtMs !== null || !matches(record)) return;
			record.readyAtMs = performance.now(); requestAnimationFrame(() => {
				if (state.active !== record || !matches(record)) return; record.presentedAtMs = performance.now();
			});
		}).observe(region, { subtree: true, attributes: true, attributeOldValue: true, attributeFilter: ['data-state', 'width', 'height'] });
		globalThis.__developProxyTiming = state;
	}, { input, region, witnesses });
}

async function armRetirement(page, words) {
	await page.evaluate(closeLabel => {
		const region = document.querySelector('[data-photo-develop-preview]'), canvases = [...region.querySelectorAll('canvas')];
		const close = [...document.querySelectorAll('.lightscaper-develop-actions button')].find(button => button.textContent.trim() === closeLabel);
		let closed = false, pendingObserved = false, latePublications = 0;
		close.addEventListener('click', event => { if (!event.isTrusted) throw new Error('Develop close requires a native user gesture.');
			pendingObserved = region.getAttribute('data-state') === 'pending'; closed = true; }, true);
		new MutationObserver(() => { if (closed && (region.getAttribute('data-state') === 'ready' || canvases.some(canvas => canvas.width !== 0 || canvas.height !== 0))) latePublications++; })
			.observe(region, { subtree: true, attributes: true, attributeFilter: ['data-state', 'width', 'height'] });
		globalThis.__developProxyRetirement = { result: () => ({ pendingObserved,
			closedWithoutLatePublication: closed && !region.isConnected && latePublications === 0 && canvases.every(canvas => canvas.width === 0 && canvas.height === 0) }) };
	}, words.close);
}

async function histogram(dialog, words, locale, label, expected) {
	const value = named(dialog, 'img', `${words.histogram}: ${label}`), maximum = Math.max(1, ...expected.bins.red, ...expected.bins.green, ...expected.bins.blue);
	expect(await value.evaluate(svg => [...svg.querySelectorAll('polyline')].map(line => ({ channel: line.getAttribute('stroke'), points: line.getAttribute('points') }))))
		.toEqual(['red', 'green', 'blue'].map(channel => ({ channel, points: expected.bins[channel].map((count, index) => `${index},${100 - count / maximum * 100}`).join(' ') })));
	const number = new Intl.NumberFormat(locale);
	expect(await value.evaluate(svg => [...svg.parentElement.querySelectorAll('dl > *')].map(node => node.textContent)))
		.toEqual([words.samples, number.format(expected.sampledPixels), words.low, number.format(expected.lowClippedPixels), words.high, number.format(expected.highClippedPixels)]);
}
function assertTiming(record) {
	expect(record.inputTrusted).toBe(true); expect(record.pendingObserved).toBe(true);
	for (const key of ['inputAtMs', 'readyAtMs', 'presentedAtMs']) { expect(Number.isFinite(record[key])).toBe(true); expect(record[key]).toBeGreaterThanOrEqual(0); }
	expect(record.readyAtMs).toBeGreaterThanOrEqual(record.inputAtMs); expect(record.presentedAtMs).toBeGreaterThanOrEqual(record.readyAtMs);
}
function assertOriginal(snapshot, fixture) {
	expect(snapshot.original.sha256).toBe(fixture.contentSha256); expect(snapshot.original.byteLength).toBe(fixture.byteLength);
	expect(snapshot.photo.original.contentSha256).toBe(fixture.contentSha256); expect(snapshot.photo.original.byteLength).toBe(fixture.byteLength);
	expect([snapshot.photo.original.width, snapshot.photo.original.height]).toEqual([4096, 3072]);
}
function assertSaved(initial, saved, versionId) {
	expect({ ...saved, revision: initial.revision, versions: initial.versions }).toEqual(initial); expect(saved.revision).toBe(initial.revision + 1);
	const before = initial.versions.find(version => version.id === versionId), current = saved.versions.find(version => version.id === versionId);
	expect(current.develop.effects.map(effect => effect.type)).toEqual(['dehaze-v1', 'detail-sharpen-v1']);
	expect(current.develop.effects.map(effect => ({ type: effect.type, enabled: effect.enabled, params: effect.params })))
		.toEqual([{ type: 'dehaze-v1', enabled: true, params: { amount: 37.125 } }, { type: 'detail-sharpen-v1', enabled: true, params: { amount: 50, threshold: 0 } }]);
	expect(current.develop.processVersion).toBe(1); expect(current.develop.geometry).toEqual(before.develop.geometry);
	expect(current.develop.masks).toEqual([]); expect(current.develop.maskBindings).toEqual([]);
	expect(current.workspace.cursor).toBe(1); expect(current.workspace.entries).toHaveLength(2);
	expect(current.workspace.entries[0].develop).toEqual(before.develop); expect(current.workspace.entries[1].develop).toEqual(current.develop);
	expect(current.workspace.snapshots).toEqual([]);
}
function recipe(photo) {
	const value = photo.versions.find(version => version.id === photo.activeVersionId).develop;
	return { processVersion: value.processVersion, maskCount: value.masks.length, dehazeAmount: value.effects[0].params.amount,
		sharpenAmount: value.effects[1].params.amount, sharpenThreshold: value.effects[1].params.threshold, stageOrder: value.effects.map(effect => effect.type) };
}
function sha(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
function exact(words, key) { return `${words.shared.videoEffectExactValue}: ${words.shared[key]}`; }
function parameter(dialog, words, key) {
	const adjustment = key === 'videoEffectDehazeAmount' ? words.shared.videoEffectDehaze : words.shared.videoEffectDetailSharpen;
	return named(named(dialog, 'group', adjustment), 'spinbutton', exact(words, key));
}
function named(scope, role, name) { return scope.getByRole(role, { name, exact: true }); }
async function keyboard(page, control) { await expect(control).toBeEnabled(); await control.focus(); await expect(control).toBeFocused(); await page.keyboard.press('Enter'); }
async function action(page, app, menu, name, submenu, click = true) {
	await keyboard(page, app.getByRole('navigation').getByText(menu, { exact: true }));
	if (submenu) await keyboard(page, app.getByRole('navigation').getByText(submenu, { exact: true })); if (click) await keyboard(page, named(app, 'button', name));
}
async function choose(page, control, value) {
	const values = await control.locator('option').evaluateAll(options => options.map(option => option.value)), target = values.indexOf(value);
	expect(target).toBeGreaterThanOrEqual(0); expect(values.length).toBeLessThanOrEqual(64); await control.focus(); await expect(control).toBeFocused();
	await page.keyboard.press('Home'); for (let index = 0; index < target; index++) await page.keyboard.press('ArrowDown');
	await page.keyboard.press('Tab'); await expect(control).toHaveValue(value);
}
