/* SPDX-License-Identifier: AGPL-3.0-only */

import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { browserProductSiteForBuild } from '../../scripts/lib/browser-product-site-plan.mjs';
import { createPendingLightscaperLargeLibraryResult } from '../../scripts/lib/lightscaper-large-library-diagnostics-v1.ts';
import { PHOTO_LARGE_LIBRARY_SPECIFICATION_V1 as SPEC, PHOTO_LARGE_LIBRARY_PNG_BASE64_V1 } from '../../src/lightscaper/quality/large-library-workload-v1.ts';
import { observeLargePhotoLibrarySeedConsoleV1 } from '../helpers/lightscaper-large-library-seed-diagnostic.ts';
import { expect, test } from './helpers/browser-coverage-fixture.js';
import { watchNativeOpfsWorkerExecution, assertNativeOpfsWorkerExecution } from './helpers/native-opfs-worker-companion.ts';

test.use({ browserCoverage: false });
const ROOT = '/__lightscaper_large_library_native__';
const ENABLED = process.env.LIGHTSCAPER_L3_LARGE_LIBRARY_DIAGNOSTIC === '1';

test('the pinned 20000-photo library measures menu import, scrolling, filtering and distant search', async ({ page, browserName, browser }) => {
	test.skip(!ENABLED, 'Opt in with LIGHTSCAPER_L3_LARGE_LIBRARY_DIAGNOSTIC=1; hosted diagnostics run this workload.');
	test.skip(browserName === 'webkit', 'WebKit Blob/OPFS catalog custody is deferred.');
	test.setTimeout(360_000);
	const phaseStarted = performance.now(); let phaseRecords = 0;
	function phase(name, event, trial = null, durationMs = null) {
		if (++phaseRecords > 64) throw new RangeError('Library phase diagnostics exceed their record bound.');
		const line = JSON.stringify({ kind: 'lightscaper-library-phase-v1', schemaVersion: 1, phase: name, event, trial,
			elapsedSinceTestStartMs: performance.now() - phaseStarted, durationMs });
		if (Buffer.byteLength(line) > 512) throw new RangeError('Library phase diagnostic exceeds its byte bound.');
		console.log(line);
	}
	const errors = [];
	page.on('pageerror', error => { errors.push(error.message); });
	page.on('console', message => {
		try {
			observeLargePhotoLibrarySeedConsoleV1(message.text(), line => {
				if (++phaseRecords > 64) throw new RangeError('Library phase diagnostics exceed their record bound.');
				console.log(line);
			});
		} catch (error) { errors.push(String(error)); }
	});
	await setup(page);
	const app = page.locator('[data-lightscaper-bound="true"]');
	await expect(app).toBeVisible(); await expect(app.locator('[data-photo-library]')).toHaveCount(0);
	phase('seed', 'begin');
	const fixture = await native(page, 'seedLargePhotoLibraryNativeV1');
	phase('seed', 'end', null, fixture.setupDurationMs);
	await menu('View', 'Show photo library');
	const library = app.getByRole('region', { name: 'Photo library', exact: true });
	await expect(library.locator('[data-photo-count]')).toHaveAttribute('data-photo-count', '20000');
	await expect(library.locator('[data-photo-id]')).toHaveCount(64);
	const importTrials = [], scrollTrials = [], filterTrials = [], searchTrials = [];
	for (let trial = 0; trial < 6; trial++) {
		phase('import', 'begin', trial);
		await menu('File', 'Import photos');
		const dialog = page.getByRole('dialog', { name: 'Import photos', exact: true });
		await dialog.getByLabel('Choose photos', { exact: true }).setInputFiles(Array.from({ length: 64 }, (_, index) => ({
			name: `Measured-${trial}-${String(index).padStart(2, '0')}.png`, mimeType: 'image/png', buffer: Buffer.from(PHOTO_LARGE_LIBRARY_PNG_BASE64_V1, 'base64'),
		})));
		const beforeCount = Number(await library.locator('[data-photo-count]').getAttribute('data-photo-count'));
		const started = await page.evaluate(() => performance.now());
		await dialog.getByRole('button', { name: 'Import', exact: true }).focus(); await page.keyboard.press('Enter');
		await expect(dialog).toHaveCount(0, { timeout: 30_000 }); await expect(library).toHaveAttribute('aria-busy', 'false');
		const elapsedMs = await page.evaluate(() => performance.now()) - started;
		const afterCount = Number(await library.locator('[data-photo-count]').getAttribute('data-photo-count'));
		const importedCount = await library.locator('[data-photo-import-status="imported"]').count();
		importTrials.push({ trial, elapsedMs, beforeCount, afterCount, importedCount });
		phase('import', 'end', trial, elapsedMs);
		expect(importedCount).toBe(64); expect(afterCount).toBe(beforeCount + 64);
	}
	phase('scroll', 'begin');
	for (let trial = 0; trial < 6; trial++) {
		const sample = await page.evaluate(async () => {
			let scroller = document.querySelector('[data-photo-library] .lightscaper-photo-grid');
			for (let depth = 0; scroller && depth < 64; depth++, scroller = scroller.parentElement) {
				if (/^(auto|scroll)$/u.test(getComputedStyle(scroller).overflowY) && scroller.scrollHeight > scroller.clientHeight) break;
			}
			if (!scroller) throw new Error('The rendered photo grid has no scrolling owner.');
			const maximum = scroller.scrollHeight - scroller.clientHeight;
			if (maximum <= 0) throw new Error('The rendered photo grid has no scroll range.');
			const frameIntervalsMs = [];
			let previous = await new Promise(resolve => { requestAnimationFrame(resolve); });
			let scrollDistancePx = 0;
			for (let index = 0; index < 32; index++) {
				const before = scroller.scrollTop;
				scroller.scrollTo({ top: index % 2 === 0 ? maximum : 0, behavior: 'instant' });
				const now = await new Promise(resolve => { requestAnimationFrame(resolve); });
				scrollDistancePx += Math.abs(scroller.scrollTop - before); frameIntervalsMs.push(now - previous); previous = now;
			}
			return { frameIntervalsMs, scrollDistancePx, renderedPhotoCount: document.querySelectorAll('[data-photo-library] [data-photo-id]').length };
		});
		scrollTrials.push({ trial, ...sample });
	}
	phase('scroll', 'end');
	const queryDialog = page.getByRole('dialog', { name: 'Search, filter and sort', exact: true });
	for (let trial = 0; trial < 6; trial++) {
		phase('filter', 'begin', trial);
		await menu('View', 'Search, filter and sort');
		await queryDialog.getByLabel('Search text', { exact: true }).fill('');
		await queryDialog.getByRole('combobox', { name: 'Filter', exact: true }).selectOption('keyword');
		await queryDialog.locator('[data-definition-choose="landscape"]').click();
		filterTrials.push({ trial, ...(await applyQuery()), resultFirstPhotoId: await library.locator('[data-photo-id]').first().getAttribute('data-photo-id'),
			resultCount: await library.locator('[data-photo-id]').count() });
		phase('filter', 'end', trial, filterTrials[filterTrials.length - 1].elapsedMs);
		await closeQuery();
	}
	for (let trial = 0; trial < 6; trial++) {
		phase('search', 'begin', trial);
		await menu('View', 'Search, filter and sort');
		await queryDialog.getByRole('combobox', { name: 'Filter', exact: true }).selectOption('');
		await queryDialog.getByLabel('Search text', { exact: true }).fill(SPEC.sparseSearchText);
		if (trial === 0) await native(page, 'startLargePhotoLibraryQueryTransactionObservationV1');
		try {
			searchTrials.push({ trial, ...(await applyQuery(trial === 0)), resultPhotoId: await library.locator('[data-photo-id]').first().getAttribute('data-photo-id'),
				resultCount: await library.locator('[data-photo-id]').count() });
		} finally {
			if (trial === 0) await finishQueryObservation();
		}
		phase('search', 'end', trial, searchTrials[searchTrials.length - 1].elapsedMs);
		await closeQuery();
	}
	phase('observe-query', 'begin');
	const query = await native(page, 'observeLargePhotoLibraryQueryNativeV1');
	phase('observe-query', 'end', null, query.durationMs);
	phase('observe-original', 'begin');
	const original = await native(page, 'observeLargePhotoLibraryOriginalNativeV1');
	phase('observe-original', 'end');
	expect(errors).toEqual([]);
	const diagnostic = { schemaVersion: 1, profile: 'deterministic-photo-library-20000-v1', workloadId: 'l3-photo-library-large',
		fixtureId: SPEC.id, fixture: SPEC, environmentId: process.env.LIGHTSCAPER_L3_OBSERVED_ENVIRONMENT_ID ?? 'local-runtime-diagnostics',
		browser: { name: browserName, version: browser.version() }, rendererClass: 'browser-2d', observations: {
			fixture: { photoCount: fixture.photoCount, maximumPublishedBatchPhotos: fixture.maximumPublishedBatchPhotos,
				sourceByteLength: original.sourceByteLength, originalActualSha256: original.originalActualSha256 },
			importTrials, scrollTrials, filterTrials, searchTrials,
			query: { maximumCandidatePhotos: query.maximumCandidatePhotos, steps: query.steps, matches: query.matches, resultId: query.resultId },
		} };
	console.log(JSON.stringify(diagnostic));
	const budget = JSON.parse(await readFile(new URL('../../config/quality-budgets.json', import.meta.url), 'utf8'));
	expect(createPendingLightscaperLargeLibraryResult(diagnostic, budget).metricGatePassed).toBe(true);

	async function menu(name, action) {
		await app.locator('summary').filter({ hasText: new RegExp(`^${name}$`, 'u') }).focus(); await page.keyboard.press('Enter');
		await app.getByRole('button', { name: action, exact: true }).focus(); await page.keyboard.press('Enter');
	}
	async function applyQuery(observeFailure = false) {
		const action = queryDialog.getByRole('button', { name: 'Apply query', exact: true });
		await expect(action).toBeEnabled(); await action.focus();
		const started = await page.evaluate(() => performance.now()); await page.keyboard.press('Enter');
		try { await expect(library).toHaveAttribute('aria-busy', 'false'); }
		catch (error) {
			if (observeFailure) {
				try {
					const state = await library.evaluate(element => ({ busy: element.getAttribute('aria-busy') === 'true',
						renderedPhotoCount: element.querySelectorAll('[data-photo-id]').length }));
					const line = JSON.stringify({ kind: 'lightscaper-library-search-state-v1', schemaVersion: 1,
						elapsedSinceTestStartMs: performance.now() - phaseStarted, ...state });
					if (++phaseRecords > 64 || Buffer.byteLength(line) > 512) throw new RangeError('Library search state exceeds its diagnostic bound.', { cause: error });
					console.log(line);
				} catch (diagnosticError) { errors.push(String(diagnosticError)); }
			}
			throw error;
		}
		await expect(queryDialog.getByRole('alert')).toHaveCount(0);
		return { elapsedMs: await page.evaluate(() => performance.now()) - started };
	}
	async function closeQuery() { await queryDialog.locator('[data-query-close]').focus(); await page.keyboard.press('Enter'); await expect(queryDialog).toHaveCount(0); }
	async function finishQueryObservation() {
		try {
			const state = await native(page, 'finishLargePhotoLibraryQueryTransactionObservationV1');
			const line = JSON.stringify({ kind: 'lightscaper-library-query-transaction-state-v1', schemaVersion: 1, ...state });
			if (++phaseRecords > 64 || Buffer.byteLength(line) > 512) throw new RangeError('Query transaction observation exceeds its diagnostic bound.');
			console.log(line);
		} catch (diagnosticError) { errors.push(String(diagnosticError)); }
	}
});

