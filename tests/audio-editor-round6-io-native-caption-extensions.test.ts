/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createAudioEditorFileService } from '../src/common/editor/file-service.js';
import { exportVideoCaptionTrackV1, importVideoCaptionTrackV1 } from '../src/common/editor/video-caption-track-v27.ts';
import { nativeSidecarFixture } from './helpers/framescaper-native-sidecar-fixture.ts';

const SUBRIP = '1\n00:00:00,100 --> 00:00:00,500\nA normal caption\n\n';
const track = importVideoCaptionTrackV1(SUBRIP, {
	format: 'srt', sampleRate: 48_000, trackId: 'captions', sequenceId: 'main',
	trackName: 'Dialogue', language: 'en',
}).track;
const imsc = exportVideoCaptionTrackV1(track, { format: 'imsc1.1', sampleRate: 48_000 }).text;

for (const extension of ['srt', 'vtt', 'webvtt', 'ttml', 'imsc', 'xml']) {
	test(`the actual native Caption Tracks picker admits the supported ${extension} file`, async (context) => {
		const text = extension === 'srt' ? SUBRIP
			: extension === 'vtt' || extension === 'webvtt'
				? exportVideoCaptionTrackV1(track, { format: 'webvtt', sampleRate: 48_000 }).text : imsc;
		const fixture = await nativeSidecarFixture(`dialogue.${extension}`, text);
		context.after(fixture.close);
		const service = createAudioEditorFileService({ bridge: fixture.bridge, fetch: fixture.fetch });
		const descriptors = await service.chooseFiles({ purpose: 'labels', multiple: false });
		assert.equal(descriptors.length, 1);
		await service.withReadDescriptors(descriptors, {}, async (files: readonly Blob[]) => {
			assert.equal(await files[0].text(), text);
		});
		assert.equal(fixture.releases.length, 1);
		assert.ok(JSON.stringify(fixture.calls).includes(`"${extension}"`), 'the native dialog displays this supported extension');
	});
}
