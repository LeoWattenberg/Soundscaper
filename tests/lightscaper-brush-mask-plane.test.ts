/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { BRUSH_MASK_PLANE_LIMITS_V1, createBrushMaskHistoryV1, normalizeBrushMaskHistoryV1, normalizeBrushMaskStrokeV1,
	appendBrushMaskStrokeV1, undoBrushMaskHistoryV1, redoBrushMaskHistoryV1, withBrushMaskPlaneV1 } from '../src/common/editor/imaging/brush-mask-plane-v1.ts';
import { assertDeepFrozen } from './helpers/frozen-contract-assertions.ts';
import { deferred, settle } from './helpers/async-test-control.ts';

function stroke(mode: 'paint' | 'erase' = 'paint', opacity = 1, hardness = 0, radius = 1, points = [{ x: 0.5, y: 0.5 }]) {
	return { mode, radius, hardness, opacity, points };
}
async function replay(width: number, height: number, strokes: readonly ReturnType<typeof stroke>[], base = new Uint8Array(width * height)) {
	let history = createBrushMaskHistoryV1(); for (const value of strokes) history = appendBrushMaskStrokeV1(history, value);
	return await withBrushMaskPlaneV1({ width, height, baseAlpha: base, history }, alpha => [...alpha]);
}

test('brush stamp has independent pixel-center, soft edge, paint and erase byte literals', async () => {
	assert.deepEqual(await replay(4, 1, [stroke()]), [0, 128, 128, 0]);
	assert.deepEqual(await replay(4, 1, [stroke('paint', 0.5)]), [0, 64, 64, 0]);
	assert.deepEqual(await replay(4, 1, [stroke('paint', 0.5)], new Uint8Array([0, 64, 128, 255])), [0, 112, 160, 255]);
	assert.deepEqual(await replay(4, 1, [stroke('erase', 0.5)], new Uint8Array([0, 64, 128, 255])), [0, 48, 96, 255]);
	assert.deepEqual(await replay(4, 1, [stroke('paint', 1, 0.5)]), [0, 255, 255, 0]);
	assert.deepEqual(await replay(5, 1, [stroke('paint', 1, 1)]), [0, 255, 255, 255, 0]);
	assert.deepEqual(await replay(3, 3, [stroke('paint', 1, 1, 1 / 3)]), [0, 255, 0, 255, 255, 255, 0, 255, 0]);
	assert.deepEqual(await replay(1, 1, [stroke('paint', 0), stroke('erase', 0)], new Uint8Array([93])), [93]);
});

test('deterministic capped segment spacing fills a drag and skips coincident endpoint over-stamps', async () => {
	const points = [{ x: 0.1, y: 0.5 }, { x: 0.9, y: 0.5 }];
	assert.deepEqual(await replay(5, 1, [stroke('paint', 1, 1, 0.25, points)]), [255, 255, 255, 255, 255]);
	assert.deepEqual(await replay(1, 1, [stroke('paint', 0.5, 1, 1, [{ x: 0.5, y: 0.5 }, { x: 0.5, y: 0.5 }])]), [128]);
	assert.deepEqual(await replay(5, 1, [stroke('paint', 1, 1, 0.25, [...points].reverse())]), [255, 255, 255, 255, 255]);
});

test('local immutable history retains base alpha through undo/redo and drops redo only when a new stroke is appended', async () => {
	const initial = createBrushMaskHistoryV1(); assert.deepEqual(initial, { schemaVersion: 1, strokes: [], cursor: 0 }); assertDeepFrozen(initial);
	const first = appendBrushMaskStrokeV1(initial, stroke('paint', 0.5, 1)), second = appendBrushMaskStrokeV1(first, stroke('erase', 1, 1));
	const undone = undoBrushMaskHistoryV1(second), redone = redoBrushMaskHistoryV1(undone);
	assert.deepEqual(undone, { schemaVersion: 1, strokes: second.strokes, cursor: 1 }); assert.deepEqual(redone, second); assertDeepFrozen(redone);
	const baseAlpha = new Uint8Array([64]);
	for (const [history, expected] of [[initial, 64], [first, 160], [second, 0], [undone, 160], [redone, 0]] as const) {
		assert.deepEqual(await withBrushMaskPlaneV1({ width: 1, height: 1, baseAlpha, history }, alpha => [...alpha]), [expected]);
	}
	const branched = appendBrushMaskStrokeV1(undone, stroke('paint', 0.5, 1));
	assert.equal(branched.strokes.length, 2); assert.equal(branched.strokes[1]!.mode, 'paint'); assert.equal(branched.cursor, 2);
	assert.deepEqual(redoBrushMaskHistoryV1(branched), branched); assert.deepEqual(undoBrushMaskHistoryV1(initial), initial);
	assert.deepEqual([...baseAlpha], [64]); assert.deepEqual(initial, { schemaVersion: 1, strokes: [], cursor: 0 });
});

