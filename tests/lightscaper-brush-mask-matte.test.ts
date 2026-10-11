/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultImageDevelopStateV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import { admitImageDevelopBrushMaskAuthorityV1, prepareImageDevelopBrushMasksV1 } from '../src/common/editor/imaging/image-develop-brush-mask-v1.ts';
import { planImageDevelopMasksV1 } from '../src/common/editor/imaging/image-develop-mask-plan-v1.ts';
import { withPreparedBrushMaskResourceV1, type PreparedBrushMaskResourceV1 } from '../src/common/editor/imaging/brush-mask-resource-v1.ts';
import type { MaskRasterSourcePortV1 } from '../src/common/editor/imaging/mask-raster-source-port-v1.ts';
import { withMaskRasterSourceScopeV1, scopedBrushMaskResourceV1 } from '../src/common/editor/imaging/mask-raster-source-scope-v1.ts';
import { withVideoMaskMatteBrushV1, withVideoMaskMatteBrushScopeV1, withVideoMaskMatteRgbaV1,
	evaluateVideoMaskMatteRgbaV13 } from '../src/common/editor/video-mask-matte-rgba-v13.ts';
import { createVideoEffect } from '../src/common/editor/video-effects.js';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

const LIMITS = Object.freeze({ maximumSidePixels: 65_536, maximumPixels: 67_108_864, maximumBytes: 268_435_456 });
async function resource(width: number, height: number, alpha: readonly number[]): Promise<Readonly<PreparedBrushMaskResourceV1>> {
	return withPreparedBrushMaskResourceV1({ width, height, alpha: new Uint8Array(alpha) }, value =>
		Object.freeze({ reference: value.reference, bytes: new Uint8Array(value.bytes) }));
}
function brush(sourceRef: string, channel = 'alpha') {
	return { schemaVersion: 1, id: 'mask', kind: 'mask', inputs: [{ name: 'Brush', sourceRef, kind: 'raster' }],
		nodes: [{ id: 'alpha', kind: 'raster', inputName: 'Brush', channel }], outputNodeId: 'alpha' };
}
function recipe(graph: unknown, bound = true) {
	return { ...defaultImageDevelopStateV2(), effects: [createVideoEffect('tone-ladder-v1', { id: 'tone', params: { exposure: 1 } })],
		masks: [graph], maskBindings: bound ? [{ effectId: 'tone', maskId: 'mask' }] : [] };
}
function source(body: Readonly<PreparedBrushMaskResourceV1>, calls: string[] = []): Readonly<MaskRasterSourcePortV1> {
	return Object.freeze({ async withBytes<Result>(reference: Readonly<PreparedBrushMaskResourceV1['reference']>,
		consume: (bytes: Uint8Array<ArrayBuffer>) => Result | Promise<Result>): Promise<Result> {
		calls.push(reference.storageKey); assert.equal(reference.storageKey, body.reference.storageKey);
		return await consume(new Uint8Array(body.bytes));
	} } satisfies MaskRasterSourcePortV1);
}
function frame(pixels: readonly number[]) {
	return { descriptor: { schemaVersion: 1 as const, width: pixels.length / 4, height: 1,
		sampleFormat: 'unorm8' as const, primaries: 'srgb' as const, transfer: 'srgb' as const }, pixels: new Uint8Array(pixels) };
}

test('authenticated alpha uses exact nearest row-major sampling without RGBA expansion or transfer', async () => {
	const body = await resource(2, 2, [0, 64, 128, 255]), graph = brush(body.reference.storageKey);
	for (const [width, height, expected] of [[4, 2, [0, 0, 64, 64, 128, 128, 255, 255]], [1, 1, [0]], [2, 2, [0, 64, 128, 255]]] as const) {
		let borrowed: Uint8Array | undefined;
		assert.deepEqual(await withVideoMaskMatteBrushV1({ graph, width, height }, coverage => {
			borrowed = coverage; return [...coverage];
		}, source(body)), expected);
		assert.ok(borrowed?.every(byte => byte === 0));
	}
	const unequal = await resource(2, 1, [0, 255]);
	assert.deepEqual(await withVideoMaskMatteBrushV1({ graph: brush(unequal.reference.storageKey), width: 3, height: 1 }, coverage => [...coverage], source(unequal)), [0, 0, 255]);
});

