/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { openFramescaperCaptionSidecarFile } from '../src/common/editor/ui/framescaper-caption-file-interchange.ts';
import { importVideoCaptionTrackV1 } from '../src/common/editor/video-caption-track-v27.ts';

const OPTIONS = Object.freeze({
	format: 'webvtt' as const, sampleRate: 48_000,
	trackId: 'interview', sequenceId: 'sequence-main', trackName: 'Interview', language: 'en',
});

test('the Caption Tracks file importer accepts ordinary WebVTT header text and NOTE comments', async () => {
	const opened = await openFramescaperCaptionSidecarFile({
		file: new File([
			'WEBVTT Interview transcript\n\nNOTE Transcribed by the editor\nReviewed on Friday.\n\n',
			'hello\n00:00.100 --> 00:00.500\nHello there.\n\nNOTE End of introduction\n',
		], 'interview.vtt'),
	});
	assert.ok(opened);
	const imported = importVideoCaptionTrackV1(opened.text, OPTIONS);
	assert.deepEqual(imported.track.cues.map(({ id, startFrame, endFrame, text }) => ({ id, startFrame, endFrame, text })), [
		{ id: 'hello', startFrame: 4800, endFrame: 24000, text: 'Hello there.' },
	]);
});

test('the Caption Tracks file importer accepts WebVTT space and tab timing separators', async () => {
	const opened = await openFramescaperCaptionSidecarFile({
		file: new File(['WEBVTT\n\n00:00.100\t-->  00:00.500\nHello there.\n'], 'interview.vtt'),
	});
	assert.ok(opened);
	const imported = importVideoCaptionTrackV1(opened.text, OPTIONS);
	assert.equal(imported.track.cues[0]?.startFrame, 4800);
	assert.equal(imported.track.cues[0]?.endFrame, 24000);
});

test('ordinary WebVTT NOTE blocks are passive comments rather than caption cues', () => {
	const imported = importVideoCaptionTrackV1('WEBVTT\n\nNOTE Editor comment\n\n00:00.100 --> 00:00.500\nHello there.\n', OPTIONS);
	assert.equal(imported.track.cues.length, 1);
	assert.equal(imported.track.cues[0]?.text, 'Hello there.');
});
