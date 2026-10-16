/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createEffect, effectTailFrames, rackTailFrames } from '../src/common/editor/effects.js';
import { compileParametricEqWasm, ParametricEqWasmRuntime } from '../src/common/editor/parametric-eq/wasm-runtime.js';

const RATE = 48_000;
const compiled = readFile(new URL('../src/common/editor/parametric-eq/parametric-eq.wasm', import.meta.url)).then(compileParametricEqWasm);
interface Band {
	readonly id: string;
	readonly enabled: boolean;
	readonly type: string;
	readonly frequency: number;
	readonly gain: number;
	readonly q: number;
	readonly slope: number;
}

function process(runtime: ParametricEqWasmRuntime, input: Float32Array): Float32Array {
	const output = new Float32Array(input.length);
	for (let start = 0; start < input.length; start += 128) {
		const end = Math.min(input.length, start + 128);
		runtime.process([input.subarray(start, end)], [output.subarray(start, end)]);
	}
	return output;
}

const bands: readonly Band[] = [
	{ id: 'lowcut12', enabled: true, type: 'lowpass', frequency: 10, gain: 0, q: 1, slope: 12 },
	{ id: 'lowcut48', enabled: true, type: 'lowpass', frequency: 10, gain: 0, q: 1, slope: 48 },
	{ id: 'bell', enabled: true, type: 'peaking', frequency: 1000, gain: 12, q: 6, slope: 12 },
];

for (const band of bands) {
	test(`Include tails retains the actual Parametric EQ WASM ${band.id} cascade release`, async () => {
		const params = { outputGain: 0, bands: [band] };
		const runtime = new ParametricEqWasmRuntime(await compiled, { sampleRate: RATE, channelCount: 1 });
		runtime.configure(params);
		const input = Float32Array.from({ length: RATE }, (_, frame) => .5 * Math.sin(2 * Math.PI * band.frequency * frame / RATE));
		process(runtime, input);
		const healthy = process(runtime, new Float32Array(128));
		assert.ok(healthy.some(sample => Math.abs(sample) > .01), 'The ordinary recording must charge an audible actual WASM release.');
		const declared = effectTailFrames(createEffect('eq', { params }), RATE);
		assert.ok(declared > 128, `Export must reserve the actual TPT cascade release, received ${declared}.`);
		runtime.reset();
		process(runtime, input);
		const release = process(runtime, new Float32Array(declared + 128));
		assert.ok(release.subarray(declared).every(sample => Math.abs(sample) < .0001),
			'The declared actual cascade release must settle below -80 dBFS.');
	});
}

test('neutral, disabled and output-only Parametric EQ retain their dry duration', () => {
	for (const params of [{ outputGain: 6, bands: [] },
		{ outputGain: 0, bands: [{ ...bands[2]!, gain: 0 }] },
		{ outputGain: 0, bands: [{ ...bands[0]!, enabled: false }] }]) {
		assert.equal(effectTailFrames(createEffect('eq', { params }), RATE), 0);
	}
});

test('a normally authored constant band frequency retains its actual low-frequency release', () => {
	const band = { ...bands[0]!, id: 'bass', frequency: 1000 };
	const effect = createEffect('eq', { id: 'equalizer', params: { outputGain: 0, bands: [band] } });
	const lane = { address: { kind: 'effect', strip: { kind: 'track', id: 'voice' },
		effectId: effect.id, elementId: band.id, parameterId: 'frequency' },
		points: [{ position: 0, value: 10 }], segments: [] };
	const expected = effectTailFrames(createEffect('eq', { params: { outputGain: 0,
		bands: [{ ...band, frequency: 10 }] } }), RATE);
	assert.ok(effectTailFrames(effect, RATE, [lane]) >= expected,
		'The authored band frequency must feed the release contract.');
});

test('changing band curves retain the established bounded rack release budget', () => {
	const band = { ...bands[2]!, id: 'bell' };
	const effect = createEffect('eq', { id: 'equalizer', params: { outputGain: 0, bands: [band] } });
	const lane = { address: { kind: 'effect', strip: { kind: 'track', id: 'voice' },
		effectId: effect.id, elementId: band.id, parameterId: 'q' },
		points: [{ position: 0, value: 1 }, { position: 2 * RATE, value: 1 }],
		segments: [{ kind: 'bezier', control1: { value: 30 }, control2: { value: 30 } }] };
	const interior = effectTailFrames(createEffect('eq', { params: { outputGain: 0,
		bands: [{ ...band, q: 22.75 }] } }), RATE);
	const actual = rackTailFrames([effect], RATE, 10, [lane]);
	assert.ok(actual >= interior,
		'A changing matched cascade must not use only its static controls.');
	assert.ok(actual <= 10 * RATE, 'The existing rack ceiling must remain bounded.');
});