test('brush alpha composes with existing invert and boolean arithmetic, while legacy RGBA luma stays encoded', async () => {
	const body = await resource(2, 2, [0, 64, 128, 255]), graph = brush(body.reference.storageKey);
	const mixed = { ...graph, nodes: [...graph.nodes, { id: 'inverse', kind: 'invert', inputNodeId: 'alpha' },
		{ id: 'both', kind: 'boolean', operation: 'intersect', inputNodeIds: ['alpha', 'inverse'] }], outputNodeId: 'both' };
	assert.deepEqual(await withVideoMaskMatteBrushV1({ graph: mixed, width: 2, height: 2 }, coverage => [...coverage], source(body)), [0, 64, 127, 0]);
	const legacy = brush('legacy', 'luma');
	assert.deepEqual([...evaluateVideoMaskMatteRgbaV13(legacy, 1, 1,
		new Map([['legacy', { width: 1, height: 1, pixels: new Uint8Array([128, 128, 128, 255]) }]]))], [128]);
	await assert.rejects(withVideoMaskMatteRgbaV1({ graph, width: 1, height: 1 }, () => undefined), /authority/iu);
	assert.throws(() => planImageDevelopMasksV1(recipe(graph), 1, 1, LIMITS), /authority/iu);
});

test('all declared brush inputs authenticate once, retaining only bound reachable alpha', async () => {
	const body = await resource(1, 1, [255]), extra = await resource(1, 1, [64]);
	const graph = { ...brush(body.reference.storageKey), inputs: [...brush(body.reference.storageKey).inputs,
		{ name: 'Unused', sourceRef: extra.reference.storageKey, kind: 'alpha' }] };
	const planned = prepareImageDevelopBrushMasksV1(recipe(graph), 2, 1, LIMITS);
	assert.deepEqual(planned.references.map(ref => ref.storageKey).sort(), [body.reference.storageKey, extra.reference.storageKey].sort());
	assert.deepEqual([...planned.retainedStorageKeys], [body.reference.storageKey]);
	assert.equal(prepareImageDevelopBrushMasksV1(recipe(graph, false), 2, 1, LIMITS).retainedStorageKeys.size, 0);
	let reads = 0;
	const corrupted: MaskRasterSourcePortV1 = { async withBytes(_reference, consume) {
		reads++; const bytes = new Uint8Array(body.bytes); bytes[16] = 0; return await consume(bytes);
	} };
	const unused = { ...graph, outputNodeId: 'solid', nodes: [...graph.nodes,
		{ id: 'solid', kind: 'linear-gradient', start: { x: 0, y: 0 }, end: { x: 1, y: 0 } }] };
	await assert.rejects(withVideoMaskMatteBrushV1({ graph: unused, width: 1, height: 1 }, () => undefined, corrupted), /SHA256|reference/iu);
	assert.equal(reads, 1);
});

test('complete channel and namespace admission refuses unreachable non-alpha nodes before source or current-frame traps', async () => {
	const body = await resource(1, 1, [255]); let traps = 0;
	const hostile = new Proxy({}, { ownKeys() { traps++; throw Error('Authority reflected'); }, get() { traps++; throw Error('Authority reflected'); } });
	for (const channel of ['red', 'green', 'blue', 'luma']) {
		const graph = { ...brush(body.reference.storageKey, channel), outputNodeId: 'solid', nodes: [
			...brush(body.reference.storageKey, channel).nodes, { id: 'solid', kind: 'linear-gradient', start: { x: 0, y: 0 }, end: { x: 1, y: 0 } }] };
		assert.throws(() => admitImageDevelopBrushMaskAuthorityV1(recipe(graph, false)), /alpha/iu);
		await assert.rejects(withVideoMaskMatteBrushV1({ graph, width: 1, height: 1, currentFrame: hostile }, () => undefined,
			hostile as MaskRasterSourcePortV1), /alpha/iu);
	}
	for (const sourceRef of ['foreign', `brush-mask-v2:1:1:${'a'.repeat(64)}`, `brush-mask-v1:01:1:${'a'.repeat(64)}`]) {
		assert.throws(() => admitImageDevelopBrushMaskAuthorityV1(recipe(brush(sourceRef), false)));
	}
	const graph = brush(body.reference.storageKey), develop = { ...recipe(graph), effects: [createVideoEffect('develop-geometry-v1', { id: 'tone' })] };
	assert.throws(() => admitImageDevelopBrushMaskAuthorityV1(develop), /geometry/iu);
	assert.equal(traps, 0);
});

