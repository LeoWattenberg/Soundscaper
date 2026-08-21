/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
	createVideoPreviewBenchmarkFixture,
	videoPreviewBenchmarkMedia,
} from './browser/fixtures/video-preview-benchmark-media.js';

test('the 720p preview benchmark uses digest-pinned media instead of runtime capture', () => {
	const media = videoPreviewBenchmarkMedia;
	assert.deepEqual(media.display, { width: 1_280, height: 720 });
	assert.equal(media.frameRate, 30);
	assert.ok(media.frameCount >= 180);
	assert.equal(createHash('sha256').update(media.file.buffer).digest('hex'), media.sourceSha256);
	assert.deepEqual(media.file.buffer.subarray(0, 4), Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
	assert.ok(media.file.buffer.includes(Buffer.from('V_VP8')));

	const first = createVideoPreviewBenchmarkFixture('first.webm');
	const second = createVideoPreviewBenchmarkFixture('second.webm');
	assert.equal(first.name, 'first.webm');
	assert.equal(first.mimeType, 'video/webm');
	assert.notStrictEqual(first.buffer, second.buffer);
	assert.deepEqual(first.buffer, second.buffer);
});

test('the preview benchmark does not start browser capture APIs during fixture setup', () => {
	const source = readFileSync(
		new URL('browser/audio-editor-video-preview-benchmark.spec.js', import.meta.url),
		'utf8',
	);
	assert.match(source, /createVideoPreviewBenchmarkFixture/u);
	assert.doesNotMatch(source, /\bMediaRecorder\b|\.captureStream\(|new AudioContext\(/u);
});

test('the quality-budget fixture registration pins the shipped benchmark media', () => {
	const quality = JSON.parse(readFileSync(
		new URL('../config/quality-budgets.json', import.meta.url),
		'utf8',
	));
	const fixture = quality.fixtures.find(({ id }) => id === videoPreviewBenchmarkMedia.id);
	assert.equal(fixture.kind, 'digest-pinned-media');
	assert.equal(fixture.specification.sourceByteLength, videoPreviewBenchmarkMedia.byteLength);
	assert.equal(fixture.specification.sourceSha256, videoPreviewBenchmarkMedia.sourceSha256);
	assert.equal(fixture.specification.sourceFrameRate, videoPreviewBenchmarkMedia.frameRate);
	assert.equal(fixture.specification.sourceFrameCount, videoPreviewBenchmarkMedia.frameCount);
	assert.doesNotMatch(fixture.limitation, /MediaRecorder|not digest-pinned/iu);
});
