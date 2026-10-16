/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createMappedTimelineTicks } from '../src/common/editor/ui/timeline/timeline-grid-model.ts';
import type { TimelineRulerScale } from '../src/common/editor/ui/timeline/timeline-grid-model.ts';

const compound: TimelineRulerScale = {
	kind: 'musical-map',
	tempoMap: { mode: 'musical', events: [{ beat: { num: 0, den: 1 }, bpm: { num: 120, den: 1 } }] },
	signatureMap: { events: [{ bar: 0, numerator: 6, denominator: 8 }] },
};

for (const pixelsPerSecond of [6, 15, 30]) {
	test(`compound-meter labels keep their readable spacing at ${String(pixelsPerSecond)} pixels per second`, () => {
		const options = { scale: compound, sampleRate: 48_000, pixelsPerSecond, scrollX: 0, viewportWidth: 800 };
		const ticks = createMappedTimelineTicks(options)!;
		const labels = ticks.filter(tick => tick.major);
		assert.ok(labels.length > 1);
		for (let index = 1; index < labels.length; index += 1) {
			const distance = (labels[index]!.frame - labels[index - 1]!.frame) / options.sampleRate * pixelsPerSecond;
			assert.ok(distance >= 60, `bar labels are only ${String(distance)} pixels apart`);
		}
		assert.ok(ticks.some(tick => !tick.major), 'retain unlabelled bar or pulse ticks');
		const scrolled = createMappedTimelineTicks({ ...options, scrollX: 125 })!;
		const firstVisible = Math.ceil(125 / pixelsPerSecond * options.sampleRate);
		const lastVisible = Math.floor(800 / pixelsPerSecond * options.sampleRate);
		assert.deepEqual(scrolled.filter(tick => tick.frame >= firstVisible && tick.frame <= lastVisible),
			ticks.filter(tick => tick.frame >= firstVisible && tick.frame <= lastVisible));
	});
}

test('zoomed-in compound bars and denominator pulses retain their exact frames', () => {
	const ticks = createMappedTimelineTicks({ scale: compound, sampleRate: 48_000,
		pixelsPerSecond: 120, scrollX: 0, viewportWidth: 400 })!;
	assert.deepEqual(ticks.filter(tick => tick.major).map(tick => [tick.frame, tick.label]),
		[[0, '1'], [72_000, '2'], [144_000, '3']]);
	assert.equal(ticks[1]?.frame, 12_000);
});