test('planner uses true effect input geometry and charges retained alpha, four bodies, digest and overlay phases', async () => {
	const body = await resource(2, 1, [0, 255]), graph = brush(body.reference.storageKey);
	const scalar = prepareImageDevelopBrushMasksV1(recipe(graph), 4, 1, LIMITS);
	assert.equal(scalar.peakWorkingBytes, 4 + 2 + 4 * 18 + 64);
	const crop = createVideoEffect('develop-geometry-v1', { id: 'crop', params: { cropX: 0, cropY: 0, cropWidth: 0.5, cropHeight: 1, flipHorizontal: 1 } });
	const develop = { ...recipe(graph), effects: [...recipe(graph).effects, crop, createVideoEffect('tone-ladder-v1', { id: 'after' })],
		maskBindings: [{ effectId: 'tone', maskId: 'mask' }, { effectId: 'after', maskId: 'mask' }] };
	const selected = prepareImageDevelopBrushMasksV1(develop, 4, 1, LIMITS, { maskId: 'mask', effectId: 'tone' });
	assert.deepEqual(selected.plan.bindings.map(binding => [binding.width, binding.height]), [[4, 1], [2, 1]]);
	assert.equal(selected.plan.bindings[0]!.suffixGeometry.length, 1);
	assert.ok(selected.peakWorkingBytes >= scalar.peakWorkingBytes + 4 * 13 + 2);
	assert.throws(() => prepareImageDevelopBrushMasksV1(recipe(graph), 65_536, 1_024, LIMITS), /64 MiB|working.*budget/iu);
	let reads = 0;
	const port: MaskRasterSourcePortV1 = { async withBytes(_reference, _consume) { reads++; throw Error('Unaffordable source acquired'); } };
	await assert.rejects(withVideoMaskMatteBrushV1({ graph, width: 65_536, height: 1_024 }, () => undefined, port), /64 MiB|working.*budget/iu);
	assert.equal(reads, 0);
});

test('standalone mixed range captures exact current RGBA before the first held resource await', async () => {
	const body = await resource(2, 1, [128, 255]), graph = brush(body.reference.storageKey);
	const mixed = { ...graph, nodes: [...graph.nodes, { id: 'range', kind: 'luminance-range', lower: 0.1, upper: 0.2, falloff: 0.1 },
		{ id: 'both', kind: 'boolean', operation: 'intersect', inputNodeIds: ['alpha', 'range'] }], outputNodeId: 'both' };
	const currentFrame = frame([255, 0, 0, 255, 0, 0, 0, 255]), entered = deferred<void>(), release = deferred<void>();
	const port: MaskRasterSourcePortV1 = { async withBytes(_reference, consume) { entered.resolve(); await release.promise; return await consume(new Uint8Array(body.bytes)); } };
	const work = withVideoMaskMatteBrushV1({ graph: mixed, width: 2, height: 1, currentFrame }, coverage => [...coverage], port);
	try { await entered.promise; currentFrame.pixels.fill(0); } finally { release.resolve(); }
	assert.deepEqual(await work, [128, 0]);
	await assert.rejects(withVideoMaskMatteBrushV1({ graph: mixed, width: 2, height: 1 }, () => undefined, source(body)), /frame/iu);
});

test('genuine live scope renders borrowed alpha, while forged and retired scope identities cannot authorize sampling', async () => {
	const body = await resource(1, 1, [223]), graph = brush(body.reference.storageKey); let retired: unknown;
	assert.deepEqual(await withMaskRasterSourceScopeV1([body.reference], new Set([body.reference.storageKey]), source(body), async scope => {
		retired = scope; return await withVideoMaskMatteBrushScopeV1({ graph, width: 1, height: 1 }, coverage => [...coverage], scope);
	}), [223]);
	await assert.rejects(withVideoMaskMatteBrushScopeV1({ graph, width: 1, height: 1 }, () => undefined, retired), /scope|retir|active/iu);
	await assert.rejects(withVideoMaskMatteBrushScopeV1({ graph, width: 1, height: 1 }, () => undefined,
		Object.freeze({ kind: 'mask-raster-source-scope-v1' })), /scope|authentic|active/iu);
});

