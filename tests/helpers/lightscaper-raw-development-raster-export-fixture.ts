/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { inflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import type { PhotoRasterExportRequestCurrentV1 } from '../../src/lightscaper/controller/photo-raster-export-contract-v1.ts';
import type { PhotoLibraryDevelopOriginalPortCurrentV1 } from '../../src/common/editor/photo-library-develop-original-current-v1.ts';
import { createPhotoDevelopRenderRuntimeCurrentV1 } from '../../src/lightscaper/photo-develop-render-runtime-current-v1.ts';
import { normalizeImageDevelopStateV4 } from '../../src/common/editor/imaging/image-develop-state-v4.ts';
import { defaultImageDevelopStateV2 } from '../../src/common/editor/imaging/image-develop-state-v2.ts';
import { createVideoEffectV2 } from '../../src/common/editor/video-effects-v2.ts';
import { encodePixelFramePngV1 } from '../../src/common/editor/imaging/pixel-frame-png-v1.ts';
import { encodePixelFramePng16V1 } from '../../src/common/editor/imaging/pixel-frame-png16-v1.ts';
import { rawRecoveryDngFixtureV1 } from './lightscaper-raw-recovery-dng-current-fixture.ts';
import { rawWorkerFixtureV1 } from './lightscaper-raw-worker-current-fixture.ts';
import { rawRecoveryWorkerFixtureV2 } from './lightscaper-raw-recovery-worker-current-fixture.ts';
import { repairSettingsFixture, SETTINGS_TIME } from './lightscaper-repair-settings-current-fixture.ts';
import { PhotoMediaStoreV1 } from '../../src/lightscaper/storage/photo-media-store.ts';
import { PhotoCatalogRepositoryCurrentV1 } from '../../src/lightscaper/catalog/photo-catalog-repository-current-v1.ts';
import { readPhotoLibrarySessionLocationV2 } from '../../src/lightscaper/storage/photo-library-location-reader-v2.ts';

export const RECOVERY_OUTPUT16 = Object.freeze({ schemaVersion: 2 as const, bitDepth: 16 as const,
	sizing: Object.freeze({ kind: 'original' as const }), quality: 'nearest' as const });
export function recoveryRecipe(mode: 'canonical' | 'headroom' | 'recovery' = 'recovery') {
	return normalizeImageDevelopStateV4({ ...defaultImageDevelopStateV2(), processVersion: 4, rawDevelopment: { schemaVersion: 1, mode },
		repairs: { schemaVersion: 1, spots: [] }, effects: [createVideoEffectV2('tone-ladder-v1', { id: 'exposure', params: { exposure: -1 } })] });
}
export function rasterEncodedCode(value: number, maximum = 255): number {
	const linear = Math.min(1, Math.max(0, value));
	return Math.round(maximum * (linear <= .0031308 ? linear * 12.92 : 1.055 * linear ** (1 / 2.4) - .055));
}
/** Independent, bounded delivery readers for the real 128x96 native fixture.
 * The tiny repair reader deliberately keeps its separate 4096-pixel limit. */
export function recoveryPng8Samples(bytes: Uint8Array) { return recoveryPngSamples(bytes, 8); }
export function recoveryPng16Samples(bytes: Uint8Array) { return recoveryPngSamples(bytes, 16); }
function recoveryPngSamples(bytes: Uint8Array, bitDepth: 8 | 16) {
	assert.ok(bytes.length >= 45 && bytes.length <= 16 * 1024 * 1024);
	assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), width = view.getUint32(16), height = view.getUint32(20);
	assert.ok(width > 0 && height > 0 && width <= 1024 && height <= 1024 && width * height <= 1_048_576);
	assert.equal(view.getUint32(8), 13); assert.equal(String.fromCharCode(...bytes.subarray(12, 16)), 'IHDR');
	assert.deepEqual([...bytes.subarray(24, 29)], [bitDepth, 6, 0, 0, 0]);
	const chunks: Uint8Array[] = []; let ended = false;
	for (let at = 8; at < bytes.length;) {
		assert.ok(at + 12 <= bytes.length); const count = view.getUint32(at); assert.ok(at + count + 12 <= bytes.length);
		const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
		let crc = 0xffff_ffff;
		for (let index = at + 4; index < at + 8 + count; index++) {
			crc ^= bytes[index]!; for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb8_8320 : crc >>> 1;
		}
		assert.equal(view.getUint32(at + 8 + count), (crc ^ 0xffff_ffff) >>> 0);
		if (type === 'IDAT') chunks.push(bytes.subarray(at + 8, at + 8 + count));
		if (type === 'IEND') { assert.equal(count, 0); assert.equal(at + 12, bytes.length); ended = true; }
		at += count + 12;
	}
	assert.equal(ended, true); assert.ok(chunks.length > 0);
	const stride = width * 4 * (bitDepth / 8) + 1;
	const rows = inflateSync(Buffer.concat(chunks), { maxOutputLength: height * stride }), samples: number[] = [];
	assert.equal(rows.length, height * stride);
	for (let y = 0; y < height; y++) {
		assert.equal(rows[y * stride], 0);
		for (let x = 0; x < width * 4; x++) samples.push(bitDepth === 16 ? rows.readUInt16BE(y * stride + 1 + x * 2) : rows[y * stride + 1 + x]!);
	}
	return { width, height, samples };
}

