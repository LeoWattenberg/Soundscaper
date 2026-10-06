import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { applyStandardEffect } from '../src/common/editor/first-party-effects/standard/dsp.ts';
import { createNoiseGateProcessor, createOfflineNoiseGateProcessor } from '../src/common/editor/first-party-effects/standard/noise-gate-dsp.ts';
import { ComplementaryCrossover } from '../src/common/editor/first-party-effects/dynamics/core.ts';

function signal(length: number, channel = 0): Float32Array {
	return Float32Array.from({ length }, (_, frame) => channel
		? (frame % 977 < 49 ? 0.2 : 0.004) * Math.cos(frame * 0.17)
		: (frame % 701 < 77 ? 0.3 : 0.001) * Math.sin(frame * 0.071));
}

function digest(channels: readonly Float32Array[]): string {
	const hash = createHash('sha256');
	for (const channel of channels) hash.update(new Uint8Array(channel.buffer, channel.byteOffset, channel.byteLength));
	return hash.digest('hex');
}

const params = { attack: 0.01, lookahead: 0.02, hold: 0.003, release: 0.021, rangeDb: -35, threshold: -25 };

test('offline gates retain linked/independent, crossover and compensated lookahead output exactly', () => {
	const input = [signal(3_077), signal(3_077, 1)];
	for (const [gateFrequency, stereoLink, expected] of [
		[0, 'linked', '5c75f7bd6e78e6115ecf55905426fb99312c8e0d4d21c51c7fb8aa7b30d580f2'],
		[0, 'independent', '9dad76dbdee0baf2535036e46baf621809707c342fa35c6cfef689b75fd23985'],
		[1_000, 'linked', '603410c0d521df4a4a90f75fb8638e0bac7bd77a6a2297cbcf5d4fa0395fd4e1'],
		[1_000, 'independent', '17491784dc628ba4298772a89efdb918b15cf8af1fd250422979ca267cf575ea'],
	] as const) {
		assert.equal(digest(applyStandardEffect('noise-gate', input, 8_000, { ...params, gateFrequency, stereoLink })), expected);
	}
});

test('offline linked gates evaluate one envelope and skip unused full-band crossovers', (t) => {
	const input = signal(3_077);
	const expm1 = t.mock.method(Math, 'expm1');
	const low = t.mock.method(ComplementaryCrossover.prototype, 'low');
	applyStandardEffect('noise-gate', [input], 8_000, { ...params, lookahead: 0, stereoLink: 'linked' });
	const monoCalls = expm1.mock.callCount();
	assert.ok(monoCalls > 0, 'fixture must exercise an opening ramp');
	expm1.mock.resetCalls();
	applyStandardEffect('noise-gate', [input, input, input, input], 8_000, { ...params, lookahead: 0, stereoLink: 'linked' });
	assert.equal(expm1.mock.callCount(), monoCalls);
	assert.equal(low.mock.callCount(), 0);
});

test('live gates preserve crossover history and independent envelopes when parameters change', () => {
	const input = [signal(3_077), signal(3_077, 1)];
	for (const [change, expected] of [
		[{ gateFrequency: 1_000 }, '7ace1a190f47317afe5ea8b7ee2536f6e4a27d2bac18139808b71b93e3852648'],
		[{ stereoLink: 'linked' }, '5d67920bb21cbe4009932c571b0ea5b9e237e90bc7ad8c5ba2f3c1a016d9a9a1'],
	] as const) {
		const processor = createNoiseGateProcessor({ sampleRate: 8_000, channelCount: 2,
			params: { ...params, gateFrequency: 0, stereoLink: 'independent' } });
		const output = input.map((channel) => new Float32Array(channel.length));
		processor.processBlock(input.map((channel) => channel.subarray(0, 512)), output.map((channel) => channel.subarray(0, 512)), 512);
		processor.updateParams(change);
		processor.processBlock(input.map((channel) => channel.subarray(512)), output.map((channel) => channel.subarray(512)), 3_077 - 512);
		assert.equal(digest(output), expected);
	}
});

test('fixed offline gates reject parameter changes and reset to the same linked state', () => {
	const input = [signal(1_701), signal(1_701, 1)];
	const processor = createOfflineNoiseGateProcessor({ sampleRate: 8_000, channelCount: 2, params });
	const first = input.map((channel) => new Float32Array(channel.length));
	processor.processBlock(input, first, input[0].length);
	assert.throws(() => processor.updateParams({ stereoLink: 'independent', gateFrequency: 1_000 }), /fixed/);
	processor.reset();
	const second = input.map((channel) => new Float32Array(channel.length));
	processor.processBlock(input, second, input[0].length);
	assert.deepEqual(second, first);
});

test('destructive processors borrow complete input blocks and copy only partial latency padding', (t) => {
	const input = [signal(3_077), signal(3_077, 1)];
	const before = input.map((channel) => channel.slice());
	const set = t.mock.method(Float32Array.prototype, 'set');
	const output = applyStandardEffect('tremolo', input, 8_000);
	const inputCopies = set.mock.calls.filter((call) => {
		const source: unknown = call.arguments[0];
		return source instanceof Float32Array && input.some((channel) => source.buffer === channel.buffer);
	});
	assert.equal(inputCopies.length, 0, 'all source blocks including a shorter final block fit without padding');
	assert.equal(output[0].length, input[0].length);
	assert.deepEqual(input, before);
});
