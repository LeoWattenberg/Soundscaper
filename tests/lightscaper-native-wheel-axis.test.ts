/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { requireNativeWheelAxis, type NativeWheelAxisSample } from './browser/helpers/native-wheel-axis.ts';

const sample = (clientX: number, clientY: number, top: number): NativeWheelAxisSample => ({
	trusted: true, buttons: 1, clientX, clientY, rect: { left: 699, top, width: 160, height: 160 },
});

test('the observed Firefox trusted integer event refuses the fractional center instead of silently changing the literal axis oracle', () => {
	const observed = sample(939, 359, 279.816650390625);
	assert.equal(Math.atan2(observed.clientY - observed.rect.top - 80, 160) * 180 / Math.PI, -0.29243884003281495);
	assert.throws(() => requireNativeWheelAxis(observed, 'horizontal'), /integral center/u);
});

test('an integral native center admits exact trusted center, horizontal and vertical pointer coordinates', () => {
	requireNativeWheelAxis(sample(779, 360, 280), 'center');
	requireNativeWheelAxis(sample(939, 360, 280), 'horizontal');
	requireNativeWheelAxis(sample(779, 200, 280), 'vertical');
});

test('the native axis proof refuses untrusted events and off-axis or inactive delivery without tolerances', () => {
	assert.throws(() => requireNativeWheelAxis({ ...sample(939, 360, 280), trusted: false }, 'horizontal'), /trusted/u);
	assert.throws(() => requireNativeWheelAxis({ ...sample(939, 360, 280), buttons: 0 }, 'horizontal'), /active/u);
	assert.throws(() => requireNativeWheelAxis(sample(939, 359, 280), 'horizontal'), /horizontal/u);
	assert.throws(() => requireNativeWheelAxis(sample(778, 200, 280), 'vertical'), /vertical/u);
	assert.throws(() => requireNativeWheelAxis(sample(779, 359, 280), 'center'), /center coordinates/u);
	assert.throws(() => requireNativeWheelAxis(sample(779, 360, Number.NaN), 'center'), /finite/u);
});

test('the observed Chromium focus scroll cannot reuse an earlier integral down center for its later native move', () => {
	requireNativeWheelAxis(sample(779, 109, 29), 'center');
	assert.throws(() => requireNativeWheelAxis(sample(939, 109, 30), 'horizontal'), /horizontal/u);
	requireNativeWheelAxis(sample(779, 110, 30), 'center');
	requireNativeWheelAxis(sample(939, 110, 30), 'horizontal');
});
