/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { linearVideoKeyframeBezierControls } from '../src/common/editor/ui/inspector/video-keyframe-bezier-controls.ts';

test('Bezier handles stay inside a later segment and retain its positive scale range', () => {
	const controls = linearVideoKeyframeBezierControls(
		{ position: { num: 10, den: 1 }, value: 1.1 },
		{ position: { num: 20, den: 1 }, value: 1.2 },
	);
	assert.deepEqual(controls.control1.position, { num: 40, den: 3 });
	assert.deepEqual(controls.control2.position, { num: 50, den: 3 });
	assert.ok(controls.control1.value > 1.1 && controls.control1.value < controls.control2.value);
	assert.ok(controls.control2.value < 1.2);
});

test('Bezier seeding preserves fractional frame positions and falling parameter values', () => {
	const controls = linearVideoKeyframeBezierControls(
		{ position: { num: 1, den: 2 }, value: 0.75 },
		{ position: { num: 7, den: 2 }, value: 0.25 },
	);
	assert.deepEqual(controls.control1.position, { num: 3, den: 2 });
	assert.deepEqual(controls.control2.position, { num: 5, den: 2 });
	assert.ok(controls.control1.value < 0.75 && controls.control1.value > controls.control2.value);
	assert.ok(controls.control2.value > 0.25);
});