async function native(page, method) {
	const result = await page.evaluate(async ({ root, method }) => (await import(new URL(`${root}/entry.js`, location.href).href))[method](), { root: ROOT, method });
	await assertNativeOpfsWorkerExecution(page); return result;
}

async function setup(page) {
	watchNativeOpfsWorkerExecution(page);
	const [bundle, worker] = await Promise.all([
		build({ entryPoints: [fileURLToPath(new URL('../helpers/lightscaper-large-library-native-fixture.ts', import.meta.url))],
			bundle: true, write: false, format: 'esm', platform: 'browser', external: ['module'] }),
		build({ entryPoints: [fileURLToPath(new URL('../../src/common/editor/storage/opfs-sync-worker.ts', import.meta.url))],
			bundle: true, write: false, format: 'esm', platform: 'browser' }),
	]);
	await page.route(`**${ROOT}/**`, async route => {
		const path = new URL(route.request().url()).pathname;
		if (path !== `${ROOT}/entry.js` && path !== `${ROOT}/opfs-sync-worker.ts`) { await route.abort(); return; }
		const response = await route.fetch(), headers = response.headers();
		delete headers['content-length']; delete headers['content-encoding']; headers['content-type'] = 'text/javascript';
		try { await route.fulfill({ status: 200, headers, body: path.endsWith('/opfs-sync-worker.ts') ? worker.outputFiles[0].text : bundle.outputFiles[0].text }); }
		finally { await response.dispose(); }
	});
	const origin = process.env.SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS
		? JSON.parse(process.env.SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS).lightscaper : browserProductSiteForBuild('lightscaper').origin;
	await page.goto(`${origin}/en/`);
}
