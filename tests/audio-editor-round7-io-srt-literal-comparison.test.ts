/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { exportVideoCaptionTrackV1, importVideoCaptionTrackV1 } from '../src/common/editor/video-caption-track-v27.ts';

const identity = { trackId: 'captions', sequenceId: 'main', trackName: 'Math lecture', language: 'en' };

for (const text of ['The relation is a < b.', 'The relation is a<b.']) test(`the ordinary caption writer preserves ${JSON.stringify(text)} through SRT reimport`, () => {
	const vtt = `WEBVTT\n\nlecture\n00:00.100 --> 00:00.500\n${text.replaceAll('<', '&lt;')}\n`;
	const imported = importVideoCaptionTrackV1(vtt, { ...identity, format: 'webvtt', sampleRate: 48_000 });
	assert.equal(imported.track.cues[0]?.text, text);
	const exported = exportVideoCaptionTrackV1(imported.track, { format: 'srt', sampleRate: 48_000 });
	assert.ok(exported.text.includes(`\n${text}\n`));
	const reopened = importVideoCaptionTrackV1(exported.text, { ...identity, format: 'srt', sampleRate: 48_000 });
	assert.equal(reopened.track.cues[0]?.text, text);
	assert.equal(reopened.track.cues[0]?.startFrame, 4_800);
	assert.equal(reopened.track.cues[0]?.endFrame, 24_000);
});

test('complete markup outside the passive SRT profile remains refused', () => {
	assert.throws(() => importVideoCaptionTrackV1('1\n00:00:00,100 --> 00:00:00,500\n<script>Text</script>\n', {
		...identity, format: 'srt', sampleRate: 48_000,
	}), /outside the passive maintained subset/u);
});
