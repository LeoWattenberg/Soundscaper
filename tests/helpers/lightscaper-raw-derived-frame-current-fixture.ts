/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createFramescaperImageFramePackV1 } from '../../src/common/editor/timeline-image-frame-pack-v1.ts';
import { FRAMESCAPER_IMAGE_ASSET_MIME_TYPE, normalizeFramescaperImageSourceV1 } from '../../src/common/editor/timeline-image-model.ts';
import { FRAMESCAPER_RAW_DECODER_IDENTITY_V1 } from '../../src/common/editor/timeline-image-raw-receipt-v1.ts';
import { createImageDevelopHandoffProvenanceV2 } from '../../src/common/editor/image-develop-handoff-provenance-v2.ts';
import { defaultImageDevelopStateV2 } from '../../src/common/editor/imaging/image-develop-state-v2.ts';
import type { FramescaperRawImageDerivedPortsCurrentV1 } from '../../src/common/editor/timeline-image-raw-derived-current-v1.ts';
import type { RawRecoveryProfileV2 } from '../../src/common/editor/raw/libraw-runtime-v2.ts';
import { rawDerivedOriginalFixtureCurrentV1, rawDerivedOriginalNativeCurrentV1 } from './lightscaper-raw-derived-original-current-fixture.ts';
import type { RawRecoveryOrientationV1 } from './lightscaper-raw-recovery-dng-current-fixture.ts';

export async function rawDerivedFrameFixtureCurrentV1(orientation: RawRecoveryOrientationV1 = 1) {
	const original = rawDerivedOriginalFixtureCurrentV1(orientation), native = await rawDerivedOriginalNativeCurrentV1();
	try {
		const canonical = await native.ports.withRawFrame!({ bytes: original.bytes }, view => ({
			descriptor: { ...view.frame.descriptor, primaries: 'srgb' as const, transfer: 'linear' as const }, rawFlip: view.rawFlip, words: Array.from(view.frame.pixels),
		}));
		const serialized = new Uint8Array(canonical.words.length * 2), wordView = new DataView(serialized.buffer);
		for (const [index, value] of canonical.words.entries()) wordView.setUint16(index * 2, value);
		const pixelsSha256 = createHash('sha256').update(serialized).digest('hex'); serialized.fill(0);
		const raw = { schemaVersion: 1 as const, decoder: FRAMESCAPER_RAW_DECODER_IDENTITY_V1, descriptor: canonical.descriptor,
			rawFlip: canonical.rawFlip, pixelEncoding: 'rgba16be' as const, pixelsSha256 };
		const ports: FramescaperRawImageDerivedPortsCurrentV1 = {
			withRawOriginal(value, consume) { assert.equal(this, ports); return native.ports.withRawFrame!(value, consume); },
			withRecoveryFrame(value, consume) { assert.equal(this, ports); return native.ports.withRecoveryFrame!(value, consume); },
		};
		const { width, height } = canonical.descriptor;
		function body(cacheCode: number, rawValue = raw) {
			const cache = new Uint8Array(width * height * 4).fill(cacheCode);
			for (let at = 3; at < cache.length; at += 4) cache[at] = 255;
			const pack = createFramescaperImageFramePackV1({ original: original.bytes, receipt: { schemaVersion: 1, kind: 'raw-original', raw: rawValue },
				width, height, timingMode: 'fallback', frames: [{ presentationTicks: 0n, durationTicks: 5_000_000n, rgba: cache }] });
			const source = normalizeFramescaperImageSourceV1({ schemaVersion: 1, kind: 'image', id: 'derived-frame', storageKey: 'derived-frame',
				name: 'Derived native RAW', mimeType: FRAMESCAPER_IMAGE_ASSET_MIME_TYPE, contentSha256: pack.contentSha256, assetByteLength: pack.assetByteLength,
				conversionReceiptSha256: pack.conversionReceiptSha256, original: { fileName: 'Recovery.dng', mimeType: 'image/x-adobe-dng',
					recognizedFormat: 'dng', byteLength: original.bytes.length, sha256: pack.originalSha256 },
				canonical: { width, height, hasAlpha: false, frameCount: 1, durationTicks: pack.durationTicks, timingMode: 'fallback' } });
			return { pack, cache, binding: { pack: source, raw: rawValue } };
		}
		const encoded = body(17), hooks = { current: async (): Promise<void> => undefined }, ranges: Uint8Array[] = [];
		function request(profile: RawRecoveryProfileV2 = 'highlight-recovery-v1', selected = encoded, signal?: AbortSignal) {
			const value = { binding: selected.binding, profile, ...(signal ? { signal } : {}),
				read(offset: number, length: number) {
					assert.equal(this, value); const bytes = selected.pack.bytes.subarray(offset, offset + length); ranges.push(bytes); return bytes;
				}, async assertCurrent() { assert.equal(this, value); await hooks.current(); },
			}; return value;
		}
		const develop = defaultImageDevelopStateV2(), provenance = createImageDevelopHandoffProvenanceV2({
			original: { exactName: 'Recovery.dng', sha256: encoded.pack.originalSha256, byteLength: original.bytes.length }, develop,
			origin: { schemaFamily: 'lightscaper', schemaVersion: 3, catalogId: 'derived-catalog', photoId: 'derived-photo', revision: 3,
				versionId: 'derived-master', versionKind: 'master', versionName: 'Master', versionCreatedAt: '2026-10-01T00:00:00.000Z' },
		});
		native.inputs.length = 0; native.events.length = 0;
		return { ...encoded, original: original.bytes, canonical, raw, native, ports, hooks, ranges, body, request,
			source: { ...encoded.binding.pack, schemaVersion: 4 as const, raw, develop, developed: { width, height }, provenance }, close: native.close };
	} catch (error) { await native.close(); throw error; }
}
