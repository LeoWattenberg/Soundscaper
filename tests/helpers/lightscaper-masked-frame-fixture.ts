/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { defaultImageDevelopStateV2 } from '../../src/common/editor/imaging/image-develop-state-v2.ts';
import type { CubeLutSourcePortV1 } from '../../src/common/editor/imaging/cube-lut-source-port-v1.ts';
import { createFramescaperImageFramePackV1 } from '../../src/common/editor/timeline-image-frame-pack-v1.ts';
import { FRAMESCAPER_IMAGE_ASSET_MIME_TYPE } from '../../src/common/editor/timeline-image-model.ts';
import { createImageDevelopHandoffProvenanceV1 } from '../../src/common/editor/image-develop-handoff-provenance-v1.ts';

export const SOURCE_RGBA = [64, 128, 192, 0, 64, 128, 192, 1, 64, 128, 192, 127, 64, 128, 192, 255] as const;
export const LUT_BODY = new TextEncoder().encode(`LUT_3D_SIZE 2\n${Array.from({ length: 8 }, () => '0.25 0 0\n').join('')}`);
const sha = createHash('sha256').update(LUT_BODY).digest('hex');
export const LUT_REFERENCE = Object.freeze({ storageKey: `lut-sha256:${sha}`, sha256: sha, byteLength: LUT_BODY.byteLength,
	size: 2, domainMin: [0, 0, 0] as const, domainMax: [1, 1, 1] as const });

export function gradientGraph(start = { x: 0, y: 0 }, end = { x: 1, y: 0 }) {
	return { schemaVersion: 1, id: 'mask', kind: 'mask', inputs: [],
		nodes: [{ id: 'gradient', kind: 'linear-gradient', start: { ...start }, end: { ...end } }], outputNodeId: 'gradient' };
}
export function rectangleGraph(x = 0.5, width = 0.5) {
	return { schemaVersion: 1, id: 'mask', kind: 'mask', inputs: [],
		nodes: [{ id: 'shape', kind: 'vector-shape', shape: 'rectangle', x, y: 0, width, height: 1 }], outputNodeId: 'shape' };
}
export function maskedDevelop(effects: readonly Readonly<{ id: string }>[], mask: unknown = gradientGraph(), ids = effects.map(effect => effect.id)) {
	return { ...defaultImageDevelopStateV2(), effects, masks: [mask], maskBindings: ids.map(effectId => ({ effectId, maskId: 'mask' })) };
}
export function rgbaFrame(pixels: readonly number[] = SOURCE_RGBA) {
	return { descriptor: { schemaVersion: 1 as const, width: pixels.length / 4, height: 1,
		sampleFormat: 'unorm8' as const, primaries: 'srgb' as const, transfer: 'srgb' as const }, pixels: new Uint8Array(pixels) };
}
export function profile(enabled = true) { return { id: 'profile', type: 'cube-lut-profile-v1', enabled, params: { lut: LUT_REFERENCE } }; }
export function lutSource() {
	let calls = 0;
	const port: CubeLutSourcePortV1 = { async withBytes(reference, consume) {
		assert.equal(this, port); assert.deepEqual(reference, LUT_REFERENCE); calls++; return consume(LUT_BODY);
	} };
	return { port, calls: () => calls };
}

/** A real static pack/source/read boundary; the literal plane has no decoder substitute. */
export function frameImageFixture(develop: unknown, pixels: readonly number[] = SOURCE_RGBA) {
	const original = new TextEncoder().encode('exact original retained by the masked Frame fixture');
	const width = pixels.length / 4;
	const pack = createFramescaperImageFramePackV1({ original, receipt: { schemaVersion: 1, orientation: 1,
		decoder: { id: 'browser-native', version: '1' } }, width, height: 1, timingMode: 'fallback',
		frames: [{ presentationTicks: 0n, durationTicks: 1_000_000n, rgba: new Uint8Array(pixels) }] });
	const provenance = createImageDevelopHandoffProvenanceV1({ original: { exactName: 'Original.png', sha256: pack.originalSha256,
		byteLength: original.byteLength }, develop, origin: { schemaFamily: 'lightscaper', schemaVersion: 2,
		catalogId: 'catalog', photoId: 'photo', revision: 7, versionId: 'master', versionKind: 'master',
		versionName: 'Original', versionCreatedAt: '2026-10-01T00:00:00.000Z' } });
	const source = { schemaVersion: 2, kind: 'image', id: 'source', name: 'Photo', storageKey: 'source',
		mimeType: FRAMESCAPER_IMAGE_ASSET_MIME_TYPE, assetByteLength: pack.assetByteLength,
		contentSha256: pack.contentSha256, conversionReceiptSha256: pack.conversionReceiptSha256,
		original: { fileName: 'Original.png', mimeType: 'image/png', recognizedFormat: 'png', byteLength: original.byteLength, sha256: pack.originalSha256 },
		canonical: { width, height: 1, hasAlpha: pixels.some((value, index) => index % 4 === 3 && value !== 255),
			frameCount: 1, durationTicks: pack.durationTicks, timingMode: 'fallback' }, develop, developed: { width, height: 1 }, provenance };
	let reads = 0;
	const request = { source, read(offset: number, length: number) { assert.equal(this, request); reads++; return pack.bytes.slice(offset, offset + length); } };
	return { request, original, pack, reads: () => reads };
}