export type RecoveryRasterRequest = PhotoRasterExportRequestCurrentV1 & Readonly<{
	withDerivedFrame: PhotoLibraryDevelopOriginalPortCurrentV1['withDerivedFrame'];
}>;

async function inspectImportedOriginal(f: Awaited<ReturnType<typeof repairSettingsFixture>>, photoId: string) {
	const anchor = new PhotoMediaStoreV1({ indexedDB: f.native.factory, locks: f.options.locks, preferOpfs: false });
	const selected = await (async () => { try { await anchor.ready(); return await readPhotoLibrarySessionLocationV2({ settings: anchor.settingsRepository,
		initializeDefault: async () => { throw new Error('Raster custody observation cannot initialize a namespace.'); } }); } finally { await anchor.close(); } })();
	const media = new PhotoMediaStoreV1({ indexedDB: f.native.factory, locks: f.options.locks, databaseName: selected.location.mediaDatabaseName, preferOpfs: false });
	const catalog = new PhotoCatalogRepositoryCurrentV1({ indexedDB: f.native.factory, databaseName: selected.location.catalogDatabaseName, verifyOriginal: media.verifyOriginal });
	try {
		const photo = await catalog.loadPhoto(selected.location.catalogId, photoId); assert.ok(photo);
		const body = await media.mediaRepository.loadAsset(photo.original.storageKey); assert.ok(body instanceof Blob);
		const bytes = new Uint8Array(await body.arrayBuffer()); assert.equal(createHash('sha256').update(bytes).digest('hex'), photo.original.contentSha256);
		const native = f.native.raw(selected.location.mediaDatabaseName);
		const roots = (native.records(selected.location.mediaDatabaseName, 'catalogOriginalRoots') as Record<string, unknown>[]).filter(row => row.photoId === photoId);
		const assets = (native.records(selected.location.mediaDatabaseName, 'mediaAssets') as Record<string, unknown>[]).filter(row => row.sourceId === photo.original.storageKey);
		assert.equal(roots.length, 1); assert.equal(assets.length, 1); assert.ok(typeof assets[0]?.mediaContentToken === 'string');
		return { photo, bytes, roots, assets };
	} finally { await Promise.all([catalog.close(), media.close()]); }
}

/** Actual Current selected Session, owned RAW import, native catalog Save and
 * both pinned production workers. Only browser Worker/fetch transport is adapted. */
