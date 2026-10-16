/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import test from 'node:test';
import { withImageDevelopLinearCurrentV1 } from '../src/common/editor/imaging/image-develop-linear-current-v1.ts';
import type { LinearWorkingPixelFrameV1 } from '../src/common/editor/imaging/image-develop-linear-frame-v1.ts';
import type { ImageDevelopMaskOverlayViewV1 } from '../src/common/editor/imaging/image-develop-mask-overlay-v1.ts';
import type { ImageDevelopFrameOptionsV3 } from '../src/common/editor/imaging/image-develop-frame-v3.ts';
import type { ImageDevelopFrameProfile } from '../src/common/editor/imaging/image-develop-frame-core.ts';
import { defaultImageDevelopStateV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import { normalizeImageDevelopStateCurrentV1 } from '../src/common/editor/imaging/image-develop-state-current-v1.ts';
import { PHOTO_DEVELOP_LINEAR_LIMITS_V1 as PROFILE } from '../src/common/editor/photo-library-develop-linear-port-v1.ts';
import { createVideoEffect } from '../src/common/editor/video-effects.js';
import { parseCubeLutV1 } from '../src/common/editor/video-color-cube-lut-v27.ts';
import type { CubeLutSourcePortV1 } from '../src/common/editor/imaging/cube-lut-source-port-v1.ts';
import { withPreparedBrushMaskResourceV1 } from '../src/common/editor/imaging/brush-mask-resource-v1.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

const OWNER = new URL('../src/common/editor/imaging/image-develop-gpu-current-v1.ts', import.meta.url);
interface Execution { readonly backend: 'webgl2' | 'cpu'; readonly reason?: string }
interface Module {
	withImageDevelopGpuCurrentV1<Result>(value: unknown,
		consume: (frame: Readonly<LinearWorkingPixelFrameV1>, execution: Readonly<Execution>, overlay?: Readonly<ImageDevelopMaskOverlayViewV1>) => Result | Promise<Result>,
		profile: ImageDevelopFrameProfile, options?: ImageDevelopFrameOptionsV3): Promise<Result>;
}
async function owner(): Promise<Module> {
	assert.ok(existsSync(OWNER), 'The complete-recipe GPU broker must exist.');
	return await import(OWNER.href) as Module;
}
const frame = (values: readonly number[]) => ({ descriptor: { schemaVersion: 1 as const, width: values.length / 4, height: 1,
	sampleFormat: 'float32' as const, primaries: 'srgb' as const, transfer: 'linear' as const }, pixels: Float32Array.from(values) });
const recipe = (effects: readonly unknown[]) => normalizeImageDevelopStateCurrentV1({ ...defaultImageDevelopStateV2(), effects });
function cpu(execution: Readonly<Execution>): void {
	assert.equal(execution.backend, 'cpu'); assert.equal(typeof execution.reason, 'string'); assert.ok(execution.reason!.length > 0);
}
function lut() {
	const text = 'LUT_3D_SIZE 2\n0 0 0\n0 0 1\n0 1 0\n0 1 1\n1 0 0\n1 0 1\n1 1 0\n1 1 1', body = parseCubeLutV1(text);
	return { bytes: new TextEncoder().encode(text), reference: { storageKey: `lut-sha256:${body.sha256}`, sha256: body.sha256,
		byteLength: body.byteLength, size: body.size, domainMin: body.domainMin, domainMax: body.domainMax } };
}
function opaque() { const value = Proxy.revocable({}, {}); value.revoke(); return value.proxy; }
function outcome<Value>(work: Promise<Value>) {
	return work.then(value => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }));
}

test('without a native canvas the complete tone recipe evaluates signed HDR through the real CPU engine', async () => {
	const api = await owner(), source = frame([.16, .785, 4, .375, -.18, -.18, -.18, 1]), before = source.pixels.slice();
	const develop = recipe([createVideoEffect('tone-ladder-v1', { id: 'tone', params: {
		exposure: 1, contrast: -50, highlights: -100, shadows: 100, whites: -100, blacks: 100,
	} })]);
	const expected = await withImageDevelopLinearCurrentV1({ frame: source, develop }, output => [...output.pixels], PROFILE);
	let delivered = 0, borrowed: Float32Array | undefined;
	const result = await api.withImageDevelopGpuCurrentV1({ frame: source, develop }, (output, execution) => {
		cpu(execution); delivered++; borrowed = output.pixels; return [...output.pixels];
	}, PROFILE);
	assert.deepEqual(result, [.375, .5390625, Math.fround(3.59), .375, Math.fround(.41), Math.fround(.41), Math.fround(.41), 1]);
	assert.deepEqual(result, expected); assert.deepEqual(source.pixels, before); assert.equal(delivered, 1);
	assert.ok(borrowed?.every(value => value === 0));
});

