/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { crc32 } from 'node:zlib';
import { PhotoRasterExportCurrentV1 } from '../src/lightscaper/controller/photo-raster-export-current-v1.ts';
import type { ImageExportSizingV1 } from '../src/common/editor/imaging/image-export-size-v1.ts';
import { readImageMetadataV1 } from '../src/common/editor/imaging/image-metadata-reader-v1.ts';
import { decodePng } from './helpers/lightscaper-repair-raster-export-current-fixture.ts';
import { MATRIX_ORIGINAL_RGBA, rasterExportMatrixFixture, type MatrixFormat } from './helpers/lightscaper-raster-export-matrix-current-fixture.ts';

// Literal nearest-neighbor outcomes for the independently specified Clone then
// horizontal flip: [black, red, red] / [yellow, white, green]. No production
// sizing, resampler, renderer or encoder computes these expectations.
const COLORS: Readonly<Record<string, readonly number[]>> = {
	K: [0, 0, 0, 255], R: [255, 0, 0, 255], Y: [255, 255, 0, 255], W: [255, 255, 255, 255], G: [0, 255, 0, 255],
};
const SIZES: readonly Readonly<{ sizing: ImageExportSizingV1; width: number; height: number; rows: readonly string[] }>[] = [
	{ sizing: { kind: 'original' }, width: 3, height: 2, rows: ['KRR', 'YWG'] },
	{ sizing: { kind: 'fit', width: 2, height: 3, allowUpscale: false }, width: 2, height: 1, rows: ['KR'] },
	{ sizing: { kind: 'long-edge', pixels: 6, allowUpscale: true }, width: 6, height: 4, rows: ['KKRRRR', 'KKRRRR', 'YYWWGG', 'YYWWGG'] },
	{ sizing: { kind: 'megapixels', megapixels: .000_002, allowUpscale: false }, width: 1, height: 1, rows: ['K'] },
	{ sizing: { kind: 'percentage', percentage: 150 }, width: 5, height: 3, rows: ['KKRRR', 'KKRRR', 'YYWWG'] },
];
function expectedPixels(rows: readonly string[]): number[] {
	return rows.flatMap(row => [...row].flatMap(key => { const rgba = COLORS[key]; assert.ok(rgba); return [...rgba]; }));
}

interface Artifact {
	readonly width: number;
	readonly height: number;
	readonly tiff: Uint8Array | null;
	readonly imageParts: readonly unknown[];
}

/** Bounded, independent format framing. JPEG entropy is deliberately opaque:
 * Node's modeled canvas proves adapter input/metadata composition, not codec
 * decoding. PNG's real delivered bytes are also independently inflated. */
function inspectArtifact(format: MatrixFormat, bytes: Uint8Array): Artifact {
	assert.ok(bytes.length > 32 && bytes.length < 16_384);
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), imageParts: unknown[] = [];
	let width = 0, height = 0, tiff: Uint8Array | null = null;
	if (format === 'png') {
		assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
		let offset = 8;
		while (offset < bytes.length) {
			assert.ok(offset + 12 <= bytes.length); const size = view.getUint32(offset), end = offset + size + 12;
			assert.ok(end <= bytes.length); assert.equal(view.getUint32(end - 4), crc32(bytes.subarray(offset + 4, end - 4)));
			const kind = Buffer.from(bytes.subarray(offset + 4, offset + 8)).toString('ascii'), body = bytes.slice(offset + 8, end - 4);
			assert.ok(['IHDR', 'sRGB', 'eXIf', 'IDAT', 'IEND'].includes(kind));
			if (kind === 'IHDR') { assert.equal(offset, 8); assert.equal(size, 13); width = view.getUint32(offset + 8); height = view.getUint32(offset + 12); }
			if (kind === 'eXIf') { assert.equal(tiff, null); tiff = body; } else imageParts.push({ kind, body: [...body] });
			if (kind === 'IEND') { assert.equal(size, 0); assert.equal(end, bytes.length); }
			offset = end;
		}
		assert.equal(offset, bytes.length);
	} else {
		assert.deepEqual([...bytes.subarray(0, 2)], [255, 216]); assert.deepEqual([...bytes.subarray(-2)], [255, 217]);
		let offset = 2, scan = false;
		while (offset < bytes.length - 2) {
			assert.equal(bytes[offset], 255); const marker = bytes[offset + 1]!;
			const size = view.getUint16(offset + 2), end = offset + size + 2;
			assert.ok(size >= 2 && end <= bytes.length - 2); const body = bytes.slice(offset + 4, end);
			if (marker === 225) { assert.equal(tiff, null); assert.deepEqual([...body.subarray(0, 6)], [69, 120, 105, 102, 0, 0]); tiff = body.slice(6); }
			else imageParts.push({ marker, body: [...body] });
			if (marker === 192) { assert.equal(body[0], 8); height = view.getUint16(offset + 5); width = view.getUint16(offset + 7); }
			if (marker === 218) { imageParts.push({ entropy: [...bytes.subarray(end)] }); scan = true; break; }
			offset = end;
		}
		assert.equal(scan, true);
	}
	assert.ok(width > 0 && height > 0); return { width, height, tiff, imageParts };
}

