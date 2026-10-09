/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { applyVideoExactBrowserEffectsFinishingV2 as render } from '../src/framescaper/editor-video-exact-browser-effects-finishing-v2.ts';
import { applyVideoExactBrowserEffectsFinishing as renderV1 } from '../src/framescaper/editor-video-exact-browser-effects-finishing.ts';
import { createVideoEffect } from '../src/common/editor/video-effects.js';
import { parseCubeLutV1 } from '../src/common/editor/video-color-cube-lut-v27.ts';
import type { CubeLutSourcePortV1 } from '../src/common/editor/imaging/cube-lut-source-port-v1.ts';

const TEXT = ['LUT_3D_SIZE 2', '0 0 0', '0 0 1', '0 1 0', '0 1 1', '1 0 0', '1 0 1', '1 1 0', '1 1 1'].join('\n');
const BODY = new TextEncoder().encode(TEXT), PARSED = parseCubeLutV1(TEXT);
const REF = { storageKey: `lut-sha256:${PARSED.sha256}`, sha256: PARSED.sha256, byteLength: PARSED.byteLength,
	size: PARSED.size, domainMin: PARSED.domainMin, domainMax: PARSED.domainMax };
const cube = (lut: unknown = REF, enabled = true) => ({ id: 'cube', type: 'cube-lut-profile-v1', enabled, params: { lut } });
const curve = () => createVideoEffect('point-curves-v1', { id: 'red', params: { red: [{ x: 0, y: 1 }, { x: 1, y: 0 }] } });
const frame = (values: readonly number[] = [64, 91, 32, 127]) => ({ width: values.length / 4, height: 1, pixels: new Uint8Array(values) });
const signal = () => new AbortController().signal;
const source = (): CubeLutSourcePortV1 => ({ async withBytes(reference, consume) { assert.deepEqual(reference, REF); return consume(BODY); } });

test('the explicit Frame V2 route executes scoped V27 at its authored position with all256 straight alpha goldens', async () => {
	const samples = Array.from({ length: 256 }, (_, alpha) => [alpha, 91, 32, alpha]).flat();
	const input = frame(samples), before = input.pixels.slice();
	const first = await render(input, [curve(), cube()], signal(), { source: source() });
	const second = await render(input, [cube(), curve()], signal(), { source: source() });
	assert.deepEqual(Array.from(first.pixels), Array.from({ length: 256 }, (_, alpha) => [32, 91, 255 - alpha, alpha]).flat());
	assert.deepEqual(Array.from(second.pixels), Array.from({ length: 256 }, (_, alpha) => [223, 91, alpha, alpha]).flat());
	assert.deepEqual(input.pixels, before);
	assert.notEqual(first.pixels, input.pixels); assert.notEqual(second.pixels, input.pixels);
});

test('legacy Frame admission stays strict while explicit null and disabled profiles preserve byte identity without resource access', async () => {
	const input = frame(), hostile = Object.defineProperty({}, 'withBytes', { get() { assert.fail('bypass read resource'); } });
	for (const effect of [cube(), cube(null), cube(REF, false)]) await assert.rejects(renderV1(input, [effect], signal()));
	for (const effects of [[], [cube(null)], [cube(REF, false)]]) {
		const output = await render(input, effects, signal(), { source: hostile as CubeLutSourcePortV1 });
		assert.deepEqual(output.pixels, input.pixels); assert.notEqual(output.pixels, input.pixels);
	}
	await assert.rejects(render(input, [cube({ ...REF, body: 'hidden' }, false)], signal()), /unknown|unsupported|field/iu);
});

test('all resource requirements are pinned before earlier stages await and source snapshots detach before body demand', async () => {
	let inspected = 0;
	const unread = Object.defineProperty({}, 'pixels', { get() { inspected++; throw new Error('source reflected'); } });
	await assert.rejects(render(unread as ReturnType<typeof frame>, [curve(), cube()], signal()), /source|resource/iu);
	assert.equal(inspected, 0);
	let calls = 0, bindReads = 0;
	const input = frame(), port = source(), original = port.withBytes;
	port.withBytes = async function (reference, consume, options) { assert.equal(this, port); calls++; return Reflect.apply(original, this, [reference, consume, options]); };
	Object.defineProperty(port.withBytes, 'bind', { get() { bindReads++; throw new Error('borrowed bind'); } });
	const work = render(input, [curve(), cube()], signal(), { source: port });
	input.pixels.fill(255); port.withBytes = () => { throw new Error('replacement source called'); };
	assert.deepEqual(Array.from((await work).pixels), [32, 91, 191, 127]);
	assert.equal(calls, 1); assert.equal(bindReads, 0);
});

test('held resource cancellation joins the actual source and wipes every owned frame without reflecting the reason', async () => {
	const NativeBytes = Uint8Array, input = frame(), before = input.pixels.slice(), owned: Uint8Array[] = [];
	let entered!: () => void, release!: () => void, joined = false, settled = false, traps = 0;
	const started = new Promise<void>(resolve => { entered = resolve; }), held = new Promise<void>(resolve => { release = resolve; });
	const reason = new Proxy({}, { get() { traps++; throw new Error('reason get'); }, getPrototypeOf() { traps++; throw new Error('reason prototype'); },
		getOwnPropertyDescriptor() { traps++; throw new Error('reason descriptor'); } });
	const stop = new AbortController();
	const port: CubeLutSourcePortV1 = { async withBytes(_reference, consume) { entered(); await held; try { return await consume(BODY); } finally { joined = true; } } };
	globalThis.Uint8Array = new Proxy(NativeBytes, { construct(target, args, receiver) {
		const value = Reflect.construct(target, args, receiver) as Uint8Array<ArrayBuffer>;
		if ((args[0] instanceof NativeBytes || args[0] === 4) && value.byteLength === 4) owned.push(value);
		return value;
	} });
	try {
		const work = render(input, [cube()], stop.signal, { source: port });
		const outcome = work.then(() => ({ error: undefined as unknown }), error => ({ error: error as unknown }));
		void outcome.then(() => { settled = true; });
		await started; stop.abort(reason); await Promise.resolve(); assert.equal(settled, false); assert.equal(joined, false);
		release(); assert.equal((await outcome).error, reason); assert.equal(joined, true);
		assert.ok(owned.length >= 1); assert.ok(owned.every(bytes => bytes.every(value => value === 0)));
		assert.deepEqual(input.pixels, before); assert.equal(traps, 0);
	} finally { globalThis.Uint8Array = NativeBytes; }
});

test('body authenticity and distinct source cleanup stay observable and delivered bytes retain caller ownership', async () => {
	await assert.rejects(render(frame(), [cube()], signal(), { source: { async withBytes(_ref, consume) {
		return consume(new TextEncoder().encode(TEXT.replace('0 0 1', '0 0 0')));
	} } }), /digest|SHA|length/iu);
	const cleanup = Object.freeze({ cleanup: true });
	const port: CubeLutSourcePortV1 = { async withBytes(_ref, consume) { await consume(BODY); throw cleanup; } };
	const failure = await render(frame(), [cube()], signal(), { source: port }).then(() => ({ error: undefined as unknown }), error => ({ error: error as unknown }));
	assert.equal(failure.error, cleanup);
	const output = await render(frame(), [cube()], signal(), { source: source() });
	await Promise.resolve(); assert.deepEqual(Array.from(output.pixels), [32, 91, 64, 127]);
});
