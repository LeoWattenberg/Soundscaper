/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createVideoElementaryStreamWriter } from '../src/common/editor/video-elementary-stream.ts';

test('an H.264 stream adds nothing, because Annex B chunks already frame themselves', () => {
	const writer = writerFor('h264');
	const chunk = Uint8Array.from([0, 0, 0, 1, 0x65, 0x88]);

	assert.deepEqual([...writer.header()], []);
	assert.equal(writer.frame(chunk, 0), chunk, 'the chunk is passed through, not copied and reframed');
});

test('an IVF header states the picture and the exact rational rate', () => {
	const header = writerFor('vp9').header();

	assert.equal(header.byteLength, 32);
	assert.equal(new TextDecoder().decode(header.subarray(0, 4)), 'DKIF');
	assert.equal(new TextDecoder().decode(header.subarray(8, 12)), 'VP90');
	const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
	assert.equal(view.getUint16(4, true), 0, 'version');
	assert.equal(view.getUint16(6, true), 32, 'header length');
	assert.equal(view.getUint16(12, true), 1_280);
	assert.equal(view.getUint16(14, true), 720);
	// The rational the plan owns, not a decimal standing in for it.
	assert.equal(view.getUint32(16, true), 30_000);
	assert.equal(view.getUint32(20, true), 1_001);
	assert.equal(view.getUint32(24, true), 90, 'frame count');
	assert.equal(view.getUint32(28, true), 0, 'reserved');
});

test('each IVF frame carries its own length and position', () => {
	const writer = writerFor('vp9');
	const frame = writer.frame(Uint8Array.from([1, 2, 3, 4, 5]), 7);
	const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);

	assert.equal(frame.byteLength, 12 + 5);
	assert.equal(view.getUint32(0, true), 5);
	assert.equal(view.getBigUint64(4, true), 7n);
	assert.deepEqual([...frame.subarray(12)], [1, 2, 3, 4, 5]);
});

test('a codec with no elementary form is a refusal rather than a bare byte stream', () => {
	assert.throws(
		() => createVideoElementaryStreamWriter({
			videoCodec: 'av1', width: 1_280, height: 720, frameRate: { num: 30, den: 1 }, frameCount: 1,
		}),
		/No elementary stream form is defined for av1/u,
	);
});

test('an empty chunk is refused, since a zero-length frame is not a frame', () => {
	for (const codec of ['h264', 'vp9']) {
		assert.throws(() => writerFor(codec).frame(new Uint8Array(0), 0), /cannot be empty/u);
		assert.throws(() => writerFor(codec).frame([1, 2] as never, 0), /must arrive as bytes/u);
	}
});

test('geometry past what the container can state is refused at construction', () => {
	assert.throws(
		() => createVideoElementaryStreamWriter({
			videoCodec: 'vp9', width: 70_000, height: 720, frameRate: { num: 30, den: 1 }, frameCount: 1,
		}),
		/width must be at most 65535/u,
	);
	assert.throws(
		() => createVideoElementaryStreamWriter({
			videoCodec: 'vp9', width: 1_280, height: 720, frameRate: { num: 0, den: 1 }, frameCount: 1,
		}),
		/frame rate numerator must be a positive safe integer/u,
	);
});

function writerFor(videoCodec: string) {
	return createVideoElementaryStreamWriter({
		videoCodec,
		width: 1_280,
		height: 720,
		frameRate: { num: 30_000, den: 1_001 },
		frameCount: 90,
	});
}