/** Independent classic-TIFF field read, limited to this small export witness. */
function readTiff(tiff: Uint8Array) {
	assert.deepEqual([...tiff.subarray(0, 8)], [73, 73, 42, 0, 8, 0, 0, 0]);
	const view = new DataView(tiff.buffer, tiff.byteOffset, tiff.byteLength);
	function directory(offset: number) {
		assert.ok(offset >= 8 && offset + 2 <= tiff.length); const count = view.getUint16(offset, true), fields = new Map<number, { type: number; count: number; bytes: Uint8Array }>();
		assert.ok(count > 0 && count <= 32 && offset + 2 + count * 12 + 4 <= tiff.length);
		for (let index = 0; index < count; index++) {
			const at = offset + 2 + index * 12, tag = view.getUint16(at, true), type = view.getUint16(at + 2, true), count = view.getUint32(at + 4, true);
			const unit = type === 3 ? 2 : type === 4 ? 4 : type === 5 ? 8 : type === 2 || type === 7 ? 1 : 0;
			assert.ok(unit > 0 && count > 0 && count <= 1024); const size = count * unit, start = size <= 4 ? at + 8 : view.getUint32(at + 8, true);
			assert.ok(start >= 8 && start + size <= tiff.length); assert.equal(fields.has(tag), false); fields.set(tag, { type, count, bytes: tiff.slice(start, start + size) });
		}
		assert.equal(view.getUint32(offset + 2 + count * 12, true), 0); return fields;
	}
	const root = directory(8);
	function integer(fields: ReturnType<typeof directory>, tag: number): number {
		const field = fields.get(tag); assert.ok(field); assert.equal(field.count, 1); assert.ok(field.type === 3 || field.type === 4);
		const data = new DataView(field.bytes.buffer, field.bytes.byteOffset, field.bytes.byteLength);
		return field.type === 3 ? data.getUint16(0, true) : data.getUint32(0, true);
	}
	const exif = directory(integer(root, 0x8769));
	function ascii(fields: ReturnType<typeof directory>, tag: number): string {
		const field = fields.get(tag); assert.ok(field); assert.equal(field.type, 2); assert.equal(field.bytes.at(-1), 0);
		return new TextDecoder('ascii').decode(field.bytes.subarray(0, -1));
	}
	return { root, exif, integer, ascii };
}

