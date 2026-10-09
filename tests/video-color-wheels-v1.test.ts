/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
	COLOR_WHEELS_EFFECT_CODE_V1, COLOR_WHEELS_PROCESS_V1, colorWheelsGradeV1,
	normalizeColorWheelsParamsV1, normalizeColorWheelsEffectV1, prepareColorWheelsEffectV1,
	createColorWheelsTransferV1, colorWheelsByteChannelV1, colorWheelsPreviewPassV1,
	copyColorWheelsPreviewLookupV1, serializeColorWheelsEffectToFfmpegV1,
	releaseColorWheelsEffectV1, releaseColorWheelsPreviewPassV1,
} from '../src/common/editor/video-color-wheels-v1.ts';
import { prepareScalarColorWheelsGradeV1, scalarColorWheelsByteV1 } from '../src/common/editor/video-color-wheels-scalar-v1.ts';
import {
	applyPreparedManagedSdrGradeStackLinearChannelsV1, encodeManagedSdrLinearChannelsV1,
	normalizeVideoColorGradeV1, prepareManagedSdrGradeStackV1, defaultVideoSourceColorInterpretationV1,
} from '../src/common/editor/video-color-management-v27.ts';
import { withManagedSdrPixelFrameV1 } from '../src/common/editor/imaging/pixel-frame-managed-sdr-grade-v1.ts';

const effect = (params: unknown = {}, enabled = true) => ({ id: 'wheels', type: 'color-wheels-v1', enabled, params });
const interpretation = defaultVideoSourceColorInterpretationV1('still', 'wheels-test');
const limits = { maximumSidePixels: 16, maximumPixels: 256, maximumBytes: 1024 };
function rendered(params: unknown, source = [0, 0, 0, 1, 128, 128, 128, 127, 255, 255, 255, 255]): number[] {
	const prepared = prepareColorWheelsEffectV1(effect(params));
	try { return source.map((byte, index) => index % 4 === 3 ? byte : colorWheelsByteChannelV1(prepared, byte, index % 4 as 0 | 1 | 2)); }
	finally { releaseColorWheelsEffectV1(prepared); }
}

test('three wheels derive only the existing closed managed SDR lift/gamma/gain grade', () => {
	assert.equal(COLOR_WHEELS_EFFECT_CODE_V1, 26);
	assert.equal(COLOR_WHEELS_PROCESS_V1, 'srgb-scalar-lgg-wheels-v1');
	const neutral = colorWheelsGradeV1({}); assert.deepEqual(neutral, normalizeVideoColorGradeV1());
	assert.deepEqual(colorWheelsGradeV1({ shadowsHue: 0, shadowsSaturation: 100 }).lift, [0.19685, -0.05315, -0.05315]);
	colorWheelsGradeV1({ shadowsHue: 120, shadowsSaturation: 100 }).lift.forEach((value, index) => {
		assert.ok(Math.abs(value - [-0.1788, 0.0712, -0.1788][index]!) < 1e-15);
	});
	assert.deepEqual(colorWheelsGradeV1({ shadowsHue: -120, shadowsSaturation: 100 }).lift, [-0.01805, -0.01805, 0.23195]);
	assert.deepEqual(colorWheelsGradeV1({ midtonesLuminance: 100 }).gamma, [2, 2, 2]);
	assert.deepEqual(colorWheelsGradeV1({ highlightsLuminance: -100 }).gain, [0.5, 0.5, 0.5]);
	assert.equal(neutral.lut, null); assert.equal(neutral.saturation, 1);
});

test('literal shadow/midtone/highlight goldens keep straight alpha and process bytes stable', () => {
	assert.deepEqual(rendered({ shadowsLuminance: 25 }), [71, 71, 71, 1, 144, 144, 144, 127, 255, 255, 255, 255]);
	assert.deepEqual(rendered({ midtonesLuminance: 100 }), [0, 0, 0, 1, 181, 181, 181, 127, 255, 255, 255, 255]);
	assert.deepEqual(rendered({ highlightsLuminance: 100 }), [0, 0, 0, 1, 176, 176, 176, 127, 255, 255, 255, 255]);
	assert.deepEqual(rendered({ shadowsHue: 0, shadowsSaturation: 100 }), [123, 0, 0, 1, 172, 112, 112, 127, 255, 249, 249, 255]);
	assert.deepEqual(rendered({ shadowsHue: 0, shadowsSaturation: 100 }, [0, 255, 255, 0]), [123, 249, 249, 0]);
});

