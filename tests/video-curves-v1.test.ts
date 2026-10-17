/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { withGlobalDevelopPixelFrameV1 } from '../src/common/editor/imaging/pixel-frame-global-develop-v1.ts';
import { normalizePointCurvesParamsV1, normalizeParametricCurvesParamsV1, normalizeCurvesEffectV1,
	prepareCurvesEffectV1, createCurvesTransferV1, curvesPreviewPassV1, copyCurvesPreviewLookupV1,
	CURVES_PROCESSES_V1, serializeCurvesEffectToFfmpegV1 } from '../src/common/editor/video-curves-v1.ts';

const identity = () => [{ x: 0, y: 0 }, { x: 1, y: 1 }];
const invert = () => [{ x: 0, y: 1 }, { x: 1, y: 0 }];
const effect = (params: unknown = {}, type = 'point-curves-v1', enabled = true) => ({ id: 'curves', type, enabled, params });
function render(params: unknown = {}, source = [0, 64, 255, 127], type = 'point-curves-v1', enabled = true) {
	const transfer = createCurvesTransferV1(prepareCurvesEffectV1(effect(params, type, enabled))), pixels = [...source];
	for (let offset = 0; offset < pixels.length; offset += 4) for (let channel = 0; channel < 3; channel++) {
		pixels[offset + channel] = transfer[4 * pixels[offset + channel]! + channel]!;
	}
	return pixels;
}

test('dimensionless point curves apply exact master then channel byte quantization with independent goldens', () => {
	assert.equal(CURVES_PROCESSES_V1['point-curves-v1'], 'srgb-point-curves-f64-v1');
	assert.deepEqual(render({ master: invert() }), [255, 191, 0, 127]);
	assert.deepEqual(render({ master: invert(), red: invert() }), [0, 191, 0, 127]);
	const raised = [{ x: 0, y: 0.25 }, { x: 1, y: 0.75 }];
	assert.deepEqual(render({ master: raised }, [0, 64, 128, 0, 192, 255, 1, 1]), [64, 96, 128, 0, 160, 191, 64, 1]);
	assert.deepEqual(render({ master: [{ x: 0, y: 0.5 }, { x: 1, y: 0.5 }] }), [128, 128, 128, 127]);
});

test('neutral and disabled curves preserve all256 gray and alpha bytes, including hidden RGB', () => {
	const source = Array.from({ length: 256 }, (_, n) => [n, (17 * n) % 256, 255 - n, n]).flat();
	assert.deepEqual(render({}, source), source);
	assert.deepEqual(render({ master: invert() }, source, 'point-curves-v1', false), source);
	assert.deepEqual(render({}, source, 'parametric-curves-v1'), source);
	assert.deepEqual(render({ masterShadows: 100 }, source, 'parametric-curves-v1', false), source);
	assert.deepEqual(render({ master: invert() }, source).filter((_, index) => index % 4 === 3), source.filter((_, index) => index % 4 === 3));
});

test('point admission detaches and freezes every closed coordinate without quantizing legal distinct x values', () => {
	const master = [{ x: 0, y: 0 }, { x: 0.5, y: 0 }, { x: 0.5000000000000001, y: 1 }, { x: 1, y: 1 }];
	const normalized = normalizePointCurvesParamsV1({ master });
	assert.equal(normalized.master[2]!.x, 0.5000000000000001); assert.notEqual(normalized.master[1]!.x, normalized.master[2]!.x);
	assert.ok(Object.isFrozen(normalized)); assert.ok(Object.isFrozen(normalized.master)); assert.ok(Object.isFrozen(normalized.master[0]));
	master[1]!.y = 1; assert.equal(normalized.master[1]!.y, 0);
	assert.deepEqual(render(normalized, [127, 128, 255, 0]), [0, 255, 255, 0]);
	const denormal = [{ x: 0, y: 0 }, { x: Number.MIN_VALUE, y: 1 }, { x: 1, y: 0 }];
	assert.equal(normalizePointCurvesParamsV1({ master: denormal }).master[1]!.x, Number.MIN_VALUE);
	assert.deepEqual(render({ master: denormal }, [0, 1, 255, 127]), [0, 254, 0, 127]);
});

test('point admission rejects malformed endpoints/order/bounds/dense arrays and getters without reading them', () => {
	let reads = 0;
	const getter = Object.defineProperty({}, 'x', { enumerable: true, get() { reads++; return 0; } });
	const entries = [[], [{ x: 0, y: 0 }], [{ x: 0.1, y: 0 }, { x: 1, y: 1 }],
		[{ x: 0, y: 0 }, { x: 0.9, y: 1 }], [{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }],
		[{ x: 0, y: 0 }, { x: 1, y: Infinity }], [{ x: 0, y: -0.001 }, { x: 1, y: 1 }],
		[Object.assign(getter, { y: 0 }), { x: 1, y: 1 }], [{ x: 0, y: 0, future: 1 }, { x: 1, y: 1 }],
		Array.from({ length: 33 }, (_, n) => ({ x: n / 32, y: n / 32 }))];
	for (const master of entries) assert.throws(() => normalizePointCurvesParamsV1({ master }));
	const sparse = new Array<unknown>(2); sparse[1] = { x: 1, y: 1 };
	assert.throws(() => normalizePointCurvesParamsV1({ master: sparse }));
	const extra = identity(); Object.defineProperty(extra, 'future', { value: 1, enumerable: true });
	assert.throws(() => normalizePointCurvesParamsV1({ master: extra }));
	assert.throws(() => normalizePointCurvesParamsV1({ future: identity() })); assert.equal(reads, 0);
});