test('held borrowed coverage joins before opaque cancellation settles and every coverage byte is wiped', async () => {
	const body = await resource(1, 1, [128]), entered = deferred<void>(), release = deferred<void>(), stop = new AbortController();
	const revoked = Proxy.revocable({}, {}); revoked.revoke(); let borrowed: Uint8Array | undefined;
	const work = withVideoMaskMatteBrushV1({ graph: brush(body.reference.storageKey), width: 4, height: 1, signal: stop.signal }, async coverage => {
		borrowed = coverage; entered.resolve(); await release.promise;
	}, source(body));
	const outcome = work.then(() => ({ ok: true as const }), (error: unknown) => ({ ok: false as const, error }));
	try {
		await entered.promise; stop.abort(revoked.proxy); assert.equal(await remainsPending(work), true);
		assert.deepEqual(borrowed && [...borrowed], [128, 128, 128, 128]);
	} finally { release.resolve(); }
	const result = await outcome; assert.equal(result.ok, false); if (!result.ok) assert.equal(Object.is(result.error, revoked.proxy), true);
	assert.ok(borrowed?.every(byte => byte === 0));
});

test('a graph subset cannot hide the live retained resource peak of its genuine scope', async () => {
	const body = await resource(1, 1, [128]);
	const extra = await withPreparedBrushMaskResourceV1({ width: 1_024, height: 1_024, alpha: new Uint8Array(1_048_576) }, value =>
		Object.freeze({ reference: value.reference, bytes: new Uint8Array(value.bytes) }));
	const graph = brush(body.reference.storageKey), nodes: unknown[] = [...graph.nodes];
	for (let index = 1; index <= 9; index++) nodes.push({ id: `inverse-${index}`, kind: 'invert', inputNodeId: index === 1 ? 'alpha' : `inverse-${index - 1}` });
	const chained = { ...graph, nodes, outputNodeId: 'inverse-9' }, bodies = new Map([[body.reference.storageKey, body], [extra.reference.storageKey, extra]]);
	const port: MaskRasterSourcePortV1 = { async withBytes(reference, consume) {
		const selected = bodies.get(reference.storageKey); assert.ok(selected); return await consume(new Uint8Array(selected.bytes));
	} };
	let delivered = 0, budgetFailure: unknown;
	const parent = withMaskRasterSourceScopeV1([body.reference, extra.reference], new Set(bodies.keys()), port, async scope => {
		// Ten 8192×768 graph planes are60MiB. The graph's tiny body fits,
		// while the genuine scope's extra retained1MiB+four auth spans do not.
		const child = await withVideoMaskMatteBrushScopeV1({ graph: chained, width: 8_192, height: 768 }, () => { delivered++; }, scope)
			.then(() => ({ ok: true as const }), (error: unknown) => ({ ok: false as const, error }));
		assert.equal(child.ok, false); if (!child.ok) {
			budgetFailure = child.error; assert.ok(child.error instanceof RangeError); assert.match(child.error.message, /64 MiB|working.*budget/iu);
		}
	});
	const result = await parent.then(() => ({ ok: true as const }), (error: unknown) => ({ ok: false as const, error }));
	assert.equal(result.ok, false); if (!result.ok) assert.equal(Object.is(result.error, budgetFailure), true); assert.equal(delivered, 0);
});

