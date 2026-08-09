/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createMusicalRulerTicks,
	usesMusicalMapRuler,
} from '../src/common/editor/ui/timeline/musical-ruler-model.ts';

const TEMPO_MAP = {
	mode: 'musical' as const,
	events: [
		{ id: 'tempo-0', beat: { num: 0, den: 1 }, bpm: { num: 120, den: 1 } },
		{ id: 'tempo-1', beat: { num: 4, den: 1 }, bpm: { num: 60, den: 1 } },
	],
};

const SIGNATURE_MAP = {
	events: [
		{ id: 'signature-0', bar: 0, numerator: 4, denominator: 4 },
		{ id: 'signature-1', bar: 1, numerator: 3, denominator: 4 },
	],
};

test('the map-aware renderer is selected only for a changing beats-and-measures ruler', () => {
	const changing = { tempoMap: TEMPO_MAP, signatureMap: SIGNATURE_MAP };
	assert.equal(usesMusicalMapRuler({ ...changing, timeDisplay: { format: 'beats+measures' } }), true);
	assert.equal(usesMusicalMapRuler({ ...changing, timeDisplay: { format: 'minutes-seconds' } }), false);
	assert.equal(usesMusicalMapRuler({
		timeDisplay: { format: 'beats+measures' },
		tempoMap: { ...TEMPO_MAP, events: TEMPO_MAP.events.slice(0, 1) },
		signatureMap: { ...SIGNATURE_MAP, events: SIGNATURE_MAP.events.slice(0, 1) },
	}), false);
	assert.equal(usesMusicalMapRuler({
		timeDisplay: { format: 'beats+measures' },
		tempoMap: { ...TEMPO_MAP, events: TEMPO_MAP.events.slice(0, 1) },
		signatureMap: { events: [{ id: 'signature-0', bar: 0, numerator: 6, denominator: 8 }] },
	}), true);
});

test('a singleton compound-meter ruler uses denominator pulses instead of vendor quarter notes', () => {
	const ticks = createMusicalRulerTicks({
		tempoMap: { ...TEMPO_MAP, events: TEMPO_MAP.events.slice(0, 1) },
		signatureMap: { events: [{ id: 'signature-0', bar: 0, numerator: 6, denominator: 8 }] },
		sampleRate: 48_000,
		startFrame: 0,
		endFrame: 72_000,
	});
	assert.equal(ticks.at(-1)?.frame, 72_000);
	assert.equal(ticks.at(-1)?.label, '2');
});

test('musical ruler ticks follow variable tempo and bar-indexed signature maps', () => {
	const ticks = createMusicalRulerTicks({
		tempoMap: TEMPO_MAP,
		signatureMap: SIGNATURE_MAP,
		sampleRate: 48_000,
		startFrame: 0,
		endFrame: 240_000,
	});
	assert.deepEqual(ticks.map(({ frame, bar, beat, major, label }) => ({ frame, bar, beat, major, label })), [
		{ frame: 0, bar: 0, beat: 0, major: true, label: '1' },
		{ frame: 24_000, bar: 0, beat: 1, major: false, label: '1.2' },
		{ frame: 48_000, bar: 0, beat: 2, major: false, label: '1.3' },
		{ frame: 72_000, bar: 0, beat: 3, major: false, label: '1.4' },
		{ frame: 96_000, bar: 1, beat: 0, major: true, label: '2' },
		{ frame: 144_000, bar: 1, beat: 1, major: false, label: '2.2' },
		{ frame: 192_000, bar: 1, beat: 2, major: false, label: '2.3' },
		{ frame: 240_000, bar: 2, beat: 0, major: true, label: '3' },
	]);
});

test('musical ruler tick density stays bounded for zoomed-out compound maps', () => {
	const ticks = createMusicalRulerTicks({
		tempoMap: TEMPO_MAP,
		signatureMap: SIGNATURE_MAP,
		sampleRate: 48_000,
		startFrame: 0,
		endFrame: 48_000 * 60 * 60,
		pixelsPerFrame: 1 / 48_000,
	});
	assert.ok(ticks.length <= 8_192);
	assert.ok(ticks.every(({ frame }, index) => index === 0 || frame > ticks[index - 1]!.frame));
});

test('zoomed-out wide meters skip invisible denominator pulses before enumeration', () => {
	const startedAt = performance.now();
	const ticks = createMusicalRulerTicks({
		tempoMap: { mode: 'musical', events: [
			TEMPO_MAP.events[0]!,
			{ id: 'tempo-beyond-viewport', beat: { num: 5_000_000, den: 1 }, bpm: { num: 1, den: 1_000_000 } },
		] },
		signatureMap: { events: [{ id: 'signature-0', bar: 0, numerator: 1_000, denominator: 4 }] },
		sampleRate: 48_000,
		startFrame: 0,
		endFrame: 24_000 * 1_000 * 4_095,
		pixelsPerFrame: 2e-12,
	});
	const elapsed = performance.now() - startedAt;
	assert.equal(ticks.length, 4_096);
	assert.ok(elapsed < 750, `wide-meter ruler generation took ${String(Math.round(elapsed))} ms`);
});

test('maximum-size per-bar signature maps render without quadratic rescans', () => {
	const signatureMap = { events: Array.from({ length: 4_096 }, (_, bar) => ({
		id: `signature-${String(bar)}`, bar, numerator: bar % 2 ? 3 : 4, denominator: 4,
	})) };
	const startedAt = performance.now();
	const ticks = createMusicalRulerTicks({
		tempoMap: { ...TEMPO_MAP, events: TEMPO_MAP.events.slice(0, 1) },
		signatureMap,
		sampleRate: 48_000,
		startFrame: 0,
		endFrame: 48_000 * 2 * 4_096,
		pixelsPerFrame: 1 / 48_000,
	});
	const elapsed = performance.now() - startedAt;
	assert.ok(ticks.length > 1);
	assert.ok(elapsed < 750, `musical ruler generation took ${String(Math.round(elapsed))} ms`);
});

test('large tempo and signature maps render together without cross-product scans', () => {
	const eventCount = 2_048;
	const startedAt = performance.now();
	const ticks = createMusicalRulerTicks({
		tempoMap: { mode: 'musical', events: Array.from({ length: eventCount }, (_, index) => ({
			id: `tempo-${String(index)}`, beat: { num: index * 4, den: 1 },
			bpm: { num: index % 2 ? 90 : 120, den: 1 },
		})) },
		signatureMap: { events: Array.from({ length: eventCount }, (_, bar) => ({
			id: `signature-${String(bar)}`, bar, numerator: 4, denominator: 4,
		})) },
		sampleRate: 48_000,
		startFrame: 0,
		endFrame: 400_000_000,
		pixelsPerFrame: 1 / 48_000,
	});
	const elapsed = performance.now() - startedAt;
	assert.ok(ticks.length > eventCount);
	assert.ok(elapsed < 750, `combined musical ruler generation took ${String(Math.round(elapsed))} ms`);
});
