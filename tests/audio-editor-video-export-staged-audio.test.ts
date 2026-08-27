/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	stagedAudioChannelCount,
	stagedAudioChannelLayout,
} from '../src/common/editor/controller/video-export-staged-audio.ts';

test('staged video audio geometry follows the admitted layout', () => {
	for (const [layout, masterChannels, expected] of [
		['mono', 12, 1],
		['stereo', 12, 2],
		['preserve', 12, 12],
	] as const) {
		const plan = { inputs: [{ kind: 'staged-audio-mix', channelLayout: layout }] };
		assert.equal(stagedAudioChannelLayout(plan), layout);
		assert.equal(stagedAudioChannelCount(plan, { masterChannels }), expected);
	}
});

test('staged video audio geometry defaults to preserve and bounds project channels', () => {
	const plan = { inputs: [] };
	assert.equal(stagedAudioChannelLayout(plan), 'preserve');
	assert.equal(stagedAudioChannelCount(plan, {}), 2);
	for (const masterChannels of [0, 33, 1.5, Number.NaN]) {
		assert.throws(
			() => stagedAudioChannelCount(plan, { masterChannels }),
			/master channel count/u,
		);
	}
});
