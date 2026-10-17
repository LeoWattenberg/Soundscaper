/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createPhotoDevelopRenderRuntimeCurrentV1 } from '../src/lightscaper/photo-develop-render-runtime-current-v1.ts';
import { PhotoRasterExportCurrentV1 } from '../src/lightscaper/controller/photo-raster-export-current-v1.ts';
import { encodePhotoPngCurrentV1 } from '../src/common/editor/ui/lightscaper/photo-png-export-encoder-current-v1.ts';
import { repairRasterFixture } from './helpers/lightscaper-repair-raster-export-current-fixture.ts';
import { recoveryRasterFixture, recoveryPng8Samples, recoveryPng16Samples } from './helpers/lightscaper-raw-development-raster-export-fixture.ts';

// Independent CSS Color4 D65 two-matrix reference. Keep target clipping after
// both matrices so signed working samples can represent an in-gamut P3 color.
function expectedP3(red: number, green: number, blue: number, maximum: number) {
	const xyz = [
		506752 / 1228815 * red + 87881 / 245763 * green + 12673 / 70218 * blue,
		87098 / 409605 * red + 175762 / 245763 * green + 12673 / 175545 * blue,
		7918 / 409605 * red + 87881 / 737289 * green + 1001167 / 1053270 * blue,
	];
	const linear = [
		446124 / 178915 * xyz[0]! - 333277 / 357830 * xyz[1]! - 72051 / 178915 * xyz[2]!,
		-14852 / 17905 * xyz[0]! + 63121 / 35810 * xyz[1]! + 423 / 17905 * xyz[2]!,
		11844 / 330415 * xyz[0]! - 50337 / 660830 * xyz[1]! + 316169 / 330415 * xyz[2]!,
	];
	return linear.map(value => {
		const unit = Math.max(0, Math.min(1, value));
		return Math.round(maximum * (unit <= .0031308 ? 12.92 * unit : 1.055 * unit ** (1 / 2.4) - .055));
	});
}

function chunks(bytes: Uint8Array) {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), result: { type: string; bytes: number[] }[] = [];
	for (let offset = 8; offset < bytes.length;) {
		const size = view.getUint32(offset); assert.ok(offset + size + 12 <= bytes.length);
		result.push({ type: String.fromCharCode(...bytes.subarray(offset + 4, offset + 8)), bytes: [...bytes.subarray(offset + 8, offset + 8 + size)] });
		offset += size + 12;
	}
	return result;
}

for (const bitDepth of [8, 16] as const) for (const metadataScope of ['strip', 'capture'] as const) {
	test(`actual recovered RAW exports truthful P3 PNG${bitDepth}/${metadataScope} through the Current codec with unchanged custody`, async () => {
		const f = await recoveryRasterFixture(), owner = new PhotoRasterExportCurrentV1('png');
		const output = { schemaVersion: 3 as const, profile: 'display-p3' as const, bitDepth,
			sizing: { kind: 'original' as const }, quality: 'nearest' as const, metadataScope };
		let codecInput: string | undefined;
		try {
			const receipt = await owner.start({ ...f.request, output,
				readMetadata: async photoId => ({ catalogId: f.saved.catalogId, snapshot: await f.session.readMetadata(photoId) }),
				encode: async (frame, options) => {
					codecInput = frame.descriptor.sampleFormat;
					assert.equal(frame.descriptor.primaries, 'srgb'); assert.equal(frame.descriptor.transfer, 'linear');
					assert.equal(frame.descriptor.sampleFormat, 'float32', 'Native P3 conversion must precede the sRGB8 display boundary.');
					assert.equal(options.bitDepth, bitDepth); assert.equal(options.profile, 'display-p3');
					return encodePhotoPngCurrentV1(frame, options);
				} });
			assert.equal(receipt.status, 'download-started'); assert.equal(codecInput, 'float32');
			assert.equal(f.deliveries.length, 1); const delivered = f.deliveries[0]!;
			const png = (bitDepth === 8 ? recoveryPng8Samples : recoveryPng16Samples)(delivered.bytes);
			const maximum = bitDepth === 8 ? 255 : 65535, expected: number[] = [];
			for (let index = 0; index < f.floats.length; index += 4) {
				expected.push(...expectedP3(Math.fround(f.floats[index]! * .5), Math.fround(f.floats[index + 1]! * .5),
					Math.fround(f.floats[index + 2]! * .5), maximum), maximum);
			}
			assert.deepEqual(png.samples, expected);
			const color = chunks(delivered.bytes), names = color.map(value => value.type);
			assert.deepEqual(color.filter(value => value.type === 'cICP').map(value => value.bytes), [[12, 13, 0, 1]]);
			assert.equal(names.includes('sRGB'), false); assert.equal(names.includes('iCCP'), false);
			assert.ok(names.indexOf('cICP') < names.indexOf('IDAT'));
			assert.equal(names.includes('eXIf'), metadataScope === 'capture');
			await f.assertCustody();
		} finally { await owner.cancelAndJoin(); await f.close(); }
	});
}

