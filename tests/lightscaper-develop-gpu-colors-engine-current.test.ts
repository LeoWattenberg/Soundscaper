/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { withImageDevelopGpuCurrentV1 } from '../src/common/editor/imaging/image-develop-gpu-current-v1.ts';
import { withImageDevelopLinearCurrentV1 } from '../src/common/editor/imaging/image-develop-linear-current-v1.ts';
import { normalizeImageDevelopStateCurrentV1 } from '../src/common/editor/imaging/image-develop-state-current-v1.ts';
import { defaultImageDevelopStateV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import { PHOTO_DEVELOP_LINEAR_LIMITS_V1 as PROFILE } from '../src/common/editor/photo-library-develop-linear-port-v1.ts';
import { createVideoEffect } from '../src/common/editor/video-effects.js';

const families = [
	['chroma-v1', { saturation: 25, vibrance: -10 }],
	['black-white-mix-v1', { red: 25, green: -10 }],
	['hsl-mixer-v1', { redHue: 15, greenSaturation: -25, blueLuminance: 10 }],
	['point-curves-v1', { master: [{ x: 0, y: 0 }, { x: .5, y: .625 }, { x: 1, y: 1 }] }],
	['parametric-curves-v1', { masterShadows: 25, blueLights: -20 }],
	['color-wheels-v1', { shadowsHue: 30, shadowsSaturation: 25, midtonesLuminance: 10 }],
] as const;

for (const [type, params] of families) test(`${type}: the full recipe reaches native GPU capability admission and exact whole CPU fallback`, async () => {
	const source = { descriptor: { schemaVersion: 1 as const, width: 3, height: 1, sampleFormat: 'float32' as const, primaries: 'srgb' as const, transfer: 'linear' as const },
		pixels: Float32Array.of(.125, .25, .5, .375, -.25, 2, 1e-30, 0, .5, .125, .25, 1) };
	const before = source.pixels.slice(), develop = normalizeImageDevelopStateCurrentV1({ ...defaultImageDevelopStateV2(), effects: [createVideoEffect(type, { id: 'color', params })] });
	const expected = await withImageDevelopLinearCurrentV1({ frame: source, develop }, output => [...output.pixels], PROFILE);
	let calls = 0, backing: ArrayBuffer | undefined;
	const actual = await withImageDevelopGpuCurrentV1({ frame: source, develop }, (output, execution) => {
		calls++; backing = output.pixels.buffer;
		assert.equal(execution.backend, 'cpu');
		assert.ok(['canvas-unavailable', 'context-unavailable', 'float-target-unavailable'].includes(execution.reason ?? ''),
			`A supported color family must reach actual GPU capability admission, got ${execution.reason}.`);
		return [...output.pixels];
	}, PROFILE);
	assert.equal(calls, 1); assert.deepEqual(actual, expected); assert.deepEqual(source.pixels, before);
	assert.ok(backing && new Uint8Array(backing).every(value => value === 0));
});

test('all eight color families retain complete authored order and one native result through absent-context fallback', async () => {
	const effects = [createVideoEffect('white-balance-v1', { id: 'white', params: { temperature: 100 } }),
		createVideoEffect('tone-ladder-v1', { id: 'tone', params: { exposure: -1, contrast: 25 } }),
		...families.map(([type, params], at) => createVideoEffect(type, { id: `color-${at}`, params }))];
	const develop = normalizeImageDevelopStateCurrentV1({ ...defaultImageDevelopStateV2(), effects });
	const source = { descriptor: { schemaVersion: 1 as const, width: 2, height: 1, sampleFormat: 'float32' as const, primaries: 'srgb' as const, transfer: 'linear' as const },
		pixels: Float32Array.of(.125, .25, .5, .375, -.125, 2, .25, 0) };
	const expected = await withImageDevelopLinearCurrentV1({ frame: source, develop }, output => [...output.pixels], PROFILE);
	let calls = 0;
	const actual = await withImageDevelopGpuCurrentV1({ frame: source, develop }, (output, execution) => {
		calls++; assert.notEqual(execution.reason, 'unsupported-stage'); return [...output.pixels];
	}, PROFILE);
	assert.equal(calls, 1); assert.deepEqual(actual, expected);
});
