/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { applyAudacityAutoDuck } from '../src/common/editor/audacity-effects/basic.js';

for (const frame of [4800, 139200]) test(`Auto Duck retains voice attenuation at selection boundary frame ${frame}`, () => {
	const music = new Float32Array(144_000).fill(0.35);
	const voice = new Float32Array(144_000).fill(0.35);
	const [output] = applyAudacityAutoDuck([music], 48_000, {}, [voice]);
	assert.ok(output);
	const expected = 0.35 * 10 ** (-12 / 20);
	assert.ok(Math.abs(output[frame]! - expected) < 1e-6, `${output[frame]} should retain the -12 dB duck`);
	assert.equal(music[frame], Math.fround(0.35));
});