test('unsupported mixed recipes preserve original-space Clone, masks, geometry, spatial order and observed overlay', async () => {
	const api = await owner(), source = frame([.125, -.25, 2, .5, .25, .375, .5, 1, 9, 8, 7, .75]), before = source.pixels.slice();
	const develop = normalizeImageDevelopStateCurrentV1({ ...defaultImageDevelopStateV2(), processVersion: 3,
		repairs: { schemaVersion: 1, spots: [{ id: 'clone', mode: 'clone', enabled: true, target: { x: 5 / 6, y: .5 },
			source: { x: 1 / 6, y: .5 }, radius: .1, feather: 0, opacity: 1 }] },
		effects: [createVideoEffect('tone-ladder-v1', { id: 'tone', params: { exposure: 1 } }),
			createVideoEffect('develop-geometry-v1', { id: 'rotate', params: { rotationDegrees: 90 } }),
			createVideoEffect('detail-sharpen-v1', { id: 'detail', params: { amount: 50, threshold: 0 } })],
		masks: [{ schemaVersion: 1, id: 'local', kind: 'mask', inputs: [],
			nodes: [{ id: 'rect', kind: 'vector-shape', shape: 'rectangle', x: 0, y: 0, width: 1 / 3, height: 1 }], outputNodeId: 'rect' }],
		maskBindings: [{ maskId: 'local', effectId: 'tone' }],
	});
	const request = { frame: source, develop, maskOverlay: { maskId: 'local', effectId: 'tone' } };
	const expected = await withImageDevelopLinearCurrentV1(request, (output, overlay) => ({ descriptor: output.descriptor,
		pixels: [...output.pixels], overlay: overlay && { ...overlay, coverage: [...overlay.coverage] } }), PROFILE);
	let coverage: Uint8Array | undefined, pixels: Float32Array | undefined, delivered = 0;
	const actual = await api.withImageDevelopGpuCurrentV1(request, (output, execution, overlay) => {
		cpu(execution); delivered++; assert.ok(overlay); coverage = overlay.coverage; pixels = output.pixels;
		return { descriptor: output.descriptor, pixels: [...output.pixels], overlay: { ...overlay, coverage: [...overlay.coverage] } };
	}, PROFILE);
	assert.deepEqual(actual, expected); assert.equal(actual.descriptor.width, 1); assert.equal(actual.descriptor.height, 3);
	assert.deepEqual(actual.overlay.coverage, [255, 0, 0]); assert.equal(delivered, 1); assert.deepEqual(source.pixels, before);
	assert.ok(coverage?.every(value => value === 0)); assert.ok(pixels?.every(value => value === 0));
	for (const changed of [{ ...develop, repairs: { schemaVersion: 1, spots: [] } }, { ...develop, maskBindings: [] },
		{ ...develop, effects: develop.effects.filter(value => value.id !== 'detail') }, { ...develop, effects: [...develop.effects].reverse() }]) {
		const different = await withImageDevelopLinearCurrentV1({ frame: source, develop: changed }, output => [...output.pixels], PROFILE);
		assert.notDeepEqual(actual.pixels, different, 'Each retained repair, local binding, spatial stage and authored order affects the result.');
	}
});

