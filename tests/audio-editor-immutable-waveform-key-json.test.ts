/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { immutableWaveformKeyJson, waveformEnvelopeKeyJson } from '../src/common/editor/ui/immutable-waveform-key-json.ts';

void test('immutable waveform keys reuse exact nested JSON without revisiting its values', () => {
	let reads = 0;
	const points = Array.from({ length: 1_000 }, (_, index) => Object.freeze({ frame: index, value: 0.5 }));
	const envelope = Object.freeze(new Proxy(points, { get(target, key, receiver) { reads += 1; return Reflect.get(target, key, receiver) as unknown; } }));
	const first = waveformEnvelopeKeyJson(envelope);
	reads = 0;
	assert.equal(waveformEnvelopeKeyJson(envelope), first);
	assert.equal(reads, 0);
	const tempo = Object.freeze({ events: Object.freeze([Object.freeze({ bpm: 120 })]) });
	assert.equal(immutableWaveformKeyJson(tempo), JSON.stringify(tempo));
});

void test('a frozen parent with mutable nested values still invalidates waveform keys', () => {
	const point = { frame: 0, value: 1 };
	const envelope = Object.freeze([point]);
	const before = waveformEnvelopeKeyJson(envelope);
	point.value = 0.5;
	assert.notEqual(waveformEnvelopeKeyJson(envelope), before);
	const warp = Object.freeze({ point });
	const warpBefore = immutableWaveformKeyJson(warp);
	point.value = 0.25;
	assert.notEqual(immutableWaveformKeyJson(warp), warpBefore);
});
