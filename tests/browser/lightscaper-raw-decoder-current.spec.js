/* SPDX-License-Identifier: AGPL-3.0-only */

import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { expect, test } from './helpers/browser-coverage-fixture.js';
import { resolveBrowserProductTestUrl } from './helpers/browser-product-test-url.js';

// Decoder foundation qualification only. RAW File→Import UI, durable RAW
// Original publication and broad camera/color corpora remain separate work.
// The route seam serves actual pinned Wasm and bundles actual production TS;
// it does not substitute decoded pixels, worker messages or native functions.
test.use({ browserCoverage: false });
const ROOT = '/__lightscaper_raw_decoder_current__';
const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
let program, workerProgram, wasm;

test.beforeAll(async () => {
	const manifest = JSON.parse(await readFile(new URL('../../config/lightscaper-libraw-runtime-manifest.json', import.meta.url), 'utf8'));
	wasm = await readFile(new URL(`../../${manifest.runtime.path}`, import.meta.url));
	expect(wasm.length).toBe(manifest.runtime.byteLength);
	expect(createHash('sha256').update(wasm).digest('hex')).toBe(manifest.runtime.sha256);
	const [entry, worker] = await Promise.all([
		build({ stdin: { resolveDir: repositoryRoot, contents: `
export { withDecodedRawFrameV1, withRawEmbeddedPreviewV1 } from './src/common/editor/raw/libraw-runtime-v1.ts';
export { compilePinnedLibRawModuleV1 } from './src/common/editor/raw/libraw-runtime-asset-v1.ts';
export { rawDngFixtureV1 } from './tests/helpers/lightscaper-raw-dng-current-fixture.ts';
` }, bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2023' }),
		build({ entryPoints: [fileURLToPath(new URL('../../src/common/editor/raw/libraw-worker-v1.ts', import.meta.url))],
			bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2023' }),
	]);
	expect(entry.outputFiles).toHaveLength(1); expect(worker.outputFiles).toHaveLength(1);
	program = entry.outputFiles[0].text; workerProgram = worker.outputFiles[0].text;
});

async function scenario(page, mode) {
	const nativeWorkers = [], unpublishedRequests = [];
	page.on('worker', worker => { if (new URL(worker.url()).pathname === `${ROOT}/worker.js`) nativeWorkers.push(worker.url()); });
	page.on('request', request => {
		if (request.url().startsWith('https://assets.soundscaper.org/runtime/libraw/')) unpublishedRequests.push(request.url());
	});
	await page.route(`**${ROOT}/**`, async route => {
		const path = new URL(route.request().url()).pathname;
		if (![`${ROOT}/entry.js`, `${ROOT}/worker.js`, `${ROOT}/libraw.wasm`].includes(path)) { await route.abort(); return; }
		// A dedicated worker must retain the site's COEP/COOP response policy.
		// Plain body-only fulfillment is blocked before its actual module runs.
		const response = await route.fetch(), headers = response.headers();
		delete headers['content-length']; delete headers['content-encoding'];
		headers['content-type'] = path.endsWith('.wasm') ? 'application/wasm' : 'text/javascript';
		try { await route.fulfill({ status: 200, headers, body: path.endsWith('/entry.js') ? program : path.endsWith('/worker.js') ? workerProgram : wasm }); }
		finally { await response.dispose(); }
	});
	await page.goto(resolveBrowserProductTestUrl('/lightscaper/en/'));
	await expect(page.locator('html')).toHaveAttribute('data-product', 'lightscaper');
	const result = await page.evaluate(async ({ root, mode }) => {
		const api = await import(new URL(`${root}/entry.js`, location.href).href);
		const response = await fetch(new URL(`${root}/libraw.wasm`, location.href));
		if (!response.ok) throw new Error('The real pinned RAW artifact was not served.');
		const module = await api.compilePinnedLibRawModuleV1(new Uint8Array(await response.arrayBuffer()));
		const active = new Set(), nativeErrors = [], statistics = { created: 0, posted: 0, terminated: 0, consumed: 0 };
		const options = {
			loadModule() {
				if (this !== options) throw new Error('The native loader receiver changed.');
				return Promise.resolve(module);
			},
			createWorker() {
				if (this !== options) throw new Error('The native worker factory receiver changed.');
				const worker = new Worker(new URL(`${root}/worker.js`, location.href), { type: 'module', name: 'lightscaper-raw-browser-proof' });
				const post = worker.postMessage, add = worker.addEventListener, remove = worker.removeEventListener, terminate = worker.terminate;
				Reflect.apply(add, worker, ['error', event => {
					if (nativeErrors.length < 4) nativeErrors.push({ message: typeof event.message === 'string' ? event.message.slice(0, 1024) : '',
						filename: typeof event.filename === 'string' ? event.filename.slice(0, 512) : '',
						line: Number.isSafeInteger(event.lineno) ? event.lineno : 0, column: Number.isSafeInteger(event.colno) ? event.colno : 0 });
				}]);
				statistics.created++; active.add(worker);
				const port = {
					postMessage(message, transfer) {
						if (this !== port) throw new Error('The native post receiver changed.');
						statistics.posted++; Reflect.apply(post, worker, [message, transfer]);
					},
					addEventListener(type, listener) {
						if (this !== port) throw new Error('The native listener receiver changed.');
						Reflect.apply(add, worker, [type, listener]);
					},
					removeEventListener(type, listener) {
						if (this !== port) throw new Error('The native listener removal receiver changed.');
						Reflect.apply(remove, worker, [type, listener]);
					},
					terminate() {
						if (this !== port) throw new Error('The native termination receiver changed.');
						Reflect.apply(terminate, worker, []); active.delete(worker); statistics.terminated++;
					},
				};
				return port;
			},
		};
		const consumed = () => {
			if (active.size !== 0 || statistics.created !== statistics.terminated) throw new Error('The decoder worker must retire before consuming pixels.');
			statistics.consumed++;
		};
		try {
			if (mode === 'decode') {
				let baseline;
				const frames = [];
				for (const orientation of [1, 3, 6, 8]) {
					const fixture = api.rawDngFixtureV1(orientation), before = fixture.bytes.slice();
					let backing;
					const row = await api.withDecodedRawFrameV1({ bytes: fixture.bytes }, frame => {
						consumed(); backing = frame.pixels.buffer;
						const words = frame.pixels, pixel = (x, y) => Array.from(words.subarray((y * 32 + x) * 4, (y * 32 + x) * 4 + 3));
						let unequal = 0;
						if (!baseline) baseline = words.slice();
						else for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
							const sx = orientation === 3 ? 31 - x : orientation === 6 ? y : 31 - y;
							const sy = orientation === 3 ? 31 - y : orientation === 6 ? 31 - x : x;
							for (let channel = 0; channel < 4; channel++) {
								if (words[(y * 32 + x) * 4 + channel] !== baseline[(sy * 32 + sx) * 4 + channel]) unequal++;
							}
						}
						return { orientation, descriptor: frame.descriptor, nativeWords: words instanceof Uint16Array,
							low: pixel(8, 8), high: pixel(24, 8), blue: pixel(8, 24), red: pixel(24, 24), unequal,
							alphaOpaque: words.every((value, index) => index % 4 !== 3 || value === 65535),
							sourceCodes: [fixture.sensor[8 * 32 + 8], fixture.sensor[8 * 32 + 24]] };
					}, options);
					frames.push({ ...row, wiped: new Uint8Array(backing).every(value => value === 0),
						inputUnchanged: fixture.bytes.every((value, index) => value === before[index]) });
				}
				return { frames, statistics, active: active.size };
			}
			let previewWasNull = false, invalidConsumed = false, errorMessage = '';
			const bytes = api.rawDngFixtureV1().bytes, before = bytes.slice();
			await api.withRawEmbeddedPreviewV1({ bytes }, preview => { consumed(); previewWasNull = preview === null; }, options);
			try {
				await api.withDecodedRawFrameV1({ bytes: new Uint8Array(64).fill(17) }, () => { invalidConsumed = true; }, options);
			} catch (error) { errorMessage = error.message; }
			return { previewWasNull, invalidConsumed, errorMessage, statistics, active: active.size,
				inputUnchanged: bytes.every((value, index) => value === before[index]) };
		} catch (error) {
			if (nativeErrors.length) throw new Error(`${error.message}; actual worker diagnostics: ${JSON.stringify(nativeErrors)}`, { cause: error });
			throw error;
		} finally { for (const worker of active) worker.terminate(); active.clear(); }
	}, { root: ROOT, mode });
	expect(unpublishedRequests).toEqual([]);
	expect(nativeWorkers).toHaveLength(result.statistics.created);
	return result;
}

test('actual browser RAW worker retains greater-than-byte DNG precision, applies orientation and retires native scopes', async ({ page, browserName }) => {
	test.skip(browserName === 'webkit', 'This RAW foundation slice qualifies Chromium and Firefox.');
	test.setTimeout(60_000);
	const result = await scenario(page, 'decode');
	expect(result.active).toBe(0); expect(result.statistics).toEqual({ created: 4, posted: 4, terminated: 4, consumed: 4 });
	expect(result.frames.map(frame => frame.orientation)).toEqual([1, 3, 6, 8]);
	for (const frame of result.frames) {
		expect(frame.descriptor).toEqual({ schemaVersion: 1, width: 32, height: 32, sampleFormat: 'unorm16', primaries: 'srgb', transfer: 'linear' });
		expect(frame.nativeWords).toBe(true); expect(frame.alphaOpaque).toBe(true); expect(frame.unequal).toBe(0);
		expect(frame.wiped).toBe(true); expect(frame.inputUnchanged).toBe(true); expect(frame.sourceCodes).toEqual([1024, 1025]);
	}
	const upright = result.frames[0];
	for (let channel = 0; channel < 3; channel++) {
		expect(upright.low[channel]).toBeGreaterThan(0);
		expect(upright.high[channel]).toBeGreaterThan(upright.low[channel]);
		expect(upright.high[channel] - upright.low[channel]).toBeLessThanOrEqual(64);
		expect(Math.floor(upright.high[channel] / 257)).toBe(Math.floor(upright.low[channel] / 257));
	}
	expect(upright.blue[2]).toBeGreaterThan(upright.blue[0]); expect(upright.red[0]).toBeGreaterThan(upright.red[2]);
});

test('actual browser RAW worker reports absent embedded preview and refuses corrupt input without substituted pixels', async ({ page, browserName }) => {
	test.skip(browserName === 'webkit', 'This RAW foundation slice qualifies Chromium and Firefox.');
	test.setTimeout(60_000);
	const result = await scenario(page, 'preview');
	expect(result.previewWasNull).toBe(true); expect(result.invalidConsumed).toBe(false); expect(result.errorMessage).toMatch(/LibRaw raw_open failed/u);
	expect(result.inputUnchanged).toBe(true); expect(result.active).toBe(0);
	expect(result.statistics).toEqual({ created: 2, posted: 2, terminated: 2, consumed: 1 });
});
