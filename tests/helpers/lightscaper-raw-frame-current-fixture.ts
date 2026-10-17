/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { compilePinnedLibRawModuleV1 } from '../../src/common/editor/raw/libraw-runtime-asset-v1.ts';
import { withDecodedRawOriginalV1 } from '../../src/common/editor/raw/libraw-runtime-v1.ts';
import { createFramescaperImageFramePackV1 } from '../../src/common/editor/timeline-image-frame-pack-v1.ts';
import { FRAMESCAPER_IMAGE_ASSET_MIME_TYPE } from '../../src/common/editor/timeline-image-model.ts';
import { createImageDevelopHandoffProvenanceV2 } from '../../src/common/editor/image-develop-handoff-provenance-v2.ts';
import { defaultImageDevelopStateV2 } from '../../src/common/editor/imaging/image-develop-state-v2.ts';
import type { ImageDevelopStateCurrentV1 } from '../../src/common/editor/imaging/image-develop-state-current-v1.ts';
import { createPhotoFramescaperHandoffProjectCurrentV1 } from '../../src/lightscaper/controller/photo-framescaper-handoff-project-current-v1.ts';
import { rawDngFixtureV1 } from './lightscaper-raw-dng-current-fixture.ts';
import { rawWorkerFixtureV1 } from './lightscaper-raw-worker-current-fixture.ts';

const WASM = new URL('../../runtime-assets/libraw/0.22.2/libraw.wasm', import.meta.url);
const PIN = '7f9f4e791177114e5224e52c85f7be8b5d79bc5e48e1f87a4f69b1f6edf52c29';
let compiled: Promise<WebAssembly.Module> | undefined;
function nativeModule() { compiled ??= readFile(WASM).then(bytes => compilePinnedLibRawModuleV1(new Uint8Array(bytes))); return compiled; }
export function rawFixtureSha256CurrentV1(value: Uint8Array | string) { return createHash('sha256').update(value).digest('hex'); }

/** Independent wire digest: deliberately does not import the production raw
 * receipt owner. The literal RGBA16 big-endian order is portable across hosts. */
export function rawFixtureWordsSha256CurrentV1(words: readonly number[]): string {
	const bytes = Buffer.alloc(words.length * 2); for (const [index, word] of words.entries()) bytes.writeUInt16BE(word, index * 2);
	try { return rawFixtureSha256CurrentV1(bytes); } finally { bytes.fill(0); }
}

/** Real owned DNG, actual pinned LibRaw instance and bundled production Worker.
 * Only browser Worker transport is adapted to Node worker_threads. */