test('ordinary all256 channel samples remain compatible with the existing managed grade model', () => {
	const params = { shadowsHue: 60, shadowsSaturation: 50, shadowsLuminance: -25,
		midtonesHue: -120, midtonesSaturation: 25, midtonesLuminance: 30,
		highlightsHue: 120, highlightsSaturation: 75, highlightsLuminance: -50 };
	const grade = normalizeVideoColorGradeV1({ ...normalizeVideoColorGradeV1(),
		lift: [-0.053475, -0.053475, -0.178475],
		gamma: [2 ** 0.28195, 2 ** 0.28195, 2 ** 0.53195],
		gain: [2 ** -1.0364, 2 ** -0.2864, 2 ** -1.0364] });
	const prepared = prepareManagedSdrGradeStackV1({ interpretation, grades: [grade] });
	const table = createColorWheelsTransferV1(effect(params)); assert.equal(table.byteLength, 1024);
	for (let byte = 0; byte < 256; byte++) {
		const linear = applyPreparedManagedSdrGradeStackLinearChannelsV1(prepared, byte / 255, byte / 255, byte / 255, 1);
		const output = encodeManagedSdrLinearChannelsV1(...linear, 'srgb');
		assert.deepEqual([...table.subarray(byte * 4, byte * 4 + 4)], output.map(channel => Math.round(channel * 255)));
	}
});

for (const [luminance, green, blue, legacy, wheel] of [[-9.310940439148165, 0, 255, 7, 8], [8.74628412503394, 255, 0, 8, 9]]) {
	test(`new scalar wheels explicitly differ from unchanged legacy mixed-RGB rounding at luminance ${String(luminance)}`, () => {
		const params = { highlightsLuminance: luminance }, grade = colorWheelsGradeV1(params);
		const prepared = prepareManagedSdrGradeStackV1({ interpretation, grades: [grade] });
		const linear = applyPreparedManagedSdrGradeStackLinearChannelsV1(prepared, 8 / 255, green! / 255, blue! / 255, 1);
		const output = encodeManagedSdrLinearChannelsV1(...linear, 'srgb');
		assert.equal(Math.round(output[0] * 255), legacy);
		assert.equal(rendered(params, [8, green!, blue!, 77])[0], wheel);
	});
}

test('all256 table values match the owning direct scalar LGG process and independent half-up arithmetic', () => {
	for (const params of [{ highlightsLuminance: -9.310940439148165 }, { highlightsLuminance: 8.74628412503394 },
		{ shadowsHue: 45, shadowsSaturation: 78.125, shadowsLuminance: -37.5, midtonesHue: -179.125,
			midtonesSaturation: 100, midtonesLuminance: 33.3, highlightsHue: 120.01, highlightsSaturation: 50, highlightsLuminance: -100 },
		{ shadowsLuminance: 100, midtonesLuminance: -100, highlightsLuminance: 100 }]) {
		const grade = colorWheelsGradeV1(params), scalar = prepareScalarColorWheelsGradeV1(grade), table = createColorWheelsTransferV1(effect(params));
		try {
			for (let byte = 0; byte < 256; byte++) for (const channel of [0, 1, 2] as const) {
				const encoded = byte / 255, linear = encoded <= 0.04045 ? encoded / 12.92 : ((encoded + 0.055) / 1.055) ** 2.4;
				const lgg = Math.max(0, Math.min(1, (Math.max(0, linear + grade.lift[channel]) * grade.gain[channel]) ** (1 / grade.gamma[channel])));
				const srgb = lgg <= 0.0031308 ? 12.92 * lgg : 1.055 * lgg ** (1 / 2.4) - 0.055;
				const expected = Math.floor(srgb * 255 + 0.5);
				assert.equal(scalarColorWheelsByteV1(scalar, byte, channel), expected); assert.equal(table[byte * 4 + channel], expected);
			}
		} finally { table.fill(0); }
	}
	for (const changes of [{ saturation: 0 }, { exposureStops: 1 }, { contrast: 2 }, { pivot: 0.5 }]) {
		assert.throws(() => prepareScalarColorWheelsGradeV1({ ...normalizeVideoColorGradeV1(), ...changes }));
	}
	const scalar = prepareScalarColorWheelsGradeV1(normalizeVideoColorGradeV1());
	assert.throws(() => scalarColorWheelsByteV1({ ...scalar }, 0, 0)); assert.throws(() => scalarColorWheelsByteV1(scalar, 256, 0));
});

