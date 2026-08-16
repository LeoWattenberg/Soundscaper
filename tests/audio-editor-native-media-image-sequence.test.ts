/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	nativeMediaImageSequencePattern,
	NATIVE_MEDIA_IMAGE_SEQUENCE_EXTENSIONS,
	NativeMediaImageSequenceError,
	resolveNativeMediaImageSequence,
} from '../src/common/editor/native-media-image-sequence.ts';

const RATE = { num: 24, den: 1 } as const;

test('frames are ordered numerically, not lexically', () => {
	const sequence = resolveNativeMediaImageSequence({
		fileNames: ['shot_10.png', 'shot_2.png', 'shot_1.png', 'shot_3.png', 'shot_9.png',
			'shot_4.png', 'shot_5.png', 'shot_6.png', 'shot_7.png', 'shot_8.png'],
		frameRate: RATE,
	});

	assert.deepEqual(sequence.frames.map((frame) => frame.fileName), [
		'shot_1.png', 'shot_2.png', 'shot_3.png', 'shot_4.png', 'shot_5.png',
		'shot_6.png', 'shot_7.png', 'shot_8.png', 'shot_9.png', 'shot_10.png',
	]);
	assert.deepEqual(sequence.frames.map((frame) => frame.index), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
	assert.equal(sequence.firstFrameNumber, 1);
	assert.equal(sequence.lastFrameNumber, 10);
	assert.equal(sequence.frameCount, 10);
	assert.equal(sequence.frameNumberWidth, 0);
	assert.equal(nativeMediaImageSequencePattern(sequence), 'shot_%d.png');
});

test('a zero-padded sequence records its exact width', () => {
	const sequence = resolveNativeMediaImageSequence({
		fileNames: ['render.0098.exr', 'render.0099.exr', 'render.0100.exr'],
		frameRate: { num: 24_000, den: 1_001 },
	});

	assert.equal(sequence.stem, 'render.');
	assert.equal(sequence.extension, 'exr');
	assert.equal(sequence.frameNumberWidth, 4);
	assert.deepEqual(sequence.frameRate, { num: 24_000, den: 1_001 });
	assert.equal(nativeMediaImageSequencePattern(sequence), 'render.%04d.exr');
});

test('a missing frame is refused with the exact numbers, not silently filled', () => {
	const error = refusal({
		fileNames: ['f_001.tif', 'f_002.tif', 'f_005.tif', 'f_006.tif'],
		frameRate: RATE,
	});

	assert.equal(error.refusal, 'missing-frame-numbers');
	assert.deepEqual(error.detail, [3, 4]);
});

test('a duplicate frame number is refused before any project mutation', () => {
	const error = refusal({
		fileNames: ['f_01.png', 'f_001.png', 'f_02.png'],
		frameRate: RATE,
	});

	assert.equal(error.refusal, 'inconsistent-frame-number-width');

	const sameWidth = refusal({
		fileNames: ['f_01.png', 'f_01.png', 'f_02.png'],
		frameRate: RATE,
	});
	assert.equal(sameWidth.refusal, 'duplicate-frame-numbers');
	assert.deepEqual(sameWidth.detail, [1]);
});

test('mixing padded and unpadded numbering is ambiguous and refused', () => {
	const error = refusal({ fileNames: ['f_1.png', 'f_02.png'], frameRate: RATE });

	assert.equal(error.refusal, 'inconsistent-frame-number-width');
	assert.deepEqual(error.detail, [1, 2]);
});

test('one import authors exactly one sequence', () => {
	const differentStems = refusal({
		fileNames: ['a_001.png', 'b_001.png'],
		frameRate: RATE,
	});
	const differentExtensions = refusal({
		fileNames: ['a_001.png', 'a_002.tif'],
		frameRate: RATE,
	});

	assert.equal(differentStems.refusal, 'mixed-sequences');
	assert.equal(differentExtensions.refusal, 'mixed-sequences');
});

test('only the licensed still formats are admitted', () => {
	assert.deepEqual([...NATIVE_MEDIA_IMAGE_SEQUENCE_EXTENSIONS], ['png', 'tif', 'tiff', 'exr']);
	assert.equal(refusal({ fileNames: ['f_001.jpg'], frameRate: RATE }).refusal, 'unsupported-extension');
	assert.equal(refusal({ fileNames: ['f_001.dpx'], frameRate: RATE }).refusal, 'unsupported-extension');
	assert.doesNotThrow(() => resolveNativeMediaImageSequence({
		fileNames: ['f_001.TIFF'], frameRate: RATE,
	}));
});

test('an unnumbered or path-bearing file is refused', () => {
	assert.equal(refusal({ fileNames: ['poster.png'], frameRate: RATE }).refusal, 'no-numbered-frames');
	assert.equal(refusal({ fileNames: [], frameRate: RATE }).refusal, 'no-numbered-frames');
	assert.equal(
		refusal({ fileNames: ['shots/f_001.png'], frameRate: RATE }).refusal,
		'no-numbered-frames',
	);
	assert.equal(
		refusal({ fileNames: ['shots\\f_001.png'], frameRate: RATE }).refusal,
		'no-numbered-frames',
	);
});

test('the frame rate is user-selected and exact, never inferred', () => {
	for (const frameRate of [
		undefined, null, 24, { num: 24 }, { num: 0, den: 1 }, { num: 24, den: 0 },
		{ num: 24, den: 1, extra: 1 }, { num: 24.5, den: 1 }, { num: 2_000_000, den: 1 },
	]) {
		assert.equal(
			refusal({ fileNames: ['f_001.png'], frameRate: frameRate as never }).refusal,
			'frame-rate-not-exact',
		);
	}
});

test('the frame rate is validated before the file names are even parsed', () => {
	// Refusing the rate first keeps the user from fixing a name list only to be
	// told afterwards that the rate they chose was never acceptable.
	const error = refusal({ fileNames: ['not-a-sequence'], frameRate: { num: 0, den: 1 } as never });

	assert.equal(error.refusal, 'frame-rate-not-exact');
});

function refusal(request: Parameters<typeof resolveNativeMediaImageSequence>[0]) {
	try {
		resolveNativeMediaImageSequence(request);
	} catch (error) {
		assert.ok(error instanceof NativeMediaImageSequenceError);
		return error;
	}
	throw new assert.AssertionError({ message: 'The image sequence was admitted unexpectedly.' });
}
