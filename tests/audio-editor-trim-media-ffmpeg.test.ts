/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	buildTrimMediaConcatArgs,
	buildTrimMediaCutArgs,
	trimMediaConcatListText,
	trimMediaSeekSeconds,
} from '../src/common/editor/trim-media-ffmpeg.ts';

const NTSC = Object.freeze({ num: 30_000, den: 1_001 });

test('a run is copied rather than re-encoded, so trimming costs no generation', () => {
	const args = buildTrimMediaCutArgs({
		inputPath: '/src.mp4', startFrame: 80, frameCount: 7,
		frameRate: NTSC, container: 'mp4', outputPath: '/part-0.mp4',
	});

	assert.deepEqual(args, [
		'-nostdin', '-y', '-ss', '2.686017', '-i', '/src.mp4',
		'-frames:v', '7', '-c', 'copy', '-avoid_negative_ts', 'make_zero',
		'-f', 'mp4', '/part-0.mp4',
	]);
	// The seek is before the input, which is what makes FFmpeg jump to a keyframe
	// instead of decoding up to the cut.
	assert.ok(args.indexOf('-ss') < args.indexOf('-i'));
	assert.equal(args.includes('libx264'), false);
});

test('the seek lands inside its frame, whatever the rational rate does to a decimal', () => {
	// Half a frame of tolerance either way: landing early would snap to the
	// previous keyframe and cut material nobody asked for, landing late would
	// miss the keyframe entirely.
	for (const [frame, rate] of [
		[0, NTSC], [1, NTSC], [80, NTSC], [107_892, NTSC],
		[0, { num: 25, den: 1 }], [999, { num: 24_000, den: 1_001 }],
	] as const) {
		const seconds = Number(trimMediaSeekSeconds(frame, rate));
		const frameStart = (frame * rate.den) / rate.num;
		const frameEnd = ((frame + 1) * rate.den) / rate.num;
		assert.ok(seconds > frameStart, `frame ${frame} seek landed at or before its start`);
		assert.ok(seconds < frameEnd, `frame ${frame} seek landed at or after the next frame`);
	}
});

test('a cut refuses anything that is not an exact rational rate or a real range', () => {
	const base = {
		inputPath: '/src.mp4', startFrame: 0, frameCount: 7,
		frameRate: NTSC, container: 'mp4', outputPath: '/part.mp4',
	};
	for (const [override, message] of [
		[{ frameRate: { num: 30, den: 0 } }, /exact rational frame rate/u],
		[{ frameRate: { num: 29.97, den: 1 } }, /exact rational frame rate/u],
		[{ frameCount: 0 }, /frame count must be a positive/u],
		[{ startFrame: -1 }, /start frame must be a non-negative/u],
		[{ inputPath: '' }, /input path is required/u],
		[{ outputPath: 'out\0.mp4' }, /must not contain NUL/u],
	] as const) {
		assert.throws(() => buildTrimMediaCutArgs({ ...base, ...override } as never), message);
	}
});

test('the parts are joined by a copy as well', () => {
	assert.deepEqual(
		buildTrimMediaConcatArgs({ listPath: '/list.txt', container: 'mp4', outputPath: '/out.mp4' }),
		[
			'-nostdin', '-y', '-f', 'concat', '-safe', '0', '-i', '/list.txt',
			'-c', 'copy', '-f', 'mp4', '/out.mp4',
		],
	);
});

test('the concat list refuses a path that could break out of its own quoting', () => {
	assert.equal(
		trimMediaConcatListText(['/part-0.mp4', '/part-1.mp4']),
		"file '/part-0.mp4'\nfile '/part-1.mp4'\n",
	);
	assert.throws(() => trimMediaConcatListText([]), /at least one part/u);
	assert.throws(() => trimMediaConcatListText(["/pa'rt.mp4"]), /quote or a newline/u);
	assert.throws(() => trimMediaConcatListText(['/part\n.mp4']), /quote or a newline/u);
});