test('P3 JPEG refuses before the Save picker, source borrowing or codec loading', async () => {
	const f = await recoveryRasterFixture(), owner = new PhotoRasterExportCurrentV1('jpeg');
	try {
		await assert.rejects(owner.start({ ...f.request, output: { schemaVersion: 3, profile: 'display-p3', bitDepth: 8,
			sizing: { kind: 'original' }, quality: 'nearest' } }), /P3|profile|JPEG|PNG/iu);
		assert.deepEqual(f.events, []); assert.equal(f.deliveries.length, 0); await f.assertCustody();
	} finally { await owner.cancelAndJoin(); await f.close(); }
});


test('P3 PNG8 retains byte Develop and converts only after repair, resize and output sharpening', async () => {
	const f = await repairRasterFixture(), owner = new PhotoRasterExportCurrentV1('png');
	const stages: number[][] = [], sources: string[] = [], runtime = createPhotoDevelopRenderRuntimeCurrentV1();
	try {
		const before = await f.inspect();
		for (const profile of ['srgb', 'display-p3'] as const) {
			await owner.start({ ...f.request(), output: { schemaVersion: 3, profile, bitDepth: 8,
				sizing: { kind: 'percentage', percentage: 200 }, quality: 'bilinear', sharpen: { amount: 27, threshold: 2 } },
				loadRenderer: async () => ({ withFullResolution: (request, consume) => {
					sources.push(request.frame.descriptor.sampleFormat); return runtime.withFullResolution(request, consume);
				} }),
				encode: async (frame, options) => {
					assert.equal(frame.descriptor.sampleFormat, 'unorm8'); assert.equal(frame.descriptor.primaries, 'srgb');
					assert.equal(frame.descriptor.transfer, 'srgb'); assert.equal(options.profile, profile); assert.equal(options.bitDepth, 8);
					assert.deepEqual([frame.descriptor.width, frame.descriptor.height], [6, 2]); stages.push([...frame.pixels]);
					return encodePhotoPngCurrentV1(frame, options);
				} });
		}
		assert.deepEqual(sources, ['unorm8', 'unorm8']); assert.deepEqual(stages[0], stages[1]);
		const srgb = recoveryPng8Samples(f.outputs[0]!.bytes), p3 = recoveryPng8Samples(f.outputs[1]!.bytes);
		assert.deepEqual(srgb.samples, stages[0]); const expected: number[] = [];
		const decode = (code: number) => code / 255 <= .04045 ? code / 255 / 12.92 : ((code / 255 + .055) / 1.055) ** 2.4;
		for (let index = 0; index < srgb.samples.length; index += 4) expected.push(...expectedP3(decode(srgb.samples[index]!),
			decode(srgb.samples[index + 1]!), decode(srgb.samples[index + 2]!), 255), srgb.samples[index + 3]!);
		assert.deepEqual(p3.samples, expected); assert.notDeepEqual(p3.samples, srgb.samples);
		assert.deepEqual(await f.inspect(), before);
	} finally { await owner.cancelAndJoin(); await f.close(); }
});

test('profiled Strip export refuses mismatched codec color declarations before publishing a file', async () => {
	const f = await repairRasterFixture(), owner = new PhotoRasterExportCurrentV1('png');
	try {
		const before = await f.inspect(), request = f.request();
		await assert.rejects(owner.start({ ...request, output: { schemaVersion: 3, profile: 'display-p3', bitDepth: 8,
			metadataScope: 'strip', sizing: { kind: 'original' }, quality: 'nearest' }, encode: async (frame, options) =>
			encodePhotoPngCurrentV1(frame, { ...options, profile: 'srgb' }) }), /metadata|profile|color|cICP|P3/iu);
		assert.equal(f.outputs.length, 0); assert.deepEqual(await f.inspect(), before);
	} finally { await owner.cancelAndJoin(); await f.close(); }
});
