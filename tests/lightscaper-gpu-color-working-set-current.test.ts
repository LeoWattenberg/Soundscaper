/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { preparePixelFrameWebGl2ColorsCurrentV1 } from '../src/common/editor/imaging/pixel-frame-webgl2-color-current-v1.ts';
import { preparePixelFrameWebGl2GlobalsCurrentV1 } from '../src/common/editor/imaging/pixel-frame-webgl2-global-current-v1.ts';
import { planPixelFrameWebGl2CurrentV1 } from '../src/common/editor/imaging/pixel-frame-webgl2-current-v1.ts';
import { createPhotoDevelopRenderRuntimeCurrentV1 } from '../src/lightscaper/photo-develop-render-runtime-current-v1.ts';
import { defaultImageDevelopStateV2, normalizeImageDevelopStateV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import type { PixelFrameV1 } from '../src/common/editor/imaging/pixel-frame-contract-v1.ts';

test('extended uniforms reserve their bounded host/driver phase before samples; existing global plans remain unchanged', () => {
	let reads = 0;
	const frame = { descriptor: { schemaVersion: 1, width: 2048, height: 2048, sampleFormat: 'unorm16', primaries: 'srgb', transfer: 'linear' },
		get pixels(): never { reads++; throw new Error('Scalar working admission cannot borrow pixels.'); } };
	const extended = preparePixelFrameWebGl2ColorsCurrentV1([{ id: 'chroma', type: 'chroma-v1', enabled: true, params: { saturation: 25 } }]);
	const global = preparePixelFrameWebGl2GlobalsCurrentV1([{ id: 'warm', type: 'white-balance-v1', enabled: true, params: { temperature: 100 } }]);
	const a = planPixelFrameWebGl2CurrentV1({ frame, passes: extended }), b = planPixelFrameWebGl2CurrentV1({ frame, passes: global });
	assert.equal(a.gpuWorkingBytes, 32 * 1024 ** 2 + 4 * 64 * 1024 ** 2 + 4096);
	assert.equal(b.gpuWorkingBytes, 32 * 1024 ** 2 + 4 * 64 * 1024 ** 2);
	assert.equal(reads, 0);
});

for (const [resolution, physicalMiB] of [['proxy', 448], ['full', 480]] as const) test(`GPU ${resolution} charges extended uniform staging beside a padded Original before choosing a complete CPU fallback`, async () => {
	const backing = new ArrayBuffer(physicalMiB * 1024 ** 2), pixels = new Uint16Array(backing, 0, 2048 * 2048 * 4);
	pixels.set([16384, 32768, 65535, 65535]);
	const source: PixelFrameV1 = { descriptor: { schemaVersion: 1, width: 2048, height: 2048, sampleFormat: 'unorm16', primaries: 'srgb', transfer: 'linear' }, pixels };
	const develop = normalizeImageDevelopStateV2({ ...defaultImageDevelopStateV2(), effects: [{ id: 'chroma', type: 'chroma-v1', enabled: true, params: { saturation: 25 } }] });
	const request = { frame: source, develop, signal: new AbortController().signal }, runtime = createPhotoDevelopRenderRuntimeCurrentV1();
	const expected = await (resolution === 'proxy' ? runtime.withProxy(request, view => [...view.frame.pixels.subarray(0, 4)])
		: runtime.withFullResolution(request, view => [...view.frame.pixels.subarray(0, 4)]));
	let calls = 0;
	const actual = await runtime.withGpuPreview(resolution, request, view => {
		calls++; assert.equal(view.execution.backend, 'cpu'); assert.equal(view.execution.reason, 'working-set');
		return [...view.frame.pixels.subarray(0, 4)];
	});
	assert.equal(calls, 1); assert.deepEqual(actual, expected); assert.deepEqual([...pixels.subarray(0, 4)], [16384, 32768, 65535, 65535]);
});