test('yielded scoped graph observes its native scope cancellation with absent or independent request signal', async () => {
	const body = await resource(1, 1, [128]), graph = brush(body.reference.storageKey);
	for (const independent of [false, true]) {
		const stop = new AbortController(), requestStop = new AbortController(), revoked = Proxy.revocable({}, {}); revoked.revoke();
		let delivered = 0, child: Promise<{ ok: true } | { ok: false; error: unknown }> | undefined;
		const parent = withMaskRasterSourceScopeV1([body.reference], new Set([body.reference.storageKey]), source(body), async scope => {
			const work = withVideoMaskMatteBrushScopeV1({ graph, width: 1_024, height: 128,
				...(independent ? { signal: requestStop.signal } : {}) }, () => { delivered++; }, scope);
			child = work.then(() => ({ ok: true as const }), (error: unknown) => ({ ok: false as const, error }));
			await Promise.resolve(); assert.equal(delivered, 0); stop.abort(revoked.proxy); await child;
		}, stop.signal);
		const parentResult = await parent.then(() => ({ ok: true as const }), (error: unknown) => ({ ok: false as const, error }));
		assert.equal(parentResult.ok, false); if (!parentResult.ok) assert.equal(Object.is(parentResult.error, revoked.proxy), true);
		assert.ok(child); const result = await child; assert.equal(result.ok, false);
		if (!result.ok) assert.equal(Object.is(result.error, revoked.proxy), true);
		assert.equal(delivered, 0); assert.equal(requestStop.signal.aborted, false);
	}
});

test('scoped consumer joins before native scope cancellation rejects independently of the request signal', async () => {
	const body = await resource(1, 1, [128]), graph = brush(body.reference.storageKey);
	for (const independent of [false, true]) {
		const stop = new AbortController(), requestStop = new AbortController(), entered = deferred<void>(), release = deferred<void>();
		const revoked = Proxy.revocable({}, {}); revoked.revoke(); let borrowed: Uint8Array | undefined;
		let child: Promise<{ ok: true } | { ok: false; error: unknown }> | undefined;
		const parent = withMaskRasterSourceScopeV1([body.reference], new Set([body.reference.storageKey]), source(body), async scope => {
			const work = withVideoMaskMatteBrushScopeV1({ graph, width: 4, height: 1,
				...(independent ? { signal: requestStop.signal } : {}) }, async coverage => {
				borrowed = coverage; entered.resolve(); await release.promise;
			}, scope);
			child = work.then(() => ({ ok: true as const }), (error: unknown) => ({ ok: false as const, error })); await child;
		}, stop.signal);
		const outcome = parent.then(() => ({ ok: true as const }), (error: unknown) => ({ ok: false as const, error }));
		try {
			await Promise.race([entered.promise, outcome.then(result => { if (!result.ok) throw result.error; throw Error('Scoped consumer was not entered.'); })]);
			stop.abort(revoked.proxy); assert.equal(await remainsPending(parent), true);
			assert.ok(child); assert.equal(await remainsPending(child), true); assert.deepEqual(borrowed && [...borrowed], [128, 128, 128, 128]);
		} finally { release.resolve(); await outcome; if (child) await child; }
		const result = await outcome; assert.equal(result.ok, false); if (!result.ok) assert.equal(Object.is(result.error, revoked.proxy), true);
		assert.ok(child); const childResult = await child; assert.equal(childResult.ok, false);
		if (!childResult.ok) assert.equal(Object.is(childResult.error, revoked.proxy), true);
		assert.ok(borrowed?.every(byte => byte === 0)); assert.equal(requestStop.signal.aborted, false);
	}
});

test('parent scope joins an ignored admitted evaluator before retiring alpha or publishing a partial zero frame', async () => {
	const body = await resource(1, 1, [128]), graph = brush(body.reference.storageKey), entered = deferred<void>(), release = deferred<void>();
	let alpha: Uint8Array | undefined, borrowed: Uint8Array | undefined;
	let child: Promise<{ ok: true } | { ok: false; error: unknown }> | undefined;
	const parent = withMaskRasterSourceScopeV1([body.reference], new Set([body.reference.storageKey]), source(body), scope => {
		alpha = scopedBrushMaskResourceV1(scope, body.reference.storageKey).alpha;
		const work = withVideoMaskMatteBrushScopeV1({ graph, width: 1_024, height: 128 }, async coverage => {
			borrowed = coverage; entered.resolve(); await release.promise;
		}, scope);
		child = work.then(() => ({ ok: true as const }), (error: unknown) => ({ ok: false as const, error }));
		return 'parent consumer returned';
	});
	const outcome = parent.then(value => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }));
	try {
		await Promise.race([entered.promise, outcome.then(async parentResult => {
			if (!parentResult.ok) throw parentResult.error;
			assert.ok(child); const result = await child; if (!result.ok) throw result.error; throw Error('Ignored evaluator did not enter its consumer.');
		})]);
		assert.equal(await remainsPending(parent), true); assert.equal(alpha?.[0], 128);
		assert.equal(borrowed?.[0], 128); assert.equal(borrowed?.[borrowed.length - 1], 128);
	} finally { release.resolve(); await outcome; if (child) await child; }
	const result = await outcome; assert.equal(result.ok, true); if (result.ok) assert.equal(result.value, 'parent consumer returned');
	assert.ok(child); assert.equal((await child).ok, true); assert.ok(alpha?.every(byte => byte === 0)); assert.ok(borrowed?.every(byte => byte === 0));
});

