/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { withImageDevelopLinearCurrentV1 } from '../src/common/editor/imaging/image-develop-linear-current-v1.ts';
import { defaultImageDevelopStateV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import { normalizeImageDevelopStateCurrentV1 } from '../src/common/editor/imaging/image-develop-state-current-v1.ts';
import { PHOTO_DEVELOP_LINEAR_LIMITS_V1 } from '../src/common/editor/photo-library-develop-linear-port-v1.ts';
import { createVideoEffect } from '../src/common/editor/video-effects.js';

function recipe(node: unknown, effects: readonly unknown[] = [createVideoEffect('tone-ladder-v1', { id: 'tone', params: { exposure: 1 } })]) {
	return normalizeImageDevelopStateCurrentV1({ ...defaultImageDevelopStateV2(), processVersion: 3,
		repairs: { schemaVersion: 1, spots: [] }, effects,
		masks: [{ schemaVersion: 1, id: 'local', kind: 'mask', inputs: [], nodes: [node], outputNodeId: 'range' }],
		maskBindings: [{ effectId: 'tone', maskId: 'local' }] });
}
const frame = (values: readonly number[]) => ({ descriptor: { schemaVersion: 1 as const, width: values.length / 4, height: 1,
	sampleFormat: 'float32' as const, primaries: 'srgb' as const, transfer: 'linear' as const }, pixels: Float32Array.from(values) });

test('native local coverage blends signed HDR RGB and preserves source alpha without a display intermediate', async () => {
	const source = frame([-.25, .25, 2, .375, -.25, .25, 2, 0]), before = [...source.pixels];
	const develop = recipe({ id: 'range', kind: 'vector-shape', shape: 'rectangle', x: 0, y: 0, width: .5, height: 1 });
	const result = await withImageDevelopLinearCurrentV1({ frame: source, develop }, output => [...output.pixels], PHOTO_DEVELOP_LINEAR_LIMITS_V1);
	assert.deepEqual(result, [-.5, .5, 4, .375, -.25, .25, 2, 0]); assert.deepEqual([...source.pixels], before);
});

test('native luminance masks distinguish samples below one display byte', async () => {
	const source = frame([.18, .18, .18, 1, .1801, .1801, .1801, 1]);
	const develop = recipe({ id: 'range', kind: 'luminance-range', lower: .18005, upper: .1802, falloff: 0 });
	const result = await withImageDevelopLinearCurrentV1({ frame: source, develop }, output => [...output.pixels], PHOTO_DEVELOP_LINEAR_LIMITS_V1);
	assert.deepEqual(result, [source.pixels[0], source.pixels[1], source.pixels[2], 1,
		Math.fround(source.pixels[4]! * 2), Math.fround(source.pixels[5]! * 2), Math.fround(source.pixels[6]! * 2), 1]);
});

test('native color range uses continuous linear distance and ignores hidden RGB', async () => {
	const source = frame([.00001, .00001, .00001, 1, .0001, .0001, .0001, 1, .00001, .00001, .00001, 0]);
	const develop = recipe({ id: 'range', kind: 'color-range', color: { r: 0, g: 0, b: 0 }, radius: .00002, falloff: 0 });
	const result = await withImageDevelopLinearCurrentV1({ frame: source, develop }, output => [...output.pixels], PHOTO_DEVELOP_LINEAR_LIMITS_V1);
	assert.deepEqual(result, [...source.pixels].map((value, index) => index < 3 ? Math.fround(value * 2) : value));
});

test('native partial coverage interpolates once in linear Float32', async () => {
	const source = frame([.123456, -.25, 4, .5]);
	const develop = recipe({ id: 'range', kind: 'linear-gradient', start: { x: 0, y: 0 }, end: { x: 1, y: 0 } });
	const result = await withImageDevelopLinearCurrentV1({ frame: source, develop }, output => [...output.pixels], PHOTO_DEVELOP_LINEAR_LIMITS_V1);
	assert.deepEqual(result, [...source.pixels].map((value, index) => index === 3 ? value : Math.fround(value + 128 / 255 * value)));
});

test('native pipeline retires physical output through hostile view shadows and held abort', async () => {
	const source = frame([.123456, -.25, 4, .5]), controller = new AbortController();
	const reason = Proxy.revocable({}, {}); reason.revoke();
	let enter!: () => void, release!: () => void, backing: ArrayBuffer | undefined;
	const entered = new Promise<void>(resolve => { enter = resolve; }), held = new Promise<void>(resolve => { release = resolve; });
	const work = withImageDevelopLinearCurrentV1({ frame: source, develop: recipe({ id: 'range', kind: 'vector-shape', shape: 'rectangle', x: 0, y: 0, width: 1, height: 1 }), signal: controller.signal }, async output => {
		backing = output.pixels.buffer; Object.defineProperty(output.pixels, 'buffer', { value: new ArrayBuffer(0) });
		enter(); await held;
	}, PHOTO_DEVELOP_LINEAR_LIMITS_V1).then(() => ({ ok: true as const }), (error: unknown) => ({ ok: false as const, error }));
	try {
		await Promise.race([entered, work]); assert.ok(backing); controller.abort(reason.proxy);
		assert.ok(new Uint8Array(backing).some(byte => byte !== 0)); release(); const result = await work;
		assert.equal(result.ok, false); if (!result.ok) assert.ok(Object.is(result.error, reason.proxy));
		assert.ok(new Uint8Array(backing).every(byte => byte === 0));
	} finally { release(); await work; }
});
