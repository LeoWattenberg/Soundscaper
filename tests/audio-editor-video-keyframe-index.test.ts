/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	keyframeAtOrBefore,
	parseFfmpegVideoKeyframeLogs,
} from '../src/common/editor/ffmpeg-video-keyframe-index.ts';
import {
	alignTrimMediaRunsToKeyframes,
	createTrimMediaPlan,
	trimMediaRetainsFrame,
} from '../src/common/editor/trim-media-plan.ts';

/**
 * Real `showinfo` output from the pinned FFmpeg, encoding a 30-frame clip with
 * `-g 10`: keyframes land on 0, 10 and 20. Reproduced here in the shape the
 * build actually prints rather than a shape this test finds convenient.
 */
function showinfoLines(frameCount = 30, gop = 10): string[] {
	return Array.from({ length: frameCount }, (_value, index) => (
		`[Parsed_showinfo_0 @ 0xed5690] n:${String(index).padStart(4)} pts:${String(index * 1024).padStart(7)}`
		+ ` pts_time:${index / 10} pos:1688 fmt:yuv420p sar:1/1 s:64x64 i:P`
		+ ` iskey:${index % gop === 0 ? 1 : 0} type:${index % gop === 0 ? 'I' : 'B'} checksum:1ABDB7BE`
	));
}

test('keyframes are read out of the pass the timing probe already runs', () => {
	assert.deepEqual(parseFfmpegVideoKeyframeLogs(showinfoLines()), [0, 10, 20]);
	// Lines that are not showinfo output are ignored rather than misparsed.
	assert.deepEqual(
		parseFfmpegVideoKeyframeLogs([
			'[Parsed_showinfo_0 @ 0x1] config in time_base: 1/10240, frame_rate: 10/1',
			...showinfoLines(12, 6),
			'frame=   12 fps=0.0 q=-1.0 Lsize=N/A time=00:00:01.20 bitrate=N/A speed= 1x',
		]),
		[0, 6],
	);
});

test('a stream with no keyframe at its start cannot be cut losslessly anywhere', () => {
	const headless = showinfoLines().map((line) => line.replace('iskey:1', 'iskey:0'));
	// Pretending frame 0 were a keyframe would produce exactly the unwatchable
	// output this index exists to prevent.
	assert.throws(() => parseFfmpegVideoKeyframeLogs(headless), /no keyframe at the start/u);
	assert.throws(() => parseFfmpegVideoKeyframeLogs([]), /no frames to index/u);
	assert.throws(() => parseFfmpegVideoKeyframeLogs('not an array' as never), /must be an array/u);
});

test('the keyframe at or before a frame is where its cut has to begin', () => {
	const keyframes = [0, 10, 20];
	for (let frame = 0; frame < 30; frame += 1) {
		const found = keyframeAtOrBefore(keyframes, frame);
		assert.ok(found <= frame);
		assert.ok(keyframes.includes(found));
		assert.equal(keyframes.filter((value) => value > found && value <= frame).length, 0);
	}
	assert.throws(() => keyframeAtOrBefore([5, 10], 3), /No keyframe precedes/u);
	assert.throws(() => keyframeAtOrBefore(keyframes, -1), /non-negative/u);
});

test('aligning runs only ever retains more, never less', () => {
	const plan = createTrimMediaPlan({
		project: {
			sources: [{ id: 'a', frameCount: 30 }],
			clips: [
				{ id: 'c1', sourceId: 'a', sourceStartFrame: 3, sourceDurationFrames: 4 },
				{ id: 'c2', sourceId: 'a', sourceStartFrame: 22, sourceDurationFrames: 5 },
			],
		},
	});
	const source = plan.sources[0]!;
	const aligned = alignTrimMediaRunsToKeyframes(source, [0, 10, 20]);

	assert.deepEqual(aligned, [
		{ startFrame: 0, endFrame: 7 },
		{ startFrame: 20, endFrame: 27 },
	]);
	// Exhaustive rather than by example: nothing the plan proved was referenced
	// may stop being retained by the alignment that makes the cut lossless.
	for (let frame = 0; frame < source.frameCount; frame += 1) {
		if (!trimMediaRetainsFrame(source, frame)) continue;
		assert.ok(
			aligned.some((range) => frame >= range.startFrame && frame < range.endFrame),
			`frame ${frame} was referenced and the alignment dropped it`,
		);
	}
	// Every run begins where a decoder can begin.
	for (const range of aligned) assert.ok([0, 10, 20].includes(range.startFrame));
});

test('runs that meet after widening are merged rather than left as two cuts', () => {
	const plan = createTrimMediaPlan({
		project: {
			sources: [{ id: 'a', frameCount: 30 }],
			clips: [
				{ id: 'c1', sourceId: 'a', sourceStartFrame: 2, sourceDurationFrames: 2 },
				{ id: 'c2', sourceId: 'a', sourceStartFrame: 12, sourceDurationFrames: 2 },
			],
		},
	});
	const aligned = alignTrimMediaRunsToKeyframes(plan.sources[0]!, [0, 10, 20]);

	// Widened but still separated by a gap, so both runs survive as two cuts.
	assert.deepEqual(aligned, [
		{ startFrame: 0, endFrame: 4 },
		{ startFrame: 10, endFrame: 14 },
	]);

	const touching = createTrimMediaPlan({
		project: {
			sources: [{ id: 'a', frameCount: 30 }],
			clips: [
				{ id: 'c1', sourceId: 'a', sourceStartFrame: 2, sourceDurationFrames: 8 },
				{ id: 'c2', sourceId: 'a', sourceStartFrame: 12, sourceDurationFrames: 2 },
			],
		},
	});
	// Here the first run reaches 10 and the second widens back to it, so the two
	// become one: a boundary between frames the file treats as a single run is
	// exactly what a merge exists to prevent.
	assert.deepEqual(alignTrimMediaRunsToKeyframes(touching.sources[0]!, [0, 10, 20]), [
		{ startFrame: 0, endFrame: 14 },
	]);
});

test('aligning without a keyframe index is refused rather than guessed', () => {
	const plan = createTrimMediaPlan({
		project: {
			sources: [{ id: 'a', frameCount: 30 }],
			clips: [{ id: 'c1', sourceId: 'a', sourceStartFrame: 5, sourceDurationFrames: 5 }],
		},
	});
	assert.throws(() => alignTrimMediaRunsToKeyframes(plan.sources[0]!, []), /keyframe index/u);
});
