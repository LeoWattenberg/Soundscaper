/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { openFramescaperCaptionSidecarFile } from '../src/common/editor/ui/framescaper-caption-file-interchange.ts';
import { importVideoCaptionTrackV1 } from '../src/common/editor/video-caption-track-v27.ts';

const TEXT = '1\r\n00:00:00,100 --> 00:00:00,500\r\nÉlodie au café\r\n\r\n';

for (const encoding of ['latin1', 'utf8'] as const) {
	test(`the Framescaper sidecar file owner admits ordinary ${encoding} SubRip without changing its text`, async () => {
		const file = new File([Buffer.from(TEXT, encoding)], 'dialogue.srt');
		const opened = await openFramescaperCaptionSidecarFile({ file });
		assert.ok(opened);
		assert.equal(opened.text, TEXT);
		const imported = importVideoCaptionTrackV1(opened.text, {
			format: opened.format, sampleRate: 48_000, trackId: 'captions',
			sequenceId: 'main', trackName: 'Dialogue', language: 'fr',
		});
		assert.equal(imported.track.cues[0]?.text, 'Élodie au café');
		assert.deepEqual(imported.losses, []);
	});
}

test('desktop SubRip descriptors use the same legacy encoding admission', async () => {
	const file = new File([Buffer.from(TEXT, 'latin1')], 'dialogue.srt');
	const opened = await openFramescaperCaptionSidecarFile({ fileService: {
		isDesktop: true, chooseFiles: () => [{ id: 'picked' }], openReadDescriptor: () => file,
	} });
	assert.equal(opened?.text, TEXT);
});

test('WebVTT and IMSC file picks retain their strict UTF-8 admission', async () => {
	for (const extension of ['vtt', 'ttml']) {
		const file = new File([Buffer.from('Élodie', 'latin1')], `dialogue.${extension}`);
		await assert.rejects(openFramescaperCaptionSidecarFile({ file }), /strict UTF-8/u);
	}
});