test('closed canonical stroke/history admission detaches fields and never executes numeric or point accessors', () => {
	const value = stroke(), normalized = normalizeBrushMaskStrokeV1(value); assertDeepFrozen(normalized);
	value.points[0]!.x = 0; value.opacity = 0; assert.equal(normalized.points[0]!.x, 0.5); assert.equal(normalized.opacity, 1);
	let getters = 0;
	for (const key of ['radius', 'hardness', 'opacity']) for (const number of [-0, -0.1, 1.1, Infinity, NaN, '0.5', null]) {
		assert.throws(() => normalizeBrushMaskStrokeV1({ ...stroke(), [key]: number }));
	}
	assert.throws(() => normalizeBrushMaskStrokeV1(stroke('paint', 1, 0, 0)));
	for (const value of [{ ...stroke(), future: true }, { ...stroke(), mode: 'replace' }, { ...stroke(), points: [] },
		{ ...stroke(), points: [{ x: -0, y: 0.5 }] }, { ...stroke(), points: [{ x: 1.1, y: 0.5 }] },
		Object.defineProperty(stroke(), 'radius', { enumerable: true, get() { getters++; return 1; } }),
		{ ...stroke(), points: [Object.defineProperty({ y: 0.5 }, 'x', { enumerable: true, get() { getters++; return 0.5; } })] }]) {
		assert.throws(() => normalizeBrushMaskStrokeV1(value));
	}
	const sparse = [stroke(), stroke()]; Reflect.deleteProperty(sparse, '0');
	for (const value of [{ schemaVersion: 2, strokes: [], cursor: 0 }, { schemaVersion: 1, strokes: [], cursor: 1 },
		{ schemaVersion: 1, strokes: [stroke()], cursor: -0 }, { schemaVersion: 1, strokes: [stroke()], cursor: 0.5 },
		{ schemaVersion: 1, strokes: sparse, cursor: 0 }]) assert.throws(() => normalizeBrushMaskHistoryV1(value));
	assert.equal(getters, 0); assert.equal(normalizeBrushMaskStrokeV1(stroke('paint', 1, 1)).hardness, 1);
});

test('history stroke/point caps admit their exact boundaries and refuse overflow without changing predecessor', () => {
	assert.equal(BRUSH_MASK_PLANE_LIMITS_V1.maximumStrokes, 64); assert.equal(BRUSH_MASK_PLANE_LIMITS_V1.maximumPoints, 4096);
	assert.equal(BRUSH_MASK_PLANE_LIMITS_V1.maximumStamps, 65_536); assert.equal(BRUSH_MASK_PLANE_LIMITS_V1.maximumPixelVisits, 16_777_216);
	let history = createBrushMaskHistoryV1(); for (let index = 0; index < 64; index++) history = appendBrushMaskStrokeV1(history, stroke());
	assert.equal(history.strokes.length, 64); const before = JSON.stringify(history); assert.throws(() => appendBrushMaskStrokeV1(history, stroke()));
	assert.equal(JSON.stringify(history), before);
	const points = Array.from({ length: 4096 }, () => ({ x: 0.5, y: 0.5 }));
	const full = appendBrushMaskStrokeV1(createBrushMaskHistoryV1(), stroke('paint', 1, 1, 1, points));
	assert.equal(full.strokes[0]!.points.length, 4096); assert.throws(() => appendBrushMaskStrokeV1(full, stroke()));
	assert.throws(() => normalizeBrushMaskStrokeV1(stroke('paint', 1, 1, 1, [...points, { x: 0.5, y: 0.5 }])));
});

