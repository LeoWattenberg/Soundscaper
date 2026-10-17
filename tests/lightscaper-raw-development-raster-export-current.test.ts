/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { PhotoRasterExportCurrentV1 } from '../src/lightscaper/controller/photo-raster-export-current-v1.ts';
import { PhotoRasterExport } from '../src/lightscaper/controller/photo-raster-export.ts';
import { recoveryRasterFixture, rasterEncodedCode, recoveryPng8Samples, recoveryPng16Samples, RECOVERY_OUTPUT16 } from './helpers/lightscaper-raw-development-raster-export-fixture.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';
import { repairSettingsFixture, SETTINGS_TIME } from './helpers/lightscaper-repair-settings-current-fixture.ts';
import { defaultImageDevelopStateV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import { normalizeImageDevelopStateV3 } from '../src/common/editor/imaging/image-develop-state-v3.ts';
import { createPhotoDevelopRenderRuntimeCurrentV1 } from '../src/lightscaper/photo-develop-render-runtime-current-v1.ts';
import type { PixelFrameV1 } from '../src/common/editor/imaging/pixel-frame-contract-v1.ts';

for (const mode of ['headroom', 'recovery'] as const) test(`actual saved ${mode} recipe4 exports native PNG8/16 after matching derived RAW processing`, { timeout: 30_000 }, async () => {
	const f = await recoveryRasterFixture(mode), owner = new PhotoRasterExportCurrentV1('png');
	try {
		assert.ok(f.floats.some((value, index) => index % 4 !== 3 && value > 1), 'The source retains real unclipped native headroom.');
		for (const bitDepth of [8, 16] as const) {
			f.events.length = 0;
			await owner.start({ ...f.request, ...(bitDepth === 16 ? { output: RECOVERY_OUTPUT16 } : {}) });
			const bytes = f.deliveries.at(-1)!.bytes, decoded = bitDepth === 16 ? recoveryPng16Samples(bytes) : recoveryPng8Samples(bytes), actual = decoded.samples;
			assert.deepEqual([decoded.width, decoded.height], [128, 96]);
			// Native source is observed before Develop; the scalar tone and codec
			// boundary oracle is independent of every production image kernel.
			const maximum = bitDepth === 16 ? 65535 : 255;
			const expected = f.floats.map((value, index) => index % 4 === 3 ? maximum : rasterEncodedCode(Math.fround(value * .5), maximum));
			assert.deepEqual(actual, expected); assert.equal(f.events.includes('canonical'), false);
			assert.ok(f.events.indexOf('download') > f.events.indexOf('derived-retired'));
			await f.assertCustody();
		}
	} finally { await owner.cancelAndJoin(); await f.close(); }
});

test('saved noncanonical recipe4 cannot fall back to canonical Original when the named derived capability is absent', async () => {
	const f = await recoveryRasterFixture(), owner = new PhotoRasterExportCurrentV1('png');
	const entered = deferred<void>(), release = deferred<void>(); let work: Promise<unknown> | undefined;
	try {
		const { withDerivedFrame: _derived, ...request } = f.request;
		work = owner.start({ ...request, loadRenderer: async () => assert.fail('Unavailable derived input must refuse before renderer load.'),
			prepareSave: () => { f.events.push('picker'); return { mode: 'stream',
				createWritable: async () => assert.fail('No writable before derived admission.'), patchFinalPrefix: async () => assert.fail('No encoded prefix.'),
				bytesWritten: () => 0, commit: async () => assert.fail('No commit without a derived source.'), savedFile: () => assert.fail('No saved destination.'),
				abort: async () => { entered.resolve(); await release.promise; },
			}; },
		});
		const observed = work.then(() => assert.fail('Missing derived child must refuse.'), (error: unknown) => error);
		await entered.promise; assert.equal(await remainsPending(work), true); assert.deepEqual(f.events, ['picker']);
		release.resolve(); const error = await observed; assert.ok(error instanceof Error); assert.match(error.message, /derived|recovery|profile/iu);
		assert.equal(f.events.includes('canonical'), false); assert.equal(f.events.includes('encode'), false); assert.equal(f.deliveries.length, 0);
		await f.assertCustody();
	} finally { release.resolve(); await work?.catch(() => undefined); await owner.cancelAndJoin(); await f.close(); }
});

test('Current recovery export cancellation joins the held native output scope and never publishes a destination', async () => {
	const f = await recoveryRasterFixture(), owner = new PhotoRasterExportCurrentV1('png'), entered = deferred<void>(), release = deferred<void>();
	const opaque = Proxy.revocable({}, {}); opaque.revoke(); let output: Float32Array | undefined;
	const work = owner.start({ ...f.request, output: RECOVERY_OUTPUT16, encode: async frame => {
		assert.ok(frame.pixels instanceof Float32Array); output = frame.pixels; entered.resolve(); await release.promise; throw opaque.proxy;
	} });
	const observed = work.then(value => ({ value }), (error: unknown) => ({ error }));
	try {
		await Promise.race([entered.promise, work.then(() => assert.fail('No recovered codec scope.'), (error: unknown) => { throw error; })]);
		const closing = owner.cancelAndJoin(opaque.proxy); assert.equal(await remainsPending(closing), true); assert.ok(output?.some(value => value !== 0));
		release.resolve(); await closing; const result = await observed; assert.ok('error' in result); assert.ok(Object.is(result.error, opaque.proxy));
		assert.ok(output?.every(value => value === 0)); assert.equal(f.deliveries.length, 0); await f.assertCustody();
	} finally { release.resolve(); await observed; await owner.cancelAndJoin(); await f.close(); }
});

test('the permanent raster export refuses process4 and the named derived capability before publication', async () => {
	const f = await recoveryRasterFixture(), legacy = new PhotoRasterExport('png');
	try {
		await assert.rejects(Reflect.apply(legacy.start, legacy, [f.request]) as Promise<unknown>);
		assert.deepEqual(f.events, []); assert.equal(f.deliveries.length, 0);
	} finally { await legacy.cancelAndJoin(); await f.close(); }
});

test('Current JPEG delivery receives one final encoded byte boundary from the actual recovered native stage', async () => {
	const f = await recoveryRasterFixture(), owner = new PhotoRasterExportCurrentV1('jpeg');
	let calls = 0; const encoded = Uint8Array.of(255, 216, 255, 217);
	try {
		await owner.start({ ...f.request, fileTypeDescription: 'JPEG', encode: async (frame, options) => {
			calls++; assert.equal(frame.descriptor.sampleFormat, 'unorm8'); assert.equal(frame.descriptor.transfer, 'srgb'); assert.equal(options.bitDepth, undefined);
			assert.deepEqual([...frame.pixels], f.floats.map((value, index) => index % 4 === 3 ? 255 : rasterEncodedCode(Math.fround(value * .5))));
			return encoded;
		} });
		// The Node transport proves the actual JPEG codec input, not a native
		// browser JPEG encoder. Browser workflows own the latter qualification.
		assert.equal(calls, 1); assert.equal(f.deliveries[0]?.mimeType, 'image/jpeg'); assert.ok(f.deliveries[0]?.name.endsWith('.jpg'));
		assert.deepEqual([...f.deliveries[0]!.bytes], [255, 216, 255, 217]); assert.ok(encoded.every(value => value === 0)); await f.assertCustody();
	} finally { await owner.cancelAndJoin(); await f.close(); }
});

test('invalid supplied derived capabilities refuse before the synchronous Save picker and never invoke accessors', async () => {
	const f = await recoveryRasterFixture(), owner = new PhotoRasterExportCurrentV1('png'); let reads = 0;
	try {
		for (const descriptor of [{ value: 1 }, { get: () => { reads++; return f.request.withDerivedFrame; } }]) {
			const request = { ...f.request }; Object.defineProperty(request, 'withDerivedFrame', { configurable: true, enumerable: true, ...descriptor });
			await assert.rejects(owner.start(request)); assert.deepEqual(f.events, []);
		}
		assert.equal(reads, 0); assert.equal(f.deliveries.length, 0); await f.assertCustody();
	} finally { await owner.cancelAndJoin(); await f.close(); }
});

test('Current native raster capacity is sixteen bytes per pixel beyond the old four-megapixel byte guard', { timeout: 30_000 }, async () => {
	const f = await repairSettingsFixture(1), owner = new PhotoRasterExportCurrentV1('png'), before = await f.read();
	const saved = (await f.session.develop.apply({ schemaVersion: 3, photoId: before.photoId, expectedRevision: before.revision,
		command: { type: 'record-develop', versionId: before.versionId, label: 'Native capacity', createdAt: SETTINGS_TIME,
			develop: normalizeImageDevelopStateV3({ ...defaultImageDevelopStateV2(), processVersion: 3, repairs: { schemaVersion: 1, spots: [] } }) } })).snapshot;
	const width = 2049, height = 2048, pixels = new Float32Array(width * height * 4).fill(1); pixels.set([-.25, .25, 1.5, 1]);
	const source: Readonly<PixelFrameV1> = Object.freeze({ descriptor: Object.freeze({ schemaVersion: 1, width, height, sampleFormat: 'float32', primaries: 'srgb', transfer: 'linear' }), pixels });
	const runtime = createPhotoDevelopRenderRuntimeCurrentV1({ source: f.session.cubeLuts.source, maskSource: f.session.maskRasterSource });
	let encoded = false, delivered = false;
	try {
		assert.ok(pixels.byteLength > 64 * 1024 * 1024);
		const receipt = await owner.start({ photoId: saved.photoId, versionId: saved.versionId, expectedRevision: saved.revision,
			fileName: 'Native capacity', fileTypeDescription: 'PNG', output: RECOVERY_OUTPUT16, execute: f.execute,
			// Explicit borrowed-plane seam: the actual Current renderer and export
			// owner must admit this native extent. No RAW decoder is replaced.
			withOriginalFrame: async (bound, consume) => consume({ photoId: bound.photoId, revision: bound.expectedRevision, frame: source }),
			loadRenderer: async () => runtime,
			encode: async (frame, options) => {
				encoded = true; assert.equal(options.bitDepth, 16); assert.ok(frame.pixels instanceof Float32Array);
				assert.deepEqual([frame.descriptor.width, frame.descriptor.height], [2049, 2048]);
				assert.deepEqual([...frame.pixels.subarray(0, 4)], [-.25, .25, 1.5, 1]); return Uint8Array.of(1, 2, 3);
			},
			prepareSave: () => ({ mode: 'blob', target: { browserDownload: true, name: 'Native capacity.png' }, fileName: 'Native capacity.png' }),
			saveFile: request => { delivered = true; assert.ok(request.blob); return { method: 'download', fileName: 'Native capacity.png', size: request.blob.size }; },
		});
		assert.equal(receipt.status, 'download-started'); assert.equal(encoded, true); assert.equal(delivered, true);
		assert.deepEqual([...pixels.subarray(0, 4)], [-.25, .25, 1.5, 1]); assert.equal(pixels.at(-1), 1);
	} finally { await owner.cancelAndJoin(); pixels.fill(0); await f.close(); }
});

test('graphic borrow starts after native RAW worker retirement, and excessive held graphic storage refuses before Develop', async () => {
	const f = await recoveryRasterFixture(), owner = new PhotoRasterExportCurrentV1('png'); let graphicOpened = false, rendered = false;
	const pixels = Uint8Array.of(255, 0, 0, 255), graphic: Readonly<PixelFrameV1> = {
		descriptor: { schemaVersion: 1, width: 1, height: 1, sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' }, pixels };
	try {
		await assert.rejects(owner.start({ ...f.request, output: RECOVERY_OUTPUT16,
			graphicWatermark: { body: new Blob([new Uint8Array(33 * 1024 * 1024)]), anchor: 'middle-center', widthFraction: 1, marginFraction: 0, opacity: 1 },
			withGraphicFrame: async (_request, consume) => {
				graphicOpened = true; assert.equal(f.canonical.active(), 0); assert.equal(f.recovery.active(), 0); assert.ok(f.events.includes('derived'));
				return consume(graphic, { orientation: 1, runtimeVersion: 'explicit-graphic-borrow' });
			},
			loadRenderer: async () => ({ withFullResolution: async () => { rendered = true; assert.fail('Held storage must refuse before Develop.'); } }),
		}), /aggregate|working|storage/iu);
		assert.equal(graphicOpened, true); assert.equal(rendered, false); assert.equal(f.deliveries.length, 0); await f.assertCustody();
	} finally { await owner.cancelAndJoin(); await f.close(); }
});
