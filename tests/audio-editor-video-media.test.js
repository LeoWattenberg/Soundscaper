import assert from 'node:assert/strict';
import test from 'node:test';

import {
	audioEditorVideoThumbnailTimes,
	isAudioEditorVideoFile,
} from '../src/lib/tools/audio-editor/video-media.js';

test('video-file detection accepts the initial MP4 and WebM containers', () => {
	assert.equal(isAudioEditorVideoFile({ name: 'clip.mp4', type: '' }), true);
	assert.equal(isAudioEditorVideoFile({ name: 'clip.M4V', type: 'application/octet-stream' }), true);
	assert.equal(isAudioEditorVideoFile({ name: 'clip.webm', type: 'video/webm' }), true);
	assert.equal(isAudioEditorVideoFile({ name: 'audio.webm', type: 'audio/webm' }), true);
	assert.equal(isAudioEditorVideoFile({ name: 'voice.wav', type: 'audio/wav' }), false);
});

test('video thumbnails use a five-second base grid and retain the final frame', () => {
	assert.deepEqual(audioEditorVideoThumbnailTimes(0), [0]);
	assert.deepEqual(audioEditorVideoThumbnailTimes(10), [0, 5, 9.95]);
	assert.deepEqual(audioEditorVideoThumbnailTimes(10.01), [0, 5, 10]);
	assert.deepEqual(audioEditorVideoThumbnailTimes(16, { maximum: 3 }), [0, 5, 10]);
});