test('closed numeric wheel persistence detaches before work and refuses future/accessor/coercible inputs', () => {
	const raw = { shadowsHue: 12.5, highlightsLuminance: -0 }, result = normalizeColorWheelsParamsV1(raw);
	raw.shadowsHue = 100; assert.equal(result.shadowsHue, 12.5); assert.equal(Object.is(result.highlightsLuminance, -0), false);
	assert.ok(Object.isFrozen(result)); assert.ok(Object.isFrozen(colorWheelsGradeV1(result).gain));
	let reads = 0;
	const accessor = Object.defineProperty({}, 'shadowsHue', { enumerable: true, get() { reads++; return 1; } });
	const coercible = { valueOf() { reads++; return 1; } };
	for (const params of [accessor, { shadowsHue: coercible }, { shadowsHue: 180.01 }, { midtonesHue: NaN },
		{ shadowsSaturation: -1 }, { highlightsSaturation: 100.01 }, { midtonesLuminance: -100.01 }, { lut: null }]) {
		assert.throws(() => normalizeColorWheelsParamsV1(params));
	}
	for (const value of [{ ...effect(), type: 'color-wheels-v2' }, { ...effect(), enabled: 1 },
		{ ...effect(), id: 'x'.repeat(129) }, { ...effect(), params: undefined }, { ...effect(), future: 1 }]) {
		assert.throws(() => normalizeColorWheelsEffectV1(value));
	}
	assert.equal(reads, 0);
});

test('neutral/disabled wheels preserve every encoded RGB/alpha byte while pass copies remain privately owned', () => {
	const source = Array.from({ length: 256 }, (_, byte) => [byte, 255 - byte, byte * 17 % 256, byte]).flat();
	assert.deepEqual(rendered({ shadowsHue: 37 }, source), source);
	const disabled = prepareColorWheelsEffectV1(effect({ shadowsLuminance: 100 }, false));
	for (let byte = 0; byte < 256; byte++) for (const channel of [0, 1, 2] as const) {
		assert.equal(colorWheelsByteChannelV1(disabled, byte, channel), byte);
	}
	assert.equal(colorWheelsPreviewPassV1(effect()), null); assert.equal(colorWheelsPreviewPassV1(effect({ shadowsLuminance: 100 }, false)), null);
	const pass = colorWheelsPreviewPassV1(effect({ highlightsLuminance: 100 })); assert.ok(pass);
	const bytes = copyColorWheelsPreviewLookupV1(pass); bytes.fill(0);
	assert.equal(copyColorWheelsPreviewLookupV1(pass)[128 * 4], 176);
	for (const value of [{ ...pass }, structuredClone(pass), new Proxy(pass, {})]) assert.throws(() => copyColorWheelsPreviewLookupV1(value));
	assert.throws(() => colorWheelsByteChannelV1({ ...disabled }, 0, 0));
	releaseColorWheelsEffectV1(disabled); releaseColorWheelsEffectV1(disabled);
	assert.throws(() => colorWheelsByteChannelV1(disabled, 0, 0));
	releaseColorWheelsPreviewPassV1(pass); releaseColorWheelsPreviewPassV1(pass);
	assert.throws(() => copyColorWheelsPreviewLookupV1(pass));
});