test('scoped work claim preserves exact current-range frame capture before the public first yield', async () => {
	const body = await resource(2, 1, [128, 255]), graph = brush(body.reference.storageKey);
	const mixed = { ...graph, nodes: [...graph.nodes, { id: 'range', kind: 'luminance-range', lower: 0.1, upper: 0.2, falloff: 0.1 },
		{ id: 'both', kind: 'boolean', operation: 'intersect', inputNodeIds: ['alpha', 'range'] }], outputNodeId: 'both' };
	const currentFrame = frame([255, 0, 0, 255, 0, 0, 0, 255]);
	const result = await withMaskRasterSourceScopeV1([body.reference], new Set([body.reference.storageKey]), source(body), scope => {
		const child = withVideoMaskMatteBrushScopeV1({ graph: mixed, width: 2, height: 1, currentFrame }, coverage => [...coverage], scope);
		currentFrame.pixels.fill(0); return child;
	});
	assert.deepEqual(result, [128, 0]);
});

test('one genuine scope refuses a concurrent graph before request reflection and admits the next graph after joining', async () => {
	const body = await resource(1, 1, [128]), graph = brush(body.reference.storageKey), entered = deferred<void>(), release = deferred<void>();
	let reflected = 0, delivered = 0, borrowed: Uint8Array | undefined, alpha: Uint8Array | undefined;
	const reflect = () => { reflected++; throw Error('Concurrent request metadata reflected.'); };
	const hostile = new Proxy({}, { ownKeys: reflect, getOwnPropertyDescriptor: reflect, get: reflect, getPrototypeOf: reflect });
	await withMaskRasterSourceScopeV1([body.reference], new Set([body.reference.storageKey]), source(body), async scope => {
		alpha = scopedBrushMaskResourceV1(scope, body.reference.storageKey).alpha;
		const first = withVideoMaskMatteBrushScopeV1({ graph, width: 4, height: 1 }, async coverage => {
			borrowed = coverage; entered.resolve(); await release.promise; return 'first';
		}, scope);
		const outcome = first.then(value => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }));
		try {
			await Promise.race([entered.promise, outcome.then(result => { if (!result.ok) throw result.error; throw Error('First graph did not enter its consumer.'); })]);
			const second = await withVideoMaskMatteBrushScopeV1(hostile, () => { delivered++; }, scope)
				.then(() => ({ ok: true as const }), (error: unknown) => ({ ok: false as const, error }));
			assert.equal(reflected, 0); assert.equal(second.ok, false);
			if (!second.ok) { assert.ok(second.error instanceof TypeError); assert.match(second.error.message, /active|serial|busy/iu); }
			assert.equal(await remainsPending(first), true); assert.deepEqual([...alpha], [128]); assert.deepEqual(borrowed && [...borrowed], [128, 128, 128, 128]);
		} finally { release.resolve(); await outcome; }
		const result = await outcome; assert.equal(result.ok, true); if (result.ok) assert.equal(result.value, 'first');
		assert.ok(borrowed?.every(byte => byte === 0));
		assert.deepEqual(await withVideoMaskMatteBrushScopeV1({ graph, width: 2, height: 1 }, coverage => [...coverage], scope), [128, 128]);
	});
	assert.equal(reflected, 0); assert.equal(delivered, 0); assert.ok(alpha?.every(byte => byte === 0));
});
