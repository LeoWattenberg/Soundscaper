/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { importVideoCaptionTrackV1, exportVideoCaptionTrackV1 } from '../src/common/editor/video-caption-track-v27.ts';
import { openFramescaperCaptionSidecarFile } from '../src/common/editor/ui/framescaper-caption-file-interchange.ts';

const identity = Object.freeze({
	format: 'webvtt' as const, sampleRate: 48_000, trackId: 'captions-en',
	sequenceId: 'sequence-main', trackName: 'Interview', language: 'en',
});
const dialogue = 'Thinking about the interview.';
const sidecar = (body: string): string => `WEBVTT\n\n00:00:01.000 --> 00:00:03.000\n${body}\n`;

for (const italic of [false, true]) {
	test(`normal WebVTT file imports a closed whole-cue voice with italic=${String(italic)}`, async () => {
		// Subtitle Edit's WebVTT reference shows <v John><i>thinking...</i></v>.
		const body = italic ? `<i>${dialogue}</i>` : dialogue;
		const opened = await openFramescaperCaptionSidecarFile({
			file: new File([sidecar(`<v John>${body}</v>`)], 'interview.vtt', { type: 'text/vtt' }),
		});
		assert.ok(opened);
		const imported = importVideoCaptionTrackV1(opened.text, { ...identity, format: opened.format });
		const cue = imported.track.cues[0];
		assert.ok(cue);
		assert.equal(cue.text, dialogue);
		assert.deepEqual([cue.startFrame, cue.endFrame], [48_000, 144_000]);
		assert.equal(imported.track.speakers.find(({ id }) => id === cue.speakerId)?.name, 'John');
		assert.equal(cue.styleId !== null, italic);
		if (italic) assert.equal(imported.track.styles.find(({ id }) => id === cue.styleId)?.fontStyle, 'italic');
		const exported = exportVideoCaptionTrackV1(imported.track, identity);
		const reopened = importVideoCaptionTrackV1(exported.text, identity);
		assert.equal(reopened.track.cues[0]?.text, dialogue);
		assert.equal(reopened.track.speakers[0]?.name, 'John');
	});
}

test('existing abbreviated whole-cue voice remains admitted', () => {
	const imported = importVideoCaptionTrackV1(sidecar(`<v John>${dialogue}`), identity);
	assert.equal(imported.track.cues[0]?.text, dialogue);
	assert.equal(imported.track.speakers[0]?.name, 'John');
});

test('closing voice admission preserves the maintained single-voice and passive markup limits', () => {
	for (const body of [
		'<v John>First.</v><v Mary>Second.</v>',
		'<v John><ruby>Unsupported</ruby></v>',
		'<v John>First.</v>Outside the voice.',
	]) {
		assert.throws(() => importVideoCaptionTrackV1(sidecar(body), identity),
			/markup is outside the passive maintained subset/u);
	}
});