export async function recoveryRasterFixture(mode: 'headroom' | 'recovery' = 'recovery') {
	const f = await repairSettingsFixture(1), canonical = await rawWorkerFixtureV1(), recovery = await rawRecoveryWorkerFixtureV2();
	const keys = ['Worker', 'fetch'] as const, previous = keys.map(key => Object.getOwnPropertyDescriptor(globalThis, key));
	const restore = () => { for (const [index, key] of keys.entries()) { const descriptor = previous[index];
		if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); } };
	Object.defineProperty(globalThis, 'Worker', { configurable: true, value: function (_url: URL, options: WorkerOptions) {
		if (options.name === 'lightscaper-libraw') return canonical.createWorker();
		assert.equal(options.name, 'lightscaper-libraw-recovery'); return recovery.createWorker();
	} });
	Object.defineProperty(globalThis, 'fetch', { configurable: true, value: async (url: unknown) => {
		const path = url === 'https://assets.soundscaper.org/runtime/libraw/0.22.2/libraw.wasm' ? new URL('../../runtime-assets/libraw/0.22.2/libraw.wasm', import.meta.url)
			: url === 'https://assets.soundscaper.org/runtime/libraw/0.22.2/recovery-abi2/libraw-recovery.wasm'
				? process.env.LIGHTSCAPER_RECOVERY_WASM ?? new URL('../../runtime-assets/libraw/0.22.2/recovery-abi2/libraw-recovery.wasm', import.meta.url) : null;
		assert.ok(path, 'Only pinned decoder assets may be fetched.'); return new Response(new Uint8Array(await readFile(path)));
	} });
	async function close() {
		const outcomes = await Promise.allSettled([f.close(), canonical.close(), recovery.close()]); restore();
		const failures = outcomes.flatMap(value => value.status === 'rejected' ? [value.reason as unknown] : []);
		if (failures.length) throw new AggregateError(failures, 'Recovery raster fixture retirement failed.');
	}
	try {
		const raw = rawRecoveryDngFixtureV1().bytes, imported = await f.session.importFiles([new File([raw], 'Recovery.dng', { type: 'image/png' })]);
		assert.equal(imported[0]?.status, 'imported'); const photoId = imported[0]?.photoId; assert.ok(photoId);
		const initial = await f.session.develop.read({ schemaVersion: 3, photoId });
		const ack = await f.session.develop.apply({ schemaVersion: 3, photoId, expectedRevision: initial.revision,
			command: { type: 'record-develop', versionId: initial.versionId, develop: recoveryRecipe(mode), label: 'Recovered export', createdAt: SETTINGS_TIME } });
		const saved = ack.snapshot, original = f.session.develop.original; assert.ok(original?.withDerivedFrame);
		const bound = { schemaVersion: 1 as const, photoId, expectedRevision: saved.revision };
		const words = await original.withFrame(bound, view => Array.from(view.frame.pixels));
		const profile = mode === 'headroom' ? 'linear-headroom-v1' as const : 'highlight-recovery-v1' as const;
		const floats = await original.withDerivedFrame({ ...bound, profile }, view => Array.from(view.frame.pixels));
		const metadata = await f.session.readMetadata(photoId), custody = await inspectImportedOriginal(f, photoId);
		assert.deepEqual(custody.bytes, raw);
		const events: string[] = [], deliveries: { name: string; mimeType: string; bytes: Uint8Array }[] = [];
		const encoded: Uint8Array[] = [], borrowed: ArrayBuffer[] = [];
		const runtime = createPhotoDevelopRenderRuntimeCurrentV1({ source: f.session.cubeLuts.source, maskSource: f.session.maskRasterSource });
		const request: RecoveryRasterRequest = { photoId, versionId: saved.versionId, expectedRevision: saved.revision, fileName: 'Recovery', fileTypeDescription: 'PNG', execute: f.execute,
			withOriginalFrame: async (request, consume, options) => { events.push('canonical'); return original.withFrame(request, consume, options); },
			async withDerivedFrame(request, consume, options) {
				assert.equal(this, requestOwner); events.push('derived');
				const result = await original.withDerivedFrame!(request, view => {
					assert.equal(canonical.active(), 0); assert.equal(recovery.active(), 0); borrowed.push(view.frame.pixels.buffer); return consume(view);
				}, options); events.push('derived-retired'); return result;
			},
			loadRenderer: async () => runtime,
			encode: async (frame, { bitDepth, ...options }) => {
				events.push('encode'); const result = await (bitDepth === 16 ? encodePixelFramePng16V1 : encodePixelFramePngV1)(frame, options); encoded.push(result); return result;
			},
			prepareSave(value) { events.push('picker'); const name = value.suggestedName; assert.ok(typeof name === 'string');
				return { mode: 'blob', target: { browserDownload: true, name }, fileName: name }; },
			async saveFile(value) { assert.ok(value.blob); events.push('download'); const name = value.suggestedName ?? value.fileName; assert.ok(typeof name === 'string');
				deliveries.push({ name, mimeType: value.mimeType ?? value.blob.type, bytes: new Uint8Array(await value.blob.arrayBuffer()) });
				return { method: 'download', fileName: name, size: value.blob.size }; },
		};
		// Native request methods intentionally observe their exact admitted object.
		const requestOwner = request;
		Object.defineProperty(request, 'withDerivedFrame', { configurable: true, enumerable: true, value: request.withDerivedFrame.bind(request) });
		const readSidecar = f.session.readExportSidecarCurrent; assert.ok(readSidecar);
		const read = (...args: Parameters<typeof readSidecar>) => Reflect.apply(readSidecar, f.session, args) as ReturnType<typeof readSidecar>;
		const journal = f.session.exportJournalCurrent; assert.ok(journal);
		return { ...f, raw, canonical, recovery, saved, original, bound, words, floats, metadata, events, deliveries, encoded, borrowed, request,
			readSidecar: read, openJournal: (...args: Parameters<typeof journal.open>) => Reflect.apply(journal.open, journal, args) as ReturnType<typeof journal.open>,
			async assertCustody() {
				assert.deepEqual(await inspectImportedOriginal(f, photoId), custody);
				assert.deepEqual(await f.session.develop.read({ schemaVersion: 3, photoId }), saved);
				assert.deepEqual(await f.session.readMetadata(photoId), metadata);
				assert.deepEqual(await original.withFrame(bound, view => Array.from(view.frame.pixels)), words);
				assert.ok(encoded.every(bytes => bytes.every(value => value === 0))); assert.ok(borrowed.every(buffer => new Uint8Array(buffer).every(value => value === 0)));
				assert.equal(canonical.active(), 0); assert.equal(recovery.active(), 0);
			}, close };
	} catch (error) { await close(); throw error; }
}