test('preflight refuses excessive replay work before source reflection and native backing stays exact', async () => {
	let reflected = 0, delivered = 0;
	const hostile = new Proxy({}, { getOwnPropertyDescriptor() { reflected++; throw Error('Unaffordable alpha read'); } });
	const repeated = { schemaVersion: 1, strokes: Array.from({ length: 64 }, () => stroke('paint', 1, 1)), cursor: 64 };
	await assert.rejects(withBrushMaskPlaneV1({ width: 1024, height: 1024, baseAlpha: hostile, history: repeated }, () => { delivered++; }), /work|visit|budget/iu);
	const points = Array.from({ length: 4096 }, (_, index) => ({ x: index % 2, y: 0.5 }));
	await assert.rejects(withBrushMaskPlaneV1({ width: 1024, height: 1, baseAlpha: hostile,
		history: { schemaVersion: 1, strokes: [stroke('paint', 1, 1, 0.001, points)], cursor: 1 } }, () => { delivered++; }), /work|stamp|budget/iu);
	assert.equal(reflected, 0); assert.equal(delivered, 0);
	for (const baseAlpha of [new Uint8Array(new SharedArrayBuffer(1)), new Uint8Array(new ArrayBuffer(2), 0, 1), new Uint8Array(2)]) {
		await assert.rejects(withBrushMaskPlaneV1({ width: 1, height: 1, baseAlpha, history: createBrushMaskHistoryV1() }, () => { delivered++; }));
	}
	assert.equal(delivered, 0);
});

test('replay captures base and history before yielding, joins held cancellation and wipes only owned alpha', async () => {
	const baseAlpha = new Uint8Array([64]), history = { schemaVersion: 1, strokes: [stroke('paint', 0.5, 1)], cursor: 1 };
	const entered = deferred<void>(), release = deferred<void>(), stop = new AbortController(), reason = Object.freeze({ first: 'cancel' });
	let borrowed: Uint8Array | undefined, settled = false;
	const work = withBrushMaskPlaneV1({ width: 1, height: 1, baseAlpha, history, signal: stop.signal }, async alpha => {
		borrowed = alpha; assert.deepEqual([...alpha], [160]); entered.resolve(); await release.promise;
	});
	const outcome = work.then(() => ({ failed: false, error: undefined as unknown }), (error: unknown) => ({ failed: true, error }));
	void outcome.then(() => { settled = true; }); baseAlpha.fill(1); history.strokes[0]!.opacity = 0; history.cursor = 0;
	try { await Promise.race([entered.promise, work]); stop.abort(reason); await settle(3); assert.equal(settled, false); assert.deepEqual([...borrowed!], [160]); }
	finally { release.resolve(); await outcome; }
	const result = await outcome; assert.equal(result.failed, true); assert.equal(result.error, reason); assert.ok(borrowed?.every(byte => byte === 0));
	assert.deepEqual([...baseAlpha], [1]);
});

test('generated paint/erase samples preserve byte range, paint monotonicity, erase monotonicity and full-opacity endpoints', async () => {
	let seed = 0x5ca1b;
	for (let sample = 0; sample < 64; sample++) {
		seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0; const before = seed >>> 24;
		let previousPaint = before, previousErase = before;
		for (const opacity of [0, 0.25, 0.5, 0.75, 1]) {
			const paint = (await replay(1, 1, [stroke('paint', opacity, 1)], new Uint8Array([before])))[0]!;
			const erase = (await replay(1, 1, [stroke('erase', opacity, 1)], new Uint8Array([before])))[0]!;
			assert.ok(Number.isInteger(paint) && paint <= 255 && paint >= previousPaint);
			assert.ok(Number.isInteger(erase) && erase >= 0 && erase <= previousErase);
			previousPaint = paint; previousErase = erase;
		}
		assert.equal(previousPaint, 255); assert.equal(previousErase, 0);
	}
});
