/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { preparePixelFrameWebGl2RepairCurrentV1 as prepare, readPixelFrameWebGl2RepairCurrentV1 as read,
	isPixelFrameWebGl2RepairCurrentV1 as isPrepared, planPixelFrameWebGl2RepairWorkingCurrentV1 as working,
	writePixelFrameWebGl2RepairReferenceCurrentV1 as writeReference } from '../src/common/editor/imaging/pixel-frame-webgl2-repair-current-v1.ts';
const descriptor = { schemaVersion: 1 as const, width: 10, height: 5, sampleFormat: 'float32' as const, primaries: 'srgb' as const, transfer: 'linear' as const };
const spot = () => ({ id: 'heal', mode: 'heal' as const, enabled: true, target: { x: .7, y: .5 }, source: { x: .2, y: .5 }, radius: .15, feather: 0, opacity: 1 });
const recipe = () => ({ schemaVersion: 1, spots: [spot()] });
test('GPU repair prefix detaches closed controls and enrolls only its actual private identity', () => {
	const input = recipe(), plan = prepare(input, descriptor); input.spots[0]!.source.x = .7; input.spots.length = 0;
	assert.equal(read(plan), plan); assert.equal(plan.spots[0]!.sourceDelta.x, -5); assert.ok(Object.isFrozen(plan.spots[0]!.spot.source));
	const hostile = Proxy.revocable({}, {}); hostile.revoke(); assert.equal(isPrepared(hostile.proxy), false);
	assert.throws(() => read(hostile.proxy), TypeError); assert.throws(() => read({ ...plan }), TypeError);
	let reflected = false; const accessor = Object.defineProperty(spot(), 'radius', { get() { reflected = true; return .15; } });
	assert.throws(() => prepare({ schemaVersion: 1, spots: [accessor] }, descriptor)); assert.equal(reflected, false);
});
test('GPU repair prefix retains raw activity and fixed native CPU/GPU phase fees', () => {
	const definition = recipe(), plan = prepare(definition, descriptor), halo = plan.spots[0]!.halo!;
	assert.equal(plan.scratchBytes, halo.width * halo.height * 105 + 4096); assert.equal(plan.gpuHaloBytes, halo.width * halo.height * 129);
	const bytes = working(plan); assert.equal(bytes.gpuBytes, plan.frameBytes * 6 + plan.gpuHaloBytes + 4096);
	assert.equal(bytes.referenceBytes, plan.frameBytes * 8 + plan.scratchBytes + 4096); assert.equal(bytes.eligible, true);
	assert.equal(working(plan, 768 * 1024 * 1024).eligible, false);
	const tiny = { ...spot(), opacity: Number.MIN_VALUE }; assert.equal(prepare({ schemaVersion: 1, spots: [tiny] }, descriptor).supported, false);
	for (const changes of [{ enabled: false }, { opacity: 0 }]) {
		const inactive = prepare({ schemaVersion: 1, spots: [{ ...spot(), ...changes }] }, descriptor);
		assert.equal(inactive.hasActive, false); assert.equal(inactive.gpuHaloBytes, 0); assert.equal(inactive.scratchBytes, 0);
	}
});
test('GPU repair preparation preserves complete serial work bounds before execution', () => {
	const clone = { ...spot(), mode: 'clone', radius: 1 };
	assert.throws(() => prepare({ schemaVersion: 1, spots: [clone, { ...clone, id: 'second' }] }, { ...descriptor, width: 4096, height: 4096 }), /visit|budget/iu);
	assert.throws(() => prepare(recipe(), { ...descriptor, width: 8193 }));
});
test('GPU repair reference remains the real Double coupled Poisson authority and requires private identity', async () => {
	const pixels = new Float32Array(10 * 5 * 4); for (let at = 3; at < pixels.length; at += 4) pixels[at] = 1;
	for (let y = 1; y < 4; y++) for (let x = 0; x < 4; x++) pixels.set([-2, -2, -2, 1], (y * 10 + x) * 4);
	for (const [x, y] of [[8, 2], [7, 1], [7, 3]]) pixels.set([4, 4, 4, 1], (y! * 10 + x!) * 4);
	const source = { descriptor, pixels }, before = pixels.slice(), plan = prepare(recipe(), descriptor);
	const target = new Float32Array(pixels.length).fill(17), scratch = new Uint8Array(plan.scratchBytes);
	try {
		await assert.rejects(writeReference({ ...plan }, source, target, scratch), /owning/iu); assert.ok(target.every(n => n === 17));
		await writeReference(plan, source, target, scratch);
		assert.deepEqual([...target.slice(104, 108)], [1, 1, 1, 1]); assert.deepEqual([...target.slice(108, 112)], [3, 3, 3, 1]);
		assert.deepEqual(pixels, before);
	} finally { target.fill(0); scratch.fill(0); pixels.fill(0); before.fill(0); }
});
