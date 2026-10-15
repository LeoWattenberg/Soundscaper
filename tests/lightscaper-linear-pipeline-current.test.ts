/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { withImageDevelopLinearCurrentV1 } from '../src/common/editor/imaging/image-develop-linear-current-v1.ts';
import { LinearDevelopOwnerV1 } from '../src/common/editor/imaging/image-develop-linear-owner-v1.ts';
import { defaultImageDevelopStateV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import { normalizeImageDevelopStateCurrentV1 } from '../src/common/editor/imaging/image-develop-state-current-v1.ts';
import { PHOTO_DEVELOP_LINEAR_LIMITS_V1 as PROFILE } from '../src/common/editor/photo-library-develop-linear-port-v1.ts';
import { parseCubeLutV1 } from '../src/common/editor/video-color-cube-lut-v27.ts';
import { createVideoEffect } from '../src/common/editor/video-effects.js';
import type { CubeLutSourcePortV1 } from '../src/common/editor/imaging/cube-lut-source-port-v1.ts';
import { withPreparedBrushMaskResourceV1 } from '../src/common/editor/imaging/brush-mask-resource-v1.ts';
import type { MaskRasterSourcePortV1 } from '../src/common/editor/imaging/mask-raster-source-port-v1.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';
import { createPhotoDevelopRenderRuntimeCurrentV1 } from '../src/lightscaper/photo-develop-render-runtime-current-v1.ts';

const SWAP = 'LUT_3D_SIZE 2\n0 0 0\n0 0 1\n0 1 0\n0 1 1\n1 0 0\n1 0 1\n1 1 0\n1 1 1';
function lut() {
	const body = parseCubeLutV1(SWAP);
	return { bytes: new TextEncoder().encode(SWAP), reference: { storageKey: `lut-sha256:${body.sha256}`, sha256: body.sha256,
		byteLength: body.byteLength, size: body.size, domainMin: body.domainMin, domainMax: body.domainMax } };
}
const frame = (values: readonly number[]) => ({ descriptor: { schemaVersion: 1 as const, width: values.length / 4, height: 1,
	sampleFormat: 'float32' as const, primaries: 'srgb' as const, transfer: 'linear' as const }, pixels: Float32Array.from(values) });
const recipe = (effects: readonly unknown[]) => normalizeImageDevelopStateCurrentV1({ ...defaultImageDevelopStateV2(), effects });

test('native pipeline snapshots before a held LUT body and pins its actual receiver and method', async () => {
	const resource = lut(), source = frame([.125, .25, .5, .375]), entered = deferred<void>(), release = deferred<void>();
	let calls = 0;
	const port: CubeLutSourcePortV1 = { async withBytes(reference, consume) {
		assert.equal(this, port); calls++; assert.deepEqual(reference, resource.reference); entered.resolve(); await release.promise;
		return consume(resource.bytes);
	} };
	const work = withImageDevelopLinearCurrentV1({ frame: source, develop: recipe([
		{ type: 'cube-lut-profile-v1', id: 'lut', enabled: true, params: { lut: resource.reference } },
	]) }, output => [...output.pixels], PROFILE, { source: port });
	try {
		await entered.promise; source.pixels.fill(.75); port.withBytes = () => { throw new Error('late port'); };
		release.resolve(); assert.deepEqual(await work, [.5, .25, .125, .375]); assert.equal(calls, 1);
	} finally { release.resolve(); await work; }
});

test('Current runtime pins selected resource capabilities at factory creation for native frames', async () => {
	const resource = lut(); let calls = 0;
	const port: CubeLutSourcePortV1 = { withBytes(_reference, consume) { assert.equal(this, port); calls++; return Promise.resolve(consume(resource.bytes)); } };
	const options = { source: port }, runtime = createPhotoDevelopRenderRuntimeCurrentV1(options);
	port.withBytes = () => { throw new Error('replaced method'); };
	options.source = { withBytes() { throw new Error('replaced source'); } };
	const result = await runtime.withFullResolution({ frame: frame([.125, .25, .5, .375]), develop: recipe([
		{ type: 'cube-lut-profile-v1', id: 'lut', enabled: true, params: { lut: resource.reference } },
	]), signal: new AbortController().signal }, output => [...output.frame.pixels]);
	assert.deepEqual(result, [.5, .25, .125, .375]); assert.equal(calls, 1);
});

test('native masks, LUT and geometry retain authored order and project the actual observed coverage', async () => {
	const resource = lut(), source = frame([.125, .25, .5, .375, .25, .5, .75, 1, .5, .75, 1, 0]);
	const develop = { ...recipe([
		{ type: 'cube-lut-profile-v1', id: 'lut', enabled: true, params: { lut: resource.reference } },
		createVideoEffect('develop-geometry-v1', { id: 'turn', params: { rotationDegrees: 90 } }),
	]), masks: [{ schemaVersion: 1, id: 'local', kind: 'mask', inputs: [],
		nodes: [{ id: 'rect', kind: 'vector-shape', shape: 'rectangle', x: 0, y: 0, width: 1 / 3, height: 1 }], outputNodeId: 'rect' }],
	maskBindings: [{ maskId: 'local', effectId: 'lut' }] };
	const port: CubeLutSourcePortV1 = { withBytes: (_reference, consume) => Promise.resolve(consume(resource.bytes)) };
	let overlay: Uint8Array | undefined;
	const result = await withImageDevelopLinearCurrentV1({ frame: source, develop, maskOverlay: { maskId: 'local', effectId: 'lut' } }, (output, observed) => {
		assert.equal(output.descriptor.width, 1); assert.equal(output.descriptor.height, 3);
		assert.ok(observed); overlay = observed.coverage; assert.deepEqual([...observed.coverage], [255, 0, 0]);
		return [...output.pixels];
	}, PROFILE, { source: port });
	// Geometry canonicalizes a fully transparent output pixel; no prior RGB
	// display quantization is involved in either visible native pixel.
	assert.deepEqual(result, [.5, .25, .125, .375, .25, .5, .75, 1, 0, 0, 0, 0]);
	assert.ok(overlay?.every(byte => byte === 0));
});

test('native brush coverage authenticates complete bytes and blends without quantizing working RGB', async () => {
	await withPreparedBrushMaskResourceV1({ width: 3, height: 1, alpha: Uint8Array.of(0, 128, 255) }, async resource => {
		const selected = frame([.123456, -.25, 2, .5, .123456, -.25, 2, .5, .123456, -.25, 2, .5]);
		const develop = { ...recipe([createVideoEffect('tone-ladder-v1', { id: 'tone', params: { exposure: 1 } })]),
			masks: [{ schemaVersion: 1, id: 'local', kind: 'mask', inputs: [{ name: 'paint', sourceRef: resource.reference.storageKey, kind: 'alpha' }],
				nodes: [{ id: 'paint', kind: 'alpha', inputName: 'paint' }], outputNodeId: 'paint' }], maskBindings: [{ maskId: 'local', effectId: 'tone' }] };
		let reads = 0;
		const port: MaskRasterSourcePortV1 = { async withBytes(reference, consume) { assert.equal(this, port); assert.deepEqual(reference, resource.reference); reads++; return consume(resource.bytes); } };
		const result = await withImageDevelopLinearCurrentV1({ frame: selected, develop }, output => [...output.pixels], PROFILE, { maskSource: port });
		const expected = [...selected.pixels].map((value, index) => index % 4 === 3 ? value : Math.fround(value * (1 + [0, 128 / 255, 1][Math.floor(index / 4)]!)));
		assert.deepEqual(result, expected); assert.equal(reads, 1);
		const bad = resource.bytes.slice(); bad[bad.length - 1]! ^= 1;
		const corrupt: MaskRasterSourcePortV1 = { withBytes: (_reference, consume) => Promise.resolve(consume(bad)) };
		let delivered = false;
		await assert.rejects(withImageDevelopLinearCurrentV1({ frame: selected, develop }, () => { delivered = true; }, PROFILE, { maskSource: corrupt })); assert.equal(delivered, false);
	});
});

test('complete native peak planning refuses before pixels or LUT body acquisition', async () => {
	const resource = lut(); let pixelReads = 0, bodyReads = 0;
	const source = { descriptor: { ...frame([0, 0, 0, 1]).descriptor, width: 8192, height: 2048 }, get pixels() { pixelReads++; throw new Error('pixels'); } };
	const port: CubeLutSourcePortV1 = { withBytes() { bodyReads++; throw new Error('body'); } };
	await assert.rejects(withImageDevelopLinearCurrentV1({ frame: source, develop: recipe([
		{ type: 'cube-lut-profile-v1', id: 'lut', enabled: true, params: { lut: resource.reference } },
	]) }, () => undefined, PROFILE, { source: port }), /768 MiB/u);
	assert.equal(pixelReads, 0); assert.equal(bodyReads, 0);
});

test('native source admission preserves cancellation that occurs during the pixels descriptor read', async () => {
	const controller = new AbortController(), reason = Proxy.revocable({}, {}); reason.revoke();
	const source = new Proxy({ descriptor: frame([0, 0, 0, 1]).descriptor, pixels: null }, {
		getOwnPropertyDescriptor(target, key) { if (key === 'pixels') controller.abort(reason.proxy); return Reflect.getOwnPropertyDescriptor(target, key); },
	});
	try { await withImageDevelopLinearCurrentV1({ frame: source, develop: recipe([]), signal: controller.signal }, () => undefined, PROFILE); assert.fail('cancelled source'); }
	catch (error) { assert.ok(Object.is(error, reason.proxy)); }
});

test('native source subviews retain padding unchanged and charge the complete physical backing before private allocation', async () => {
	const backing = new Float32Array(12).fill(.75), pixels = backing.subarray(4, 8);
	pixels.set([.125, .25, .5, 1]); const before = backing.slice();
	assert.deepEqual(await withImageDevelopLinearCurrentV1({ frame: { ...frame([0, 0, 0, 1]), pixels }, develop: recipe([]) }, output => [...output.pixels], PROFILE), [.125, .25, .5, 1]);
	assert.deepEqual(backing, before);
	// A virtual padded allocation is deliberately never traversed or copied.
	// Its four-sample view fits; retaining that physical backing plus even the
	// smallest private working plane exceeds the actual aggregate cap.
	const oversized = new Float32Array(new ArrayBuffer(768 * 1024 * 1024), 0, 4); oversized[3] = 1;
	let delivered = false;
	await assert.rejects(withImageDevelopLinearCurrentV1({ frame: { ...frame([0, 0, 0, 1]), pixels: oversized }, develop: recipe([]) }, () => { delivered = true; }, PROFILE), /768 MiB/u);
	assert.equal(delivered, false); assert.equal(oversized[3], 1);
});

test('native resource source settlement joins ignored child work and retains cleanup failures', async () => {
	const resource = lut(), source = frame([.125, .25, .5, 1]), entered = deferred<void>(), release = deferred<void>();
	const cleanup = new Error('source close'); let delivered = false;
	const port: CubeLutSourcePortV1 = { async withBytes(_reference, consume) {
		void Promise.resolve(consume(resource.bytes)).catch(() => undefined); entered.resolve(); await release.promise; throw cleanup;
	} };
	const work = withImageDevelopLinearCurrentV1({ frame: source, develop: recipe([
		{ type: 'cube-lut-profile-v1', id: 'lut', enabled: true, params: { lut: resource.reference } },
	]) }, () => { delivered = true; }, PROFILE, { source: port }).then(() => undefined, (error: unknown) => error);
	try { await entered.promise; assert.equal(await remainsPending(work), true); release.resolve(); assert.equal(await work, cleanup); assert.equal(delivered, false); }
	finally { release.resolve(); await work; }
});

test('native pipeline rejects a repeated LUT delivery even if its source swallows the refusal', async () => {
	const resource = lut(), port: CubeLutSourcePortV1 = { async withBytes(_reference, consume) {
		const first = consume(resource.bytes); try { await consume(resource.bytes); } catch { /* Deliberately hostile source. */ }
		return first;
	} };
	let delivered = false;
	await assert.rejects(withImageDevelopLinearCurrentV1({ frame: frame([.125, .25, .5, 1]), develop: recipe([
		{ type: 'cube-lut-profile-v1', id: 'lut', enabled: true, params: { lut: resource.reference } },
	]) }, () => { delivered = true; }, PROFILE, { source: port }), /repeated/u); assert.equal(delivered, false);
});

test('multistage native owner retires every remaining backing and preserves opaque primary plus detach failure', async () => {
	const owner = new LinearDevelopOwnerV1(8, 40), first = owner.floats(4), second = owner.bytes(8), third = owner.bytes(8);
	first.fill(1); second.fill(7); third.fill(9); const primary = Proxy.revocable({}, {}); primary.revoke();
	const detached = second.buffer; structuredClone(detached, { transfer: [detached] });
	try { await owner.run(() => { throw primary.proxy; }); assert.fail('physical retirement must refuse'); }
	catch (error) { assert.ok(error instanceof AggregateError); assert.ok(Object.is(error.errors[0], primary.proxy)); assert.match(String(error.errors[1]), /detached/u); }
	assert.ok(first.every(value => value === 0)); assert.ok(third.every(value => value === 0));
});
