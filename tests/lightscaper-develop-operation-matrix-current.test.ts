/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createVideoEffectV2 } from '../src/common/editor/video-effects-v2.ts';
import type { VideoEffectParameterV2 } from '../src/common/editor/video-effect-parameter-v2.ts';
import { defaultImageDevelopStateV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import { normalizeImageDevelopStateCurrentV1 } from '../src/common/editor/imaging/image-develop-state-current-v1.ts';
import { createFramescaperImageFramePackV1 } from '../src/common/editor/timeline-image-frame-pack-v1.ts';
import { createImageDevelopHandoffProvenanceV2 } from '../src/common/editor/image-develop-handoff-provenance-v2.ts';
import { FRAMESCAPER_IMAGE_ASSET_MIME_TYPE } from '../src/common/editor/timeline-image-model.ts';
import { withFramescaperImageDevelopFrameV3 } from '../src/framescaper/timeline-image-develop-frame-v3.ts';
import { PhotoRasterExportCurrentV1 as PhotoRasterExport } from '../src/lightscaper/controller/photo-raster-export-current-v1.ts';
import { decodePng, repairRasterFixture, type RepairRasterRequest } from './helpers/lightscaper-repair-raster-export-current-fixture.ts';
import { LUT_BODY, LUT_REFERENCE } from './helpers/lightscaper-masked-frame-fixture.ts';

// Each operation is active. Family-specific numeric goldens remain in the
// owning reference tests; this matrix checks the independently wired hosts.
const OPERATIONS: readonly (readonly [string, Readonly<Record<string, VideoEffectParameterV2>>])[] = [
	['white-balance-v1', { temperature: 31, tint: -17 }],
	['tone-ladder-v1', { exposure: 0.75, contrast: 19, shadows: 23, highlights: -11, whites: 9, blacks: -13 }],
	['chroma-v1', { saturation: -21, vibrance: 37 }],
	['texture-v1', { amount: 67 }], ['clarity-v1', { amount: -41 }], ['dehaze-v1', { amount: 37 }],
	['point-curves-v1', { master: [{ x: 0, y: 0.1 }, { x: 0.5, y: 0.7 }, { x: 1, y: 0.9 }] }],
	['parametric-curves-v1', { masterShadows: 23, redLights: -31, blueHighlights: 17 }],
	['hsl-mixer-v1', { redHue: 27, greenSaturation: -37, blueLuminance: 41 }],
	['black-white-mix-v1', { red: 23, blue: -37 }],
	['color-wheels-v1', { shadowsHue: -140, shadowsSaturation: 43, midtonesLuminance: 17 }],
	['detail-sharpen-v1', { amount: 137, threshold: 3 }],
	['noise-reduction-v1', { luminance: 67, color: 43 }],
	['post-crop-vignette-v1', { amount: -63, midpoint: 37, feather: 67 }],
	['grain-v1', { amount: 73, size: 1.5, roughness: 31, seed: 417 }],
	['develop-geometry-v1', { cropWidth: 0.75, flipHorizontal: 1, rotationDegrees: 90 }],
	['cube-lut-profile-v1', { lut: LUT_REFERENCE }],
];
const PIXELS = Array.from({ length: 16 }, (_, n) => n === 0 ? [0, 0, 0, 0]
	: [23 + n % 4 * 60, 17 + Math.floor(n / 4) * 55, (n * 37 + 41) % 256, n === 3 ? 1 : n === 11 ? 127 : 255]).flat();
const CLOCK = '2026-10-15T12:00:00.000Z';

function start(owner: PhotoRasterExport, request: RepairRasterRequest) {
	return Reflect.apply(owner.start, owner, [request]) as ReturnType<PhotoRasterExport['start']>;
}

for (const processVersion of [1, 2, 3] as const) for (const [type, params] of OPERATIONS) {
	if (processVersion === 1 && type === 'cube-lut-profile-v1') continue;
	test(`process${processVersion} ${type}: persisted native preview, full resolution, PNG delivery and Frame pack agree`, async () => {
		const f = await repairRasterFixture(undefined, PIXELS, 1, 4), owner = new PhotoRasterExport('png');
		try {
			if (type === 'cube-lut-profile-v1') {
				assert.deepEqual((await f.session.cubeLuts!.importFile(new Blob([LUT_BODY]))).reference, LUT_REFERENCE);
			}
			const effect = createVideoEffectV2(type, { id: 'active', params });
			const develop = normalizeImageDevelopStateCurrentV1({ ...defaultImageDevelopStateV2(), processVersion, effects: [effect],
				...(processVersion === 3 ? { repairs: { schemaVersion: 1, spots: [{ id: 'clone', mode: 'clone', enabled: true,
					 target: { x: 0.375, y: 0.375 }, source: { x: 0.125, y: 0.375 }, radius: 0.1, feather: 0, opacity: 1 }] } } : {}) });
			await f.changeRecipe(develop);
			const before = await f.inspect(), photo = before[0]!.photo;
			const snapshot = await f.session.develop.read({ schemaVersion: 3, photoId: photo.id });
			assert.deepEqual(snapshot.develop, develop);
			const render = (full: boolean) => f.session.develop.original!.withFrame({ schemaVersion: 1, photoId: photo.id, expectedRevision: photo.revision },
				view => (full ? f.runtime.withFullResolution : f.runtime.withProxy)({ frame: view.frame, develop: snapshot.develop,
					signal: new AbortController().signal }, result => ({ descriptor: result.frame.descriptor, pixels: [...result.frame.pixels] })));
			const preview = await render(false);
			assert.deepEqual(await render(false), preview, 'Repeated rendering must be deterministic');
			assert.deepEqual(await render(true), preview, 'Full resolution and same-size preview must be byte equal');
			if (processVersion === 3) {
				// Independent original-space clone: the target is cell(1,1), its
				// donor cell(0,1), and radius0.4px reaches no other pixel center.
				const repaired = Uint8Array.from(PIXELS); repaired.set(PIXELS.slice(16, 20), 20);
				const expected = await f.runtime.withProxy({ frame: { descriptor: { schemaVersion: 1, width: 4, height: 4,
					sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' }, pixels: repaired },
					develop: { ...defaultImageDevelopStateV2(), effects: [effect] }, signal: new AbortController().signal },
					view => [...view.frame.pixels]);
				assert.deepEqual(preview.pixels, expected, 'Repairs must precede every authored operation without changing its process2 semantics');
			}
			assert.notDeepEqual(preview.pixels, PIXELS, 'Every matrix operation must exercise an active pixel or geometry path');
			const receipt = await start(owner, f.request());
			assert.equal(receipt.status, 'download-started');
			const exported = decodePng(f.outputs[0]!.bytes);
			assert.deepEqual([exported.width, exported.height], [preview.descriptor.width, preview.descriptor.height]);
			assert.deepEqual([...exported.pixels], preview.pixels, 'Lossless export must retain developed pixels');
			const pack = createFramescaperImageFramePackV1({ original: f.bytes, receipt: { schemaVersion: 1, orientation: 1,
				decoder: { id: 'browser-native', version: '1' } }, width: 4, height: 4, timingMode: 'fallback',
				frames: [{ presentationTicks: 0n, durationTicks: 1_000_000n, rgba: Uint8Array.from(PIXELS) }] });
			const provenance = createImageDevelopHandoffProvenanceV2({ original: { exactName: 'Original.png', sha256: pack.originalSha256,
				byteLength: f.bytes.byteLength }, develop, origin: { schemaFamily: 'lightscaper', schemaVersion: 3, catalogId: photo.catalogId,
				photoId: photo.id, revision: photo.revision, versionId: photo.activeVersionId, versionKind: 'master', versionName: 'Original', versionCreatedAt: CLOCK } });
			const source = { schemaVersion: 3, kind: 'image', id: 'source', name: 'Current Photo', storageKey: 'source',
				mimeType: FRAMESCAPER_IMAGE_ASSET_MIME_TYPE, assetByteLength: pack.assetByteLength, contentSha256: pack.contentSha256,
				conversionReceiptSha256: pack.conversionReceiptSha256,
				original: { fileName: 'Original.png', mimeType: 'image/png', recognizedFormat: 'png', byteLength: f.bytes.byteLength, sha256: pack.originalSha256 },
				canonical: { width: 4, height: 4, hasAlpha: true, frameCount: 1, durationTicks: pack.durationTicks, timingMode: 'fallback' },
				develop, developed: { width: preview.descriptor.width, height: preview.descriptor.height }, provenance };
			const packedBefore = pack.bytes.slice();
			const frame = await withFramescaperImageDevelopFrameV3({ source, read: (offset: number, length: number) => pack.bytes.slice(offset, offset + length) },
				view => ({ descriptor: view.frame.descriptor, pixels: [...view.frame.pixels] }), { source: f.session.cubeLuts!.source });
			assert.deepEqual(frame, preview, 'The Frame adapter must evaluate the identical saved process without flattening it');
			assert.deepEqual(pack.bytes, packedBefore);
			assert.deepEqual(await f.inspect(), before, 'All paths must preserve original bytes and the full saved catalog row');
			assert.ok(f.encoded.every(bytes => bytes.every(byte => byte === 0)));
		} finally { await owner.cancelAndJoin(); await f.close(); }
	});
}