test('existing managed frame consumer stays joined and borrowed pixels are wiped on success/failure/cancel', async () => {
	for (const outcome of ['success', 'failure', 'cancel'] as const) {
		const stop = new AbortController(), source = new Uint8Array([128, 128, 128, 127]);
		let release!: () => void; const held = new Promise<void>(resolve => { release = resolve; });
		let output: Uint8Array | undefined, settled = false, inspections = 0;
		const reason = new Proxy({}, { get() { inspections++; throw new Error('opaque read'); }, getPrototypeOf() { inspections++; throw new Error('opaque prototype'); } });
		const failure = new Error('consumer failure');
		const pending = withManagedSdrPixelFrameV1({ frame: { descriptor: { schemaVersion: 1, width: 1, height: 1,
			sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' }, pixels: source }, decoding: 'file', interpretation,
			grades: [colorWheelsGradeV1({ highlightsLuminance: 100 })], output: 'srgb', signal: stop.signal }, async frame => {
			output = frame.pixels; await held; if (outcome === 'failure') throw failure; return 'delivered';
		}, { limits });
		void pending.then(() => { settled = true; }, () => { settled = true; });
		await Promise.resolve(); assert.deepEqual([...output!], [176, 176, 176, 127]);
		if (outcome === 'cancel') stop.abort(reason);
		await Promise.resolve(); assert.equal(settled, false); release();
		if (outcome === 'success') assert.equal(await pending, 'delivered');
		else { let rejection: unknown; try { await pending; } catch (error) { rejection = error; }
			assert.equal(rejection, outcome === 'failure' ? failure : reason); }
		assert.deepEqual([...source], [128, 128, 128, 127]); assert.deepEqual([...output!], [0, 0, 0, 0]); assert.equal(inspections, 0);
	}
});

test('private table generation failure wipes its partial output without inspecting an opaque failure', () => {
	const nativeArray = globalThis.Uint8Array, nativeFloor = Math.floor;
	let table: Uint8Array | undefined, rounds = 0, inspections = 0;
	const reason = new Proxy({}, { get() { inspections++; throw new Error('opaque get'); }, getPrototypeOf() { inspections++; throw new Error('opaque prototype'); } });
	globalThis.Uint8Array = new Proxy(nativeArray, { construct(target, args) {
		const result = Reflect.construct(target, args) as Uint8Array; if (result.byteLength === 1024) table = result; return result;
	} });
	Math.floor = value => { if (table && ++rounds === 4) throw reason; return nativeFloor(value); };
	let failure: unknown;
	try { prepareColorWheelsEffectV1(effect({ highlightsLuminance: 100 })); }
	catch (error) { failure = error; }
	finally { Math.floor = nativeFloor; globalThis.Uint8Array = nativeArray; }
	assert.equal(failure, reason); assert.ok(table); assert.equal(table.every(value => value === 0), true); assert.equal(inspections, 0);
});

test('preview planning retains only admitted recipes and derives one fresh buffer on authenticated copy demand', () => {
	const NativeBytes = Uint8Array, allocations: Uint8Array[] = [], raw = effect({ highlightsLuminance: 100 });
	globalThis.Uint8Array = new Proxy(NativeBytes, { construct(target, args, receiver) {
		const bytes = Reflect.construct(target, args, receiver) as Uint8Array<ArrayBuffer>;
		if (args[0] === 1024) allocations.push(bytes); return bytes;
	} });
	let plans: NonNullable<ReturnType<typeof colorWheelsPreviewPassV1>>[] = [];
	try {
		plans = [colorWheelsPreviewPassV1(raw)!, colorWheelsPreviewPassV1(effect({ shadowsHue: 120, shadowsSaturation: 50 }))!,
			colorWheelsPreviewPassV1(effect({ midtonesLuminance: 20 }))!];
		assert.equal(allocations.length, 0, 'Planned passes must not allocate a lookup table per effect.');
		raw.params = { highlightsLuminance: -100 };
		const first = copyColorWheelsPreviewLookupV1(plans[0]); assert.equal(allocations.length, 1); assert.equal(first[128 * 4], 176);
		first.fill(0); const second = copyColorWheelsPreviewLookupV1(plans[0]);
		assert.equal(allocations.length, 2); assert.equal(second[128 * 4], 176); assert.notEqual(first.buffer, second.buffer); second.fill(0);
	} finally { globalThis.Uint8Array = NativeBytes; for (const plan of plans) releaseColorWheelsPreviewPassV1(plan); }
	for (const plan of plans) assert.throws(() => copyColorWheelsPreviewLookupV1(plan));
});

test('current CPU table and recipe-only preview binding retire once their held lifetime settles', async () => {
	const nativeArray = globalThis.Uint8Array, tables: Uint8Array[] = [];
	globalThis.Uint8Array = new Proxy(nativeArray, { construct(target, args) {
		const result = Reflect.construct(target, args) as Uint8Array; if (result.byteLength === 1024) tables.push(result); return result;
	} });
	let prepared: ReturnType<typeof prepareColorWheelsEffectV1>, pass: ReturnType<typeof colorWheelsPreviewPassV1>;
	try { prepared = prepareColorWheelsEffectV1(effect({ highlightsLuminance: 100 })); pass = colorWheelsPreviewPassV1(effect({ highlightsLuminance: 100 })); }
	finally { globalThis.Uint8Array = nativeArray; }
	assert.ok(pass); assert.equal(tables.length, 1, 'Only the currently prepared CPU stage owns a lookup table.');
	assert.equal(tables[0]![128 * 4], 176);
	let release!: () => void; const held = new Promise<void>(resolve => { release = resolve; });
	const stop = new AbortController(), reason = new DOMException('held wheel render canceled', 'AbortError');
	const pending = (async () => {
		try { await held; Reflect.apply(AbortSignal.prototype.throwIfAborted, stop.signal, []); }
		finally { releaseColorWheelsEffectV1(prepared); releaseColorWheelsPreviewPassV1(pass); }
	})();
	stop.abort(reason); await Promise.resolve(); assert.equal(tables[0]![128 * 4], 176); release();
	await assert.rejects(pending, error => error === reason);
	assert.equal(tables.every(table => table.every(value => value === 0)), true);
	assert.throws(() => colorWheelsByteChannelV1(prepared, 128, 0)); assert.throws(() => copyColorWheelsPreviewLookupV1(pass));
});

test('export carries only a bounded balanced exact byte expression and preserved alpha', () => {
	assert.equal(serializeColorWheelsEffectToFfmpegV1(effect()), null);
	const operation = serializeColorWheelsEffectToFfmpegV1(effect({ midtonesLuminance: 12.5 })); assert.ok(operation);
	assert.equal(operation.preserveAlpha, true); assert.match(operation.expression, /a='alpha\(X,Y\)'/u);
	assert.ok(operation.expression.length < 50_000); assert.match(operation.expression, /interpolation=nearest/u);
	assert.equal(JSON.stringify(normalizeColorWheelsEffectV1(effect({ midtonesLuminance: 12.5 }))).includes('lookup'), false);
});