test('parametric curves own dimensionless ordered splits, bounded Q16 region gains and literal shadow goldens', () => {
	assert.equal(CURVES_PROCESSES_V1['parametric-curves-v1'], 'srgb-parametric-curves-q16-v1');
	const source = [0, 32, 64, 0, 96, 128, 160, 1, 224, 255, 0, 255];
	assert.deepEqual(render({ masterShadows: 100 }, source, 'parametric-curves-v1'), [0, 64, 80, 0, 96, 128, 160, 1, 224, 255, 0, 255]);
	const normalized = normalizeParametricCurvesParamsV1({ redLights: 12.5, shadowSplit: 0.1 });
	assert.equal(normalized.redLights, 12.5); assert.equal(normalized.shadowSplit, 0.1); assert.equal(normalized.midtoneSplit, 0.5);
	assert.ok(Object.isFrozen(normalized));
	for (const params of [{ shadowSplit: 0 }, { highlightSplit: 1 }, { shadowSplit: 0.5 }, { midtoneSplit: 0.75 },
		{ masterDarks: 100.01 }, { redLights: NaN }, { blueShadows: identity() }, { future: 1 }]) assert.throws(() => normalizeParametricCurvesParamsV1(params));
});

test('prepared curve ownership and preview pass identity isolate mutable input and upload bytes', () => {
	const params = { master: invert() }, prepared = prepareCurvesEffectV1(effect(params));
	params.master[0]!.y = 0; assert.equal(createCurvesTransferV1(prepared)[0], 255);
	assert.ok(Object.isFrozen(prepared));
	const pass = curvesPreviewPassV1(effect({ master: invert() })); assert.ok(pass); assert.equal(pass.code, 24);
	const upload = copyCurvesPreviewLookupV1(pass); upload.fill(0); assert.equal(copyCurvesPreviewLookupV1(pass)[0], 255);
	for (const value of [{ ...pass }, structuredClone(pass), new Proxy(pass, {})]) assert.throws(() => copyCurvesPreviewLookupV1(value));
	assert.equal(curvesPreviewPassV1(effect()), null); assert.equal(curvesPreviewPassV1(effect({}, 'parametric-curves-v1')), null);
	assert.equal(curvesPreviewPassV1(effect({ masterShadows: 100 }, 'parametric-curves-v1'))?.code, 25);
});

test('closed effect family rejects future identity/shape before any parameter accessor and keeps bounded export transport', () => {
	let reads = 0; const params = Object.defineProperty({}, 'master', { enumerable: true, get() { reads++; return identity(); } });
	for (const value of [effect(params), { ...effect(), type: 'point-curves-v2' }, { ...effect(), id: 'x'.repeat(129) },
		{ ...effect(), enabled: 0 }, { ...effect(), future: 1 }, { ...effect(), params: undefined }]) assert.throws(() => normalizeCurvesEffectV1(value));
	assert.equal(reads, 0); assert.equal(serializeCurvesEffectToFfmpegV1(effect()), null);
	const operation = serializeCurvesEffectToFfmpegV1(effect({ master: invert() })); assert.ok(operation);
	assert.equal(operation.preserveAlpha, true); assert.match(operation.expression, /geq=/u);
	assert.ok(operation.expression.length < 50_000); assert.match(operation.expression, /alpha\(X,Y\)/u);
});

for (const [type, params, first] of [
	['point-curves-v1', { master: invert() }, 191], ['parametric-curves-v1', { masterShadows: 100 }, 80],
] as const) test(`${type} yields before delivery and wipes its owned lookup/output on opaque cancellation`, async () => {
	const NativeBytes = Uint8Array, pixels = new NativeBytes(256 * 257 * 4).fill(64), stop = new AbortController();
	const source = { descriptor: { schemaVersion: 1, width: 256, height: 257, sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' }, pixels };
	const outputs: Uint8Array[] = [], lookups: Uint8Array[] = []; let inspections = 0, consumed = 0, settled = false;
	const reason = new Proxy({}, { get() { inspections++; throw new Error('opaque get'); },
		getPrototypeOf() { inspections++; throw new Error('opaque prototype'); },
		getOwnPropertyDescriptor() { inspections++; throw new Error('opaque descriptor'); } });
	globalThis.Uint8Array = new Proxy(NativeBytes, { construct(target, args, receiver) {
		const bytes = Reflect.construct(target, args, receiver) as Uint8Array<ArrayBuffer>;
		if (args[0] instanceof NativeBytes && bytes.length === pixels.length) outputs.push(bytes);
		if (args[0] === 1024) lookups.push(bytes);
		return bytes;
	} });
	let work: Promise<void>;
	try { work = withGlobalDevelopPixelFrameV1({ frame: source, effects: [effect(params, type)], signal: stop.signal },
		() => { consumed++; }, { limits: { maximumSidePixels: 512, maximumPixels: 256 * 257, maximumBytes: pixels.length } }); }
	finally { globalThis.Uint8Array = NativeBytes; }
	const observed = work.then(() => ({ rejected: false, reason: undefined as unknown }), error => ({ rejected: true, reason: error as unknown }));
	void observed.then(() => { settled = true; });
	assert.equal(outputs.length, 1); assert.equal(outputs[0]![0], first); assert.equal(lookups.length, 1);
	queueMicrotask(() => { stop.abort(reason); }); await Promise.resolve(); await Promise.resolve();
	assert.equal(settled, false); assert.equal(consumed, 0);
	const failure = await observed; assert.equal(failure.rejected, true); assert.equal(failure.reason === reason, true);
	assert.equal(inspections, 0); assert.equal(consumed, 0);
	assert.equal(outputs[0]!.every(byte => byte === 0), true); assert.equal(lookups[0]!.every(byte => byte === 0), true);
	assert.equal(pixels.every(byte => byte === 64), true);
});
