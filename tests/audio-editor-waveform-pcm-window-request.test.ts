/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveWaveformPcmWindowRequest } from
	'../src/common/editor/controller/waveform-pcm-window-request.ts';

test('an explicit zero-length waveform window stays empty', () => {
	assert.equal(resolveWaveformPcmWindowRequest({ startFrame: 0, endFrame: 0 }, 100), null);
	assert.deepEqual(resolveWaveformPcmWindowRequest({ startFrame: 0, endFrame: 20 }, 100), {
		startFrame: 0,
		endFrame: 20,
	});
	assert.deepEqual(resolveWaveformPcmWindowRequest({}, 100), {
		startFrame: 0,
		endFrame: 100,
	});
});
