/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { assertStandardDelayPitchNativeCapacity, reserveStandardDelayPitchNativeCapacity,
	standardDelayPitchNativeBytes } from '../src/common/editor/first-party-effects/standard/delay-pitch-admission.ts';

test('native pitch admission rejects high-rate multichannel sessions before StaffPad allocation', () => {
	assert.throws(() => assertStandardDelayPitchNativeCapacity(192000, 32, 3), /native.*memory limit.*echoes/);
	assert.throws(() => assertStandardDelayPitchNativeCapacity(192000, 32, 4), /native.*memory/);
	assert.equal(assertStandardDelayPitchNativeCapacity(192000, 32, 1), standardDelayPitchNativeBytes(192000, 32, 1));
	assert.equal(assertStandardDelayPitchNativeCapacity(48000, 32, 4), standardDelayPitchNativeBytes(48000, 32, 4));
});

test('native pitch estimates follow FFT scaling, paired sessions and a smaller final mono group', () => {
	const stereo = standardDelayPitchNativeBytes(48000, 2, 1);
	const mono = standardDelayPitchNativeBytes(48000, 1, 1);
	assert.ok(mono < stereo && mono > stereo / 2, 'a mono session still owns shared FFT/envelope buffers');
	assert.equal(standardDelayPitchNativeBytes(48000, 3, 1), stereo + mono);
	assert.equal(standardDelayPitchNativeBytes(48000, 4, 3), stereo * 6);
	assert.ok(standardDelayPitchNativeBytes(192000, 2, 1) > stereo * 3);
	assert.equal(standardDelayPitchNativeBytes(48000, 2, 0), 0);
	assert.equal(standardDelayPitchNativeBytes(44100, 2, 1), stereo);
});

test('native pitch admission leaves heap headroom and accounts retained replacement sessions', () => {
	const retained = assertStandardDelayPitchNativeCapacity(192000, 32, 1);
	assert.throws(() => assertStandardDelayPitchNativeCapacity(192000, 32, 1, retained), /native.*memory/);
	assert.doesNotThrow(() => assertStandardDelayPitchNativeCapacity(48000, 2, 5, retained));
});

test('shared runtime reservations prevent oversubscription and release exactly once', () => {
	const firstRuntime = {};
	const independentRuntime = {};
	const release = reserveStandardDelayPitchNativeCapacity(firstRuntime, 192000, 32, 1);
	assert.throws(() => reserveStandardDelayPitchNativeCapacity(firstRuntime, 192000, 32, 1), /native.*memory/);
	const independentRelease = reserveStandardDelayPitchNativeCapacity(independentRuntime, 192000, 32, 1);
	independentRelease();
	release();
	release();
	const replacementRelease = reserveStandardDelayPitchNativeCapacity(firstRuntime, 192000, 32, 1);
	assert.throws(() => reserveStandardDelayPitchNativeCapacity(firstRuntime, 192000, 32, 1), /native.*memory/);
	replacementRelease();
});

test('native pitch admission validates every dimension without accepting nonfinite reserves', () => {
	for (const rate of [0, 7999, 192001, NaN]) assert.throws(() => standardDelayPitchNativeBytes(rate, 2, 1), /sample rate/);
	for (const channels of [0, 1.5, 33, NaN]) assert.throws(() => standardDelayPitchNativeBytes(48000, channels, 1), /channel count/);
	for (const echoes of [-1, 1.5, 31, NaN]) assert.throws(() => standardDelayPitchNativeBytes(48000, 2, echoes), /echo count/);
	for (const retained of [-1, NaN, Infinity]) assert.throws(() => assertStandardDelayPitchNativeCapacity(48000, 2, 1, retained), /retained/);
});
