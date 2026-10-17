/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { PhotoRasterExportCurrentV1 } from '../src/lightscaper/controller/photo-raster-export-current-v1.ts';
import { createPhotoDevelopRenderRuntimeCurrentV1 } from '../src/lightscaper/photo-develop-render-runtime-current-v1.ts';
import { defaultImageDevelopStateV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import { repairRasterFixture } from './helpers/lightscaper-repair-raster-export-current-fixture.ts';

test('captured codec cannot exceed the reduced native aggregate budget through an independent encoded allocation', async () => {
	const f = await repairRasterFixture(defaultImageDevelopStateV2(), [73, 74, 75, 255]), owner = new PhotoRasterExportCurrentV1('png');
	// A valid tiny subview with a large, sparsely touched borrowed backing
	// exercises physical accounting without decoding a huge photo or writing a
	// huge fixture. This controlled renderer boundary proves capacity only.
	const backing = new ArrayBuffer(958 * 1024 * 1024), pixels = new Float32Array(backing, 0, 4); pixels.set([.25, .5, .75, 1]);
	const frame = { descriptor: { schemaVersion: 1 as const, width: 1, height: 1, sampleFormat: 'float32' as const, primaries: 'srgb' as const, transfer: 'linear' as const }, pixels };
	const runtime = createPhotoDevelopRenderRuntimeCurrentV1({ source: f.session.cubeLuts.source, maskSource: f.session.maskRasterSource });
	let encoded: Uint8Array | undefined, maximum = 0;
	try {
		await assert.rejects(owner.start({ ...f.request(), output: { schemaVersion: 2, bitDepth: 16, sizing: { kind: 'original' }, quality: 'nearest' },
			loadRenderer: async () => ({ withFullResolution: (request, consume) => runtime.withFullResolution(request, view => consume({ ...view, frame })) }),
			encode: (_frame, options) => { maximum = options.maximumOutputBytes; assert.ok(maximum < 2 * 1024 * 1024 && maximum > 1024 * 1024);
				encoded = new Uint8Array(maximum + 1); encoded[0] = 77; return Promise.resolve(encoded as Uint8Array<ArrayBuffer>); },
		}), /bound|budget/iu);
		assert.ok(maximum > 0); assert.equal(f.outputs.length, 0); assert.ok(encoded?.every(value => value === 0));
		assert.deepEqual([...pixels], [.25, .5, .75, 1]); assert.deepEqual((await f.inspect())[0]!.bytes, f.bytes);
	} finally { await owner.cancelAndJoin(); await f.close(); }
});