for (const format of ['png', 'jpeg'] as const) for (const size of SIZES) {
	for (const metadataScope of ['capture', 'strip'] as const) for (const sidecarEnabled of [false, true]) {
		test(`Current repaired ${format} ${size.sizing.kind}: ${metadataScope} metadata, sidecar ${sidecarEnabled ? 'on' : 'off'}`, async () => {
			const f = await rasterExportMatrixFixture(), owner = new PhotoRasterExportCurrentV1(format);
			try {
				const before = await f.inspect(); assert.equal(before.photo.schemaVersion, 3);
				assert.equal(before.roots.length, 1); assert.deepEqual(before.bytes, f.bytes);
				assert.deepEqual([...decodePng(before.bytes).pixels], MATRIX_ORIGINAL_RGBA);
				assert.equal(createHash('sha256').update(before.bytes).digest('hex'), before.photo.original.contentSha256);
				const request = { ...f.request(format), output: { sizing: size.sizing, quality: 'nearest' as const, metadataScope },
					...(sidecarEnabled ? { sidecar: { read: f.readSidecar } } : {}) };
				const pending = owner.start(request); assert.deepEqual(f.events, ['picker']); const receipt = await pending;
				assert.ok(receipt.status !== 'cancelled'); assert.equal(receipt.status, 'download-started');
				assert.deepEqual([receipt.photoId, receipt.versionId, receipt.revision], [f.photo.id, f.photo.activeVersionId, f.photo.revision]);
				assert.deepEqual([receipt.width, receipt.height], [size.width, size.height]);
				const raster = f.outputs[0]!; assert.equal(f.outputs.length, sidecarEnabled ? 2 : 1);
				assert.equal(raster.name, `Picked matrix.${format === 'png' ? 'png' : 'jpg'}`);
				assert.equal(raster.mimeType, format === 'png' ? 'image/png' : 'image/jpeg');
				assert.equal(receipt.fileName, raster.name); assert.equal(receipt.byteLength, raster.bytes.length);
				const artifact = inspectArtifact(format, raster.bytes), fresh = inspectArtifact(format, f.fresh[0]!);
				assert.deepEqual([artifact.width, artifact.height], [size.width, size.height]);
				assert.deepEqual(artifact.imageParts, fresh.imageParts, 'Metadata composition must preserve all fresh image payload bytes.');
				const pixels = expectedPixels(size.rows); assert.equal(pixels.length, size.width * size.height * 4);
				if (format === 'png') {
					const decoded = decodePng(raster.bytes); assert.deepEqual([decoded.width, decoded.height], [size.width, size.height]);
					assert.deepEqual([...decoded.pixels], pixels); assert.deepEqual(f.codecs.jpegInputs, []);
				} else assert.deepEqual(f.codecs.jpegInputs, [{ width: size.width, height: size.height, pixels }]);
				const facts = readImageMetadataV1(raster.bytes); assert.deepEqual(facts.issues, []);
				assert.equal(f.events.filter(event => event === 'metadata').length, metadataScope === 'capture' ? 1 : 0);
				if (metadataScope === 'capture') {
					assert.ok(artifact.tiff); const fields = readTiff(artifact.tiff);
					assert.equal(fields.integer(fields.root, 0x0112), 1);
					assert.deepEqual([fields.integer(fields.exif, 0xa002), fields.integer(fields.exif, 0xa003)], [size.width, size.height]);
					assert.equal(fields.ascii(fields.root, 0x010f), 'Matrix camera'); assert.equal(fields.ascii(fields.root, 0x0110), 'Native facts');
					assert.equal(fields.ascii(fields.exif, 0xa434), 'Matrix lens');
					assert.equal(fields.root.has(0x013b), false); assert.equal(fields.root.has(0x010e), false); assert.equal(fields.root.has(0x8298), false);
					assert.equal(facts.exif?.cameraMake, 'Matrix camera'); assert.equal(facts.exif?.orientation, 1);
					assert.equal(facts.exif?.iso, 200); assert.equal(facts.exif?.exposureSeconds, 1 / 125); assert.equal(facts.exif?.aperture, 4);
					assert.equal(facts.exif?.artist, null); assert.equal(facts.exif?.description, null);
				} else { assert.equal(artifact.tiff, null); assert.equal(facts.exif, null); assert.deepEqual(raster.bytes, f.fresh[0]); }
				if (sidecarEnabled) {
					assert.equal(receipt.sidecar?.status, 'download-started'); assert.equal(f.events.filter(event => event === 'sidecar-read').length, 2);
					const sidecar = f.outputs[1]!, version = f.photo.versions[0]!;
					assert.equal(sidecar.mimeType, 'application/json'); assert.equal(sidecar.name, `${raster.name}.lightscaper.json`);
					const value: unknown = JSON.parse(new TextDecoder().decode(sidecar.bytes));
					assert.deepEqual(value, { schemaFamily: 'lightscaper', schemaVersion: 2, kind: 'photo-export-sidecar', photoSchemaVersion: 3,
						binding: { catalogId: f.photo.catalogId, photoId: f.photo.id, revision: f.photo.revision, activeVersionId: f.photo.activeVersionId },
						original: { fileName: f.photo.original.name, contentSha256: f.photo.original.contentSha256, byteLength: f.photo.original.byteLength },
						version: { id: version.id, kind: version.kind, name: version.name, createdAt: version.createdAt, develop: version.develop },
						metadata: f.photo.metadata, extractedMetadata: f.photo.extractedMetadata });
					assert.ok(f.events.indexOf('sidecar-download') > f.events.indexOf('raster-download'));
				} else { assert.equal(receipt.sidecar, undefined); assert.equal(f.events.includes('sidecar-read'), false); }
				assert.ok(f.events.indexOf('raster-download') > f.events.indexOf('original-settled'));
				assert.equal(f.codecs.calls.opens, 1); assert.equal(f.codecs.calls.closes, 1);
				assert.equal(f.borrowed.length, 1); assert.ok(f.borrowed.every(bytes => bytes.every(value => value === 0)));
				assert.equal(f.encoded.length, 1); assert.ok(f.encoded.every(bytes => bytes.every(value => value === 0)));
				assert.ok(f.codecs.decoded.every(bytes => bytes.every(value => value === 0)));
				assert.deepEqual(await f.inspect(), before, 'Export must preserve the complete Photo3, Original bytes, media metadata and custody roots.');
			} finally { await owner.cancelAndJoin(); await f.close(); }
		});
	}
}
