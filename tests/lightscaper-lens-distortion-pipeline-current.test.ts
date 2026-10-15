/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createPhotoDevelopRenderRuntimeCurrentV1 } from '../src/lightscaper/photo-develop-render-runtime-current-v1.ts';
import { defaultImageDevelopStateV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import { createVideoEffect } from '../src/common/editor/video-effects.js';
import { normalizeImageDevelopStateCurrentV1 } from '../src/common/editor/imaging/image-develop-state-current-v1.ts';
import { withImageDevelopFrameV3, withImageDevelopFrameFixedKernelV1 } from '../src/common/editor/imaging/image-develop-frame-v3.ts';
import { withImageDevelopFrameCurrentV1 } from '../src/common/editor/imaging/image-develop-frame-current-v1.ts';
import { PHOTO_DEVELOP_FULL_RESOLUTION_LIMITS_V1 } from '../src/common/editor/photo-library-develop-full-resolution-port-v1.ts';
import { PHOTO_DEVELOP_LINEAR_LIMITS_V1 } from '../src/common/editor/photo-library-develop-linear-port-v1.ts';
import { prepareImageDevelopBrushMasksCurrentV1 } from '../src/common/editor/imaging/image-develop-mask-plan-current-v1.ts';
import { withProjectedImageDevelopMaskCoverageCurrentV1 } from '../src/common/editor/imaging/image-develop-mask-overlay-current-v1.ts';
import type { PixelFrameV1 } from '../src/common/editor/imaging/pixel-frame-contract-v1.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';
import { withPreparedBrushMaskResourceV1 } from '../src/common/editor/imaging/brush-mask-resource-v1.ts';
import type { MaskRasterSourcePortV1 } from '../src/common/editor/imaging/mask-raster-source-port-v1.ts';
import { manageImageDevelopMasksCurrentV1, replaceImageDevelopLocalMasksCurrentV1 } from '../src/common/editor/imaging/image-develop-mask-management-current-v1.ts';

test('Current native renderer executes explicitly authored radial distortion without changing the Original or recipe version', async () => {
	const frame = { descriptor: { schemaVersion: 1 as const, width: 3, height: 1, sampleFormat: 'float32' as const,
		primaries: 'srgb' as const, transfer: 'linear' as const }, pixels: Float32Array.of(.125, .25, .5, 1, .25, .5, 1, 1, .5, 1, 2, 1) };
	const before = frame.pixels.slice(), develop = normalizeImageDevelopStateCurrentV1({ ...defaultImageDevelopStateV2(), effects: [createVideoEffect('lens-distortion-v1', { id: 'lens', params: { amount: 100 } })] });
	const actual = await createPhotoDevelopRenderRuntimeCurrentV1().withFullResolution({ frame, develop, signal: new AbortController().signal }, view => [...view.frame.pixels]);
	// For a3x1 aperture the half-diagonal squared is2.5. The two outside
	// centers move from0.5/2.5 to0.38/2.62; transparent tap extension leaves
	// their straight RGB intact and their alpha at0.88. Center stays fixed.
	assert.deepEqual(actual, [.125, .25, .5, Math.fround(.88), .25, .5, 1, 1, .5, 1, 2, Math.fround(.88)]);
	assert.deepEqual(frame.pixels, before); assert.equal(develop.processVersion, 2);
});

const runtime = () => createPhotoDevelopRenderRuntimeCurrentV1();
const lens = (amount = 100, enabled = true) => createVideoEffect('lens-distortion-v1', { id: 'lens', enabled, params: { amount } });
const tone = (exposure = 1) => createVideoEffect('tone-ladder-v1', { id: 'tone', params: { exposure } });
const gray = (values: readonly number[], native: boolean): PixelFrameV1 => {
	const valuesRgba = values.flatMap(value => [value, value, value, native ? 1 : 255]);
	return native ? { descriptor: { schemaVersion: 1, width: values.length, height: 1, sampleFormat: 'float32', primaries: 'srgb', transfer: 'linear' }, pixels: Float32Array.from(valuesRgba) }
		: { descriptor: { schemaVersion: 1, width: values.length, height: 1, sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' }, pixels: Uint8Array.from(valuesRgba) };
};
const recipe = (effects: readonly unknown[], extras: Readonly<Record<string, unknown>> = {}) => normalizeImageDevelopStateCurrentV1({ ...defaultImageDevelopStateV2(), effects, ...extras });
const graph = (node: unknown) => ({ schemaVersion: 1, id: 'local', kind: 'mask', inputs: [], nodes: [node], outputNodeId: 'coverage' });
const signal = () => new AbortController().signal;

test('native range masks sample the actual incoming distorted Float32 stage before the masked adjustment', async () => {
	const source = gray([0, 1, 0], true), before = source.pixels.slice();
	const develop = recipe([lens(-100), tone()], { masks: [graph({ id: 'coverage', kind: 'luminance-range', lower: .1, upper: .2, falloff: 0 })],
		maskBindings: [{ maskId: 'local', effectId: 'tone' }] });
	let retained: Uint8Array | undefined;
	const result = await runtime().withFullResolution({ frame: source, develop, signal: signal(), maskOverlay: { maskId: 'local', effectId: 'tone' } }, view => {
		assert.ok(view.maskOverlay); retained = view.maskOverlay.coverage; assert.deepEqual([...retained], [255, 0, 255]); return [...view.frame.pixels];
	});
	// Inward sampling yields0.12/1/0.12, so only the two outside pixels enter
	// the0.1..0.2 range. Sampling the Original or display bytes gives a
	// different decision. The exposed native0.24 is not display-quantized.
	assert.deepEqual(result, [Math.fround(.24), Math.fround(.24), Math.fround(.24), 1, 1, 1, 1, 1, Math.fround(.24), Math.fround(.24), Math.fround(.24), 1]);
	assert.ok(retained?.every(value => value === 0)); assert.deepEqual(source.pixels, before);
});

for (const native of [false, true]) test(`${native ? 'native' : 'byte'} Current selected coverage follows distortion then cropped rotation in authored order`, async () => {
	const source = gray(native ? [.125, .25, .5] : [32, 64, 128], native), before = source.pixels.slice();
	const crop = createVideoEffect('develop-geometry-v1', { id: 'crop', params: { cropWidth: 2 / 3, rotationDegrees: 90 } });
	const masks = [graph({ id: 'coverage', kind: 'linear-gradient', start: { x: 0, y: 0 }, end: { x: 1, y: 0 } })], maskBindings = [{ maskId: 'local', effectId: 'tone' }];
	const render = (effects: readonly unknown[]) => runtime().withFullResolution({ frame: source, develop: recipe(effects, { masks, maskBindings }), signal: signal(),
		maskOverlay: { maskId: 'local', effectId: 'tone' } }, view => {
		assert.ok(view.maskOverlay); assert.deepEqual([view.frame.descriptor.width, view.frame.descriptor.height, view.maskOverlay.width, view.maskOverlay.height], [1, 2, 1, 2]);
		return { pixels: [...view.frame.pixels], coverage: [...view.maskOverlay.coverage] };
	});
	const distortedFirst = await render([tone(0), lens(), crop]);
	const croppedFirst = await render([tone(0), crop, lens()]);
	// Incoming gradient43/128/213 becomes38/128/187 after radial alpha
	// support, then the left two samples rotate. Cropping first gives a
	//2x1 aperture, whose different radial support leaves42/124 instead.
	assert.deepEqual(distortedFirst.coverage, [38, 128]); assert.deepEqual(croppedFirst.coverage, [42, 124]);
	assert.notDeepEqual(distortedFirst.coverage, croppedFirst.coverage);
	assert.deepEqual(distortedFirst.pixels.filter((_value, index) => index % 4 === 3), native ? [Math.fround(.88), 1] : [224, 255]);
	assert.deepEqual(source.pixels, before);
});

test('Current byte and native pipelines preserve authored color/distortion order with unchanged source storage', async () => {
	const bytes = gray([128, 255, 0], false), beforeBytes = bytes.pixels.slice();
	const native = gray([.25, 1, 0], true), beforeNative = native.pixels.slice();
	const render = (frame: PixelFrameV1, effects: readonly unknown[]) => runtime().withFullResolution({ frame, develop: recipe(effects), signal: signal() }, view => [...view.frame.pixels]);
	const byteLensFirst = await render(bytes, [lens(-100), tone()]), byteToneFirst = await render(bytes, [tone(), lens(-100)]);
	assert.deepEqual(byteLensFirst, [exposeByte(143), exposeByte(143), exposeByte(143), 255, 255, 255, 255, 255, exposeByte(31), exposeByte(31), exposeByte(31), 255]);
	assert.deepEqual(byteToneFirst, [185, 185, 185, 255, 255, 255, 255, 255, 31, 31, 31, 255]); assert.notDeepEqual(byteLensFirst, byteToneFirst);
	const nativeLensFirst = await render(native, [lens(-100), tone()]), nativeToneFirst = await render(native, [tone(), lens(-100)]);
	// This linear exposure commutes algebraically, while each stage still has
	// its real Float32 storage boundary. Both retain highlight2 and sub-byte RGB.
	assert.deepEqual(nativeLensFirst, [Math.fround(.68), Math.fround(.68), Math.fround(.68), 1, 2, 2, 2, 1, Math.fround(.24), Math.fround(.24), Math.fround(.24), 1]);
	assert.deepEqual(nativeToneFirst, nativeLensFirst); assert.deepEqual(bytes.pixels, beforeBytes); assert.deepEqual(native.pixels, beforeNative);
});

for (const processVersion of [1, 2, 3]) test(`explicit process${processVersion} remains stable through Current byte/native lens rendering`, async () => {
	for (const native of [false, true]) {
		const frame = gray(native ? [.125, .25, .5] : [32, 64, 128], native);
		const develop = recipe([lens()], { processVersion, ...(processVersion === 3 ? { repairs: { schemaVersion: 1, spots: [] } } : {}) });
		const serialized = JSON.stringify(develop);
		await runtime().withProxy({ frame, develop, signal: signal() }, view => { assert.equal(view.frame.descriptor.width, 3); });
		assert.equal(JSON.stringify(develop), serialized); assert.equal(develop.processVersion, processVersion);
	}
});

test('neutral and disabled distortion preserve exact native source bits including signed zero and subnormals', async () => {
	const source = gray([0, 0, 0], true); assert.ok(source.pixels instanceof Float32Array);
	source.pixels.set([-0, Math.fround(1e-40), -.000001, .5]);
	const before = new Uint8Array(source.pixels.buffer).slice();
	for (const effect of [lens(0), lens(100, false)]) {
		const result = await runtime().withFullResolution({ frame: source, develop: recipe([effect]), signal: signal() }, view => new Uint8Array(view.frame.pixels.buffer).slice());
		assert.deepEqual(result, before);
	}
	assert.deepEqual(new Uint8Array(source.pixels.buffer), before);
});

test('masking any distortion stage refuses before native or byte pixels are reflected', async () => {
	for (const native of [false, true]) for (const effect of [lens(), lens(0), lens(100, false)]) {
		let reads = 0; const original = gray([native ? .25 : 64], native);
		const frame = { descriptor: original.descriptor, get pixels(): never { reads++; throw new Error('Original pixels'); } } as PixelFrameV1;
		const develop = recipe([effect], { masks: [graph({ id: 'coverage', kind: 'vector-shape', shape: 'rectangle', x: 0, y: 0, width: 1, height: 1 })],
			maskBindings: [{ maskId: 'local', effectId: 'lens' }] });
		await assert.rejects(runtime().withFullResolution({ frame, develop, signal: signal() }, () => assert.fail('Unmaskable stage was delivered.')), /Lens distortion.*mask/u);
		assert.equal(reads, 0);
	}
});

test('permanent byte V3 still refuses active lens while the named Current byte facade renders it', async () => {
	const frame = gray([32, 64, 128], false), develop = recipe([lens()]);
	await assert.rejects(withImageDevelopFrameV3({ frame, develop }, () => assert.fail('Permanent V3 acquired a new family.'), PHOTO_DEVELOP_FULL_RESOLUTION_LIMITS_V1), /Unsupported photo proxy effect/u);
	const actual = await withImageDevelopFrameCurrentV1({ frame, develop }, view => [...view.frame.pixels], PHOTO_DEVELOP_FULL_RESOLUTION_LIMITS_V1);
	assert.deepEqual(actual, [32, 32, 32, 224, 64, 64, 64, 255, 128, 128, 128, 224]);
});

test('Current projection joins held delivery, preserves opaque cancellation, wipes output and leaves input coverage intact', async () => {
	const develop = recipe([tone(0), lens()]), source = Uint8Array.of(43, 128, 213), before = source.slice();
	const prepared = prepareImageDevelopBrushMasksCurrentV1({ ...develop, masks: [graph({ id: 'coverage', kind: 'linear-gradient', start: { x: 0, y: 0 }, end: { x: 1, y: 0 } })],
		maskBindings: [{ maskId: 'local', effectId: 'tone' }] }, 3, 1, PHOTO_DEVELOP_LINEAR_LIMITS_V1.render, { maskId: 'local', effectId: 'tone' });
	const stop = new AbortController(), reason = Proxy.revocable({}, {}); reason.revoke();
	const entered = deferred<void>(), release = deferred<void>(); let delivered: Uint8Array | undefined;
	const work = withProjectedImageDevelopMaskCoverageCurrentV1(prepared.plan.bindings[0]!, source, async view => {
		delivered = view.coverage; assert.deepEqual([...delivered], [38, 128, 187]); entered.resolve(); await release.promise;
	}, PHOTO_DEVELOP_FULL_RESOLUTION_LIMITS_V1, stop.signal);
	const observed = work.then(() => ({ ok: true as const }), (error: unknown) => ({ ok: false as const, error }));
	try {
		await Promise.race([entered.promise, work]); stop.abort(reason.proxy); assert.equal(await remainsPending(observed), true);
		assert.ok(delivered?.some(value => value !== 0)); release.resolve(); const outcome = await observed;
		assert.equal(outcome.ok, false); if (!outcome.ok) assert.ok(Object.is(outcome.error, reason.proxy));
		assert.ok(delivered?.every(value => value === 0)); assert.deepEqual(source, before);
	} finally { release.resolve(); await observed; }
});

test('distorted Current byte/native renders still authenticate unused native brush declarations and preserve their bodies', async () => {
	await withPreparedBrushMaskResourceV1({ width: 3, height: 1, alpha: Uint8Array.of(0, 128, 255) }, async resource => {
		const before = resource.bytes.slice();
		const develop = recipe([lens()], { masks: [{ schemaVersion: 1, id: 'unused', kind: 'mask',
			inputs: [{ name: 'paint', sourceRef: resource.reference.storageKey, kind: 'alpha' }],
			nodes: [{ id: 'constant', kind: 'vector-shape', shape: 'rectangle', x: 0, y: 0, width: 1, height: 1 }], outputNodeId: 'constant' }] });
		for (const native of [false, true]) {
			let reads = 0;
			const maskSource: MaskRasterSourcePortV1 = { withBytes(reference, consume) {
				assert.equal(this, maskSource); assert.deepEqual(reference, resource.reference); reads++; return Promise.resolve(consume(resource.bytes));
			} };
			await createPhotoDevelopRenderRuntimeCurrentV1({ maskSource }).withFullResolution({ frame: gray(native ? [.125, .25, .5] : [32, 64, 128], native), develop, signal: signal() }, () => undefined);
			assert.equal(reads, 1); assert.deepEqual(resource.bytes, before);
			const damaged = resource.bytes.slice(); damaged[damaged.length - 1]! ^= 1;
			const corrupt: MaskRasterSourcePortV1 = { withBytes: (_reference, consume) => Promise.resolve(consume(damaged)) };
			await assert.rejects(createPhotoDevelopRenderRuntimeCurrentV1({ maskSource: corrupt }).withFullResolution({ frame: gray(native ? [.125, .25, .5] : [32, 64, 128], native), develop, signal: signal() }, () => assert.fail('Corrupt retained declaration delivered pixels.')));
			damaged.fill(0);
		}
		assert.deepEqual(resource.bytes, before);
	});
});

test('Current projected coverage preserves a primary failure alongside physical transfer refusal', async () => {
	const develop = recipe([tone(0), lens()], { masks: [graph({ id: 'coverage', kind: 'linear-gradient', start: { x: 0, y: 0 }, end: { x: 1, y: 0 } })],
		maskBindings: [{ maskId: 'local', effectId: 'tone' }] });
	const prepared = prepareImageDevelopBrushMasksCurrentV1(develop, 3, 1, PHOTO_DEVELOP_LINEAR_LIMITS_V1.render, { maskId: 'local', effectId: 'tone' });
	const input = Uint8Array.of(43, 128, 213), before = input.slice(), primary = Symbol('projected consumer');
	await assert.rejects(withProjectedImageDevelopMaskCoverageCurrentV1(prepared.plan.bindings[0]!, input, view => {
		const backing = view.coverage.buffer; structuredClone(backing, { transfer: [backing] }); throw primary;
	}, PHOTO_DEVELOP_FULL_RESOLUTION_LIMITS_V1), (error: unknown) => {
		assert.ok(error instanceof AggregateError); assert.equal(error.cause, primary); assert.equal(error.errors[0], primary);
		assert.ok(error.errors.some(reason => reason instanceof TypeError)); return true;
	});
	assert.deepEqual(input, before);
});

test('Current standalone projection refuses a padded coverage backing instead of hiding physical storage', async () => {
	const develop = recipe([tone(0), lens()], { masks: [graph({ id: 'coverage', kind: 'linear-gradient', start: { x: 0, y: 0 }, end: { x: 1, y: 0 } })],
		maskBindings: [{ maskId: 'local', effectId: 'tone' }] });
	const prepared = prepareImageDevelopBrushMasksCurrentV1(develop, 3, 1, PHOTO_DEVELOP_LINEAR_LIMITS_V1.render, { maskId: 'local', effectId: 'tone' });
	const backing = Uint8Array.of(9, 9, 43, 128, 213, 9, 9, 9), input = backing.subarray(2, 5), before = backing.slice();
	let delivered = false;
	await assert.rejects(withProjectedImageDevelopMaskCoverageCurrentV1(prepared.plan.bindings[0]!, input, () => { delivered = true; },
		PHOTO_DEVELOP_FULL_RESOLUTION_LIMITS_V1), /dedicated|physical|backing|span/u);
	assert.equal(delivered, false); assert.deepEqual(backing, before);
});

test('Current mask authoring refuses lens bindings for every supported recipe and retained lens state', () => {
	for (const processVersion of [1, 2, 3]) for (const effect of [lens(), lens(0), lens(100, false)]) {
		const develop = recipe([effect, tone(0)], { processVersion, ...(processVersion === 3 ? { repairs: { schemaVersion: 1, spots: [] } } : {}),
			masks: [graph({ id: 'coverage', kind: 'vector-shape', shape: 'rectangle', x: 0, y: 0, width: 1, height: 1 })] });
		const before = JSON.stringify(develop);
		assert.throws(() => manageImageDevelopMasksCurrentV1(develop, { type: 'bindings', maskId: 'local', effectIds: ['lens'] }), /[Ll]ens.*mask/u);
		const valid = manageImageDevelopMasksCurrentV1(develop, { type: 'bindings', maskId: 'local', effectIds: ['tone'] });
		assert.deepEqual(valid.maskBindings, [{ maskId: 'local', effectId: 'tone' }]); assert.equal(valid.processVersion, processVersion);
		assert.equal(JSON.stringify(develop), before);
	}
});

test('Current local mask replacement refuses a lens binding instead of persisting an unrenderable draft', () => {
	for (const effect of [lens(), lens(0), lens(100, false)]) {
		const develop = recipe([effect, tone(0)], { processVersion: 3, repairs: { schemaVersion: 1, spots: [] },
			masks: [graph({ id: 'coverage', kind: 'vector-shape', shape: 'rectangle', x: 0, y: 0, width: 1, height: 1 })] });
		assert.throws(() => replaceImageDevelopLocalMasksCurrentV1(develop, { effects: develop.effects, masks: develop.masks,
			maskBindings: [{ maskId: 'local', effectId: 'lens' }] }), /[Ll]ens.*mask/u);
		assert.deepEqual(replaceImageDevelopLocalMasksCurrentV1(develop, { effects: develop.effects, masks: develop.masks, maskBindings: [] }), develop);
	}
});

test('fixed byte composition rejects an unsupported mode before acquiring source pixels', async () => {
	let reads = 0;
	const frame = { descriptor: gray([32], false).descriptor, get pixels(): never { reads++; throw new Error('Original pixels'); } };
	await assert.rejects(Promise.resolve().then(() => withImageDevelopFrameFixedKernelV1({ frame, develop: recipe([]) }, () => assert.fail('Invalid composition was delivered.'),
		PHOTO_DEVELOP_FULL_RESOLUTION_LIMITS_V1, {}, 'unsupported' as 'legacy')), /fixed|mode/u);
	assert.equal(reads, 0);
});

function exposeByte(value: number): number {
	const encoded = value / 255, linear = encoded <= .04045 ? encoded / 12.92 : ((encoded + .055) / 1.055) ** 2.4;
	const doubled = Math.min(1, linear * 2); return Math.round(255 * (doubled <= .0031308 ? doubled * 12.92 : 1.055 * doubled ** (1 / 2.4) - .055));
}
