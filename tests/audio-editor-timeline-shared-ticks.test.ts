/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createTimelineGridLines, type TimelineRulerScale } from '../src/common/editor/ui/timeline/timeline-grid-model.ts';

void test('the grid consumes its owner-supplied ruler ticks without rereading time authority', () => {
	const scale: TimelineRulerScale = { kind: 'timecode', get view(): never {
		throw new Error('ruler time authority must not be resolved twice');
	} };
	const ticks = [{ frame: 48_000, label: 'one second', major: true }, { frame: 72_000, label: '', major: false }];
	assert.deepEqual(createTimelineGridLines({ scale, pixelsPerSecond: 100, scrollX: 0,
		viewportWidth: 500, sampleRate: 48_000, mappedTicks: ticks }), [{ x: 112, major: true }, { x: 162, major: false }]);
});
