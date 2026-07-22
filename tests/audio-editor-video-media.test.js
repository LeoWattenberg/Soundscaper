import assert from 'node:assert/strict';
import test from 'node:test';

import {
	audioEditorVideoThumbnailTimes,
	createAudioEditorVideoFrameExtractor,
	isAudioEditorVideoFile,
} from '../src/common/editor/video-media.js';

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

test('the initial poster seeks before drawing so metadata timing cannot produce a black frame', async () => {
	const seeks = [];
	let drawCount = 0;
	const video = {
		preload: '',
		muted: false,
		playsInline: false,
		currentTime: 0,
		duration: 10,
		videoWidth: 640,
		videoHeight: 360,
		addEventListener(type, listener) {
			this.listeners ||= new Map();
			this.listeners.set(type, listener);
		},
		removeEventListener(type) { this.listeners?.delete(type); },
		set src(value) {
			this.source = value;
			queueMicrotask(() => this.listeners?.get('loadedmetadata')?.());
		},
		removeAttribute() {},
		load() {},
		pause() {},
	};
	Object.defineProperty(video, 'currentTime', {
		get() { return this._currentTime || 0; },
		set(value) { this._currentTime = value; seeks.push(value); queueMicrotask(() => this.listeners?.get('seeked')?.()); },
	});
	const document = {
		createElement(type) {
			if (type === 'video') return video;
			if (type === 'canvas') return {
				width: 0,
				height: 0,
				getContext() { return { drawImage() { drawCount += 1; } }; },
				toBlob(callback, mimeType) { callback(new Blob(['thumbnail'], { type: mimeType })); },
			};
			throw new Error(`Unexpected element: ${type}`);
		},
	};
	const urlApi = {
		createObjectURL() { return 'blob:video'; },
		revokeObjectURL() {},
	};
	const extractor = await createAudioEditorVideoFrameExtractor(
		new Blob(['video'], { type: 'video/mp4' }),
		{ document, urlApi, timeoutMs: 100 },
	);
	await extractor.capture(0);
	extractor.dispose();
	assert.ok(seeks.some((value) => value > 0), 'the first capture should force a decoder seek');
	assert.equal(drawCount, 1);
});