export async function createRawFrameFixtureCurrentV1(options: Readonly<{
	develop?: Readonly<ImageDevelopStateCurrentV1>; orientation?: 1 | 3 | 6 | 8; sourceId?: string;
}> = {}) {
	const workers = await rawWorkerFixtureV1(), original = rawDngFixtureV1(options.orientation ?? 1).bytes;
	const captured: ArrayBuffer[] = [], calls = { decoded: 0 };
	const withRawOriginal: typeof withDecodedRawOriginalV1 = (request, consume) => withDecodedRawOriginalV1(request, view => {
		calls.decoded++; assert.equal(workers.active(), 0); captured.push(view.frame.pixels.buffer); return consume(view);
	}, { loadModule: nativeModule, createWorker: workers.createWorker });
	let native: { descriptor: { schemaVersion: 1; width: number; height: number; sampleFormat: 'unorm16'; primaries: 'srgb'; transfer: 'linear' }; rawFlip: number; words: number[] };
	try { native = await withRawOriginal({ bytes: original }, view => {
		assert.equal(view.frame.descriptor.primaries, 'srgb'); assert.equal(view.frame.descriptor.transfer, 'linear');
		return { descriptor: { ...view.frame.descriptor, primaries: 'srgb' as const, transfer: 'linear' as const }, rawFlip: view.rawFlip, words: Array.from(view.frame.pixels) };
	}); }
	catch (error) { await workers.close(); throw error; }
	const raw = { schemaVersion: 1 as const, decoder: { id: 'libraw' as const, version: '0.22.2' as const, abiVersion: 1 as const, sha256: PIN },
		descriptor: native.descriptor, rawFlip: native.rawFlip, pixelEncoding: 'rgba16be' as const, pixelsSha256: rawFixtureWordsSha256CurrentV1(native.words) };
	const cache = Uint8Array.from(native.words, (word, index) => {
		if (index % 4 === 3) return 255; const value = word / 65535;
		return Math.round(255 * (value <= .0031308 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - .055));
	});
	const pack = createFramescaperImageFramePackV1({ original, receipt: { schemaVersion: 1, kind: 'raw-original', raw }, width: 32, height: 32,
		timingMode: 'fallback', frames: [{ presentationTicks: 0n, durationTicks: 5_000_000n, rgba: cache }] });
	const develop = options.develop ?? defaultImageDevelopStateV2(), sourceId = options.sourceId ?? 'raw-source';
	const provenance = createImageDevelopHandoffProvenanceV2({ original: { exactName: 'Native precision.dng', sha256: pack.originalSha256, byteLength: original.byteLength }, develop,
		origin: { schemaFamily: 'lightscaper', schemaVersion: 3, catalogId: 'raw-origin-catalog', photoId: 'raw-origin-photo', revision: 7,
			versionId: 'raw-saved', versionKind: 'master', versionName: 'Saved native RAW', versionCreatedAt: '2026-10-01T00:00:00.000Z' } });
	const source = { schemaVersion: 4 as const, kind: 'image' as const, id: sourceId, storageKey: sourceId, name: 'Saved native RAW', mimeType: FRAMESCAPER_IMAGE_ASSET_MIME_TYPE,
		contentSha256: pack.contentSha256, assetByteLength: pack.assetByteLength, conversionReceiptSha256: pack.conversionReceiptSha256,
		original: { fileName: 'Native precision.dng', mimeType: 'image/x-adobe-dng', recognizedFormat: 'dng', byteLength: original.byteLength, sha256: pack.originalSha256 },
		canonical: { width: 32, height: 32, hasAlpha: false, frameCount: 1, durationTicks: pack.durationTicks, timingMode: 'fallback' as const },
		develop, developed: { width: 32, height: 32 }, provenance, raw };
	const originalBlob = new Blob([original], { type: 'image/x-adobe-dng' }), body = new Blob([new Uint8Array(pack.bytes)], { type: source.mimeType });
	return { source, raw, original, originalBlob, native, cache, pack, body, workers, captured, calls, withRawOriginal,
		project: () => createPhotoFramescaperHandoffProjectCurrentV1(source, { projectId: 'raw-frame-project', sequenceId: 'raw-sequence', trackId: 'raw-video-track',
			clipId: 'raw-image-clip', now: '2026-10-01T00:00:00.000Z' }),
		read(offset: number, length: number) { return new Uint8Array(pack.bytes.slice(offset, offset + length)); },
		async close() { await workers.close(); for (const backing of captured) assert.ok(new Uint8Array(backing).every(value => value === 0)); },
		/** Default public/native owners remain real; only Worker transport and
		 * the pinned external WASM fetch are adapted for this Node process. */
		async withDefaultTransport<Result>(consume: () => Promise<Result>): Promise<Result> {
			const priorWorker = Object.getOwnPropertyDescriptor(globalThis, 'Worker'), priorFetch = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
			Object.defineProperty(globalThis, 'Worker', { configurable: true, value: function () { return workers.createWorker(); } });
			Object.defineProperty(globalThis, 'fetch', { configurable: true, value: async (url: unknown) => {
				assert.equal(url, 'https://assets.soundscaper.org/runtime/libraw/0.22.2/libraw.wasm');
				return new Response(new Uint8Array(await readFile(WASM)), { headers: { 'Content-Type': 'application/wasm' } });
			} });
			try { return await consume(); } finally {
				if (priorWorker) Object.defineProperty(globalThis, 'Worker', priorWorker); else Reflect.deleteProperty(globalThis, 'Worker');
				if (priorFetch) Object.defineProperty(globalThis, 'fetch', priorFetch); else Reflect.deleteProperty(globalThis, 'fetch');
				await workers.close();
			}
		},
	};
}