test('GPU authentication and whole CPU fallback share the captured native source and pinned resource method', async () => {
	const api = await owner(), resource = lut(), source = frame([.125, .25, .5, .375]), entered = deferred<void>(), release = deferred<void>();
	let reads = 0, delivered = 0;
	const port: CubeLutSourcePortV1 = { async withBytes(reference, consume) {
		assert.equal(this, port); reads++; assert.deepEqual(reference, resource.reference); entered.resolve(); await release.promise; return consume(resource.bytes);
	} };
	const develop = recipe([{ id: 'lut', type: 'cube-lut-profile-v1', enabled: true, params: { lut: resource.reference } }]);
	const work = api.withImageDevelopGpuCurrentV1({ frame: source, develop }, (output, execution) => {
		cpu(execution); delivered++; return [...output.pixels];
	}, PROFILE, { source: port }); void work.catch(() => undefined);
	try {
		await Promise.race([entered.promise, work.then(() => assert.fail('The resource must be borrowed before delivery.'))]);
		source.pixels.fill(.75); port.withBytes = () => { throw new Error('A replaced resource method has no authority.'); };
		assert.equal(await remainsPending(work), true); release.resolve(); assert.deepEqual(await work, [.5, .25, .125, .375]);
		assert.equal(reads, 2, 'GPU authentication retires before the separate whole CPU phase.');
		assert.equal(delivered, 1); assert.deepEqual([...source.pixels], [.75, .75, .75, .75]);
	} finally { release.resolve(); await Promise.allSettled([work]); }
});

test('fallback captures Original samples synchronously before its first asynchronous continuation', async () => {
	const api = await owner(), source = frame([-.25, .125, 4, .375]), before = source.pixels.slice();
	const work = api.withImageDevelopGpuCurrentV1({ frame: source, develop: recipe([createVideoEffect('tone-ladder-v1', { id: 'tone', params: { exposure: 1 } })]) },
		(output, execution) => { cpu(execution); return [...output.pixels]; }, PROFILE);
	source.pixels.fill(0); assert.deepEqual(await work, [-.5, .25, 8, .375]);
	assert.deepEqual([...before], [-.25, .125, 4, .375]); assert.ok(source.pixels.every(value => value === 0));
});

test('unsupported CPU fallback cannot replace the captured source geometry with a later smaller descriptor', async () => {
	const api = await owner(), original = frame([.125, .25, .5, 1]); let descriptors = 0, deliveries = 0;
	const source = new Proxy(original, { getOwnPropertyDescriptor(target, key) {
		const descriptor = Reflect.getOwnPropertyDescriptor(target, key);
		return key === 'descriptor' && descriptor ? { ...descriptor, value: { ...original.descriptor, width: ++descriptors === 1 ? 2 : 1 } } : descriptor;
	} });
	const develop = recipe([createVideoEffect('develop-geometry-v1', { id: 'rotate', params: { rotationDegrees: 90 } })]);
	await assert.rejects(api.withImageDevelopGpuCurrentV1({ frame: source, develop }, () => { deliveries++; }, PROFILE));
	assert.ok(descriptors >= 1); assert.equal(deliveries, 0);
	assert.deepEqual([...original.pixels], [.125, .25, .5, 1]);
});

test('held CPU fallback consumers join opaque cancellation once and retire their native plane afterward', async () => {
	const api = await owner(), source = frame([-.25, .125, 4, .375]), before = source.pixels.slice(), stop = new AbortController(), reason = opaque();
	const entered = deferred<void>(), release = deferred<void>(); let deliveries = 0, backing: ArrayBuffer | undefined;
	const work = api.withImageDevelopGpuCurrentV1({ frame: source, develop: recipe([]), signal: stop.signal }, async (output, execution) => {
		cpu(execution); deliveries++; backing = output.pixels.buffer; entered.resolve(); await release.promise;
	}, PROFILE), settled = outcome(work);
	try {
		await Promise.race([entered.promise, settled]); assert.ok(backing); stop.abort(reason);
		assert.equal(await remainsPending(settled), true); assert.ok(new Uint8Array(backing).some(value => value !== 0));
		release.resolve(); const result = await settled; assert.equal(result.ok, false);
		if (result.ok) assert.fail('A held abort must reject.'); assert.ok(Object.is(result.error, reason)); assert.equal(deliveries, 1);
		assert.ok(new Uint8Array(backing).every(value => value === 0)); assert.deepEqual(source.pixels, before);
	} finally { release.resolve(); await Promise.allSettled([work]); }
});

test('a consumer failure is not retried and remains distinct from detached-output retirement failure', async () => {
	const api = await owner(), source = frame([-.25, .125, 4, .375]), before = source.pixels.slice(), reason = opaque(); let deliveries = 0;
	const result = await outcome(api.withImageDevelopGpuCurrentV1({ frame: source, develop: recipe([]) }, (output, execution) => {
		cpu(execution); deliveries++; const backing = output.pixels.buffer; structuredClone(backing, { transfer: [backing] }); throw reason;
	}, PROFILE));
	assert.equal(result.ok, false); if (result.ok) assert.fail('Consumer and retirement failures must reject.');
	const error = result.error; assert.ok(!Object.is(error, reason) && error instanceof AggregateError);
	assert.ok(error.errors.some((value: unknown) => Object.is(value, reason)));
	assert.ok(error.errors.some((value: unknown) => !Object.is(value, reason) && value instanceof TypeError));
	assert.equal(deliveries, 1); assert.deepEqual(source.pixels, before);
});

test('closed recipe and resource authority failures precede source pixel admission even for fallback', async () => {
	const api = await owner(), resource = lut(); let reads = 0, deliveries = 0;
	const source = new Proxy(frame([.125, .25, .5, 1]), { getOwnPropertyDescriptor(target, key) {
		if (key === 'pixels') { reads++; throw new Error('Metadata must fail before source admission.'); } return Reflect.getOwnPropertyDescriptor(target, key);
	} });
	const consume = () => { deliveries++; };
	for (const develop of [recipe([createVideoEffect('rgb-split', { id: 'inactive-unsupported', enabled: false })]),
		recipe([{ id: 'lut', type: 'cube-lut-profile-v1', enabled: true, params: { lut: resource.reference } }]),
		{ ...defaultImageDevelopStateV2(), effects: [createVideoEffect('tone-ladder-v1', { id: 'duplicate' }), createVideoEffect('white-balance-v1', { id: 'duplicate' })] },
	]) await assert.rejects(api.withImageDevelopGpuCurrentV1({ frame: source, develop }, consume, PROFILE));
	await withPreparedBrushMaskResourceV1({ width: 1, height: 1, alpha: Uint8Array.of(255) }, async brush => {
		const develop = { ...recipe([createVideoEffect('tone-ladder-v1', { id: 'tone', params: { exposure: 1 } })]),
			masks: [{ schemaVersion: 1, id: 'local', kind: 'mask', inputs: [{ name: 'paint', sourceRef: brush.reference.storageKey, kind: 'alpha' }],
				nodes: [{ id: 'paint', kind: 'alpha', inputName: 'paint' }], outputNodeId: 'paint' }], maskBindings: [{ maskId: 'local', effectId: 'tone' }] };
		await assert.rejects(api.withImageDevelopGpuCurrentV1({ frame: source, develop }, consume, PROFILE));
	});
	assert.equal(reads, 0); assert.equal(deliveries, 0);
});

test('corrupt authenticated resource bodies stay errors and cannot trigger delivery or a second fallback attempt', async () => {
	const api = await owner(), resource = lut(), bytes = resource.bytes.slice(); bytes[bytes.length - 1]! ^= 1;
	let reads = 0, deliveries = 0;
	const source: CubeLutSourcePortV1 = { withBytes(_reference, consume) { reads++; return Promise.resolve(consume(bytes)); } };
	await assert.rejects(api.withImageDevelopGpuCurrentV1({ frame: frame([.125, .25, .5, 1]),
		develop: recipe([{ id: 'lut', type: 'cube-lut-profile-v1', enabled: true, params: { lut: resource.reference } }]) },
		() => { deliveries++; }, PROFILE, { source }));
	assert.equal(reads, 1); assert.equal(deliveries, 0);
});

test('opaque pre-abort wins before closed metadata, resource or source access', async () => {
	const api = await owner(), reason = opaque(), stop = new AbortController(); stop.abort(reason); let reads = 0;
	const value = { signal: stop.signal, get frame(): never { reads++; throw new Error('No aborted frame access.'); },
		get develop(): never { reads++; throw new Error('No aborted recipe access.'); } };
	const result = await outcome(api.withImageDevelopGpuCurrentV1(value, () => { reads++; }, PROFILE));
	assert.equal(result.ok, false); if (result.ok) assert.fail('Pre-abort must reject.'); assert.ok(Object.is(result.error, reason));
	assert.equal(reads, 0);
});
