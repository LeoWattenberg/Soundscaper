/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	buildFfmpegVideoTimingProbeArgs,
	parseFfmpegVideoTimingLogs,
} from '../src/common/editor/ffmpeg-video-timing-probe.ts';
import { probeFfmpegVideoTiming } from '../src/common/editor/ffmpeg-video-timing-operation.ts';
import { VIDEO_TIMING_ASSET_MAXIMUM_FRAMES } from '../src/common/editor/video-timing-asset-reference.ts';

test('FFmpeg probes one frame beyond the timing-asset ceiling to reject truncation', () => {
	const args = buildFfmpegVideoTimingProbeArgs('input.mp4');
	const limitIndex = args.indexOf('-frames:v');
	assert.notEqual(limitIndex, -1);
	assert.equal(args[limitIndex + 1], String(VIDEO_TIMING_ASSET_MAXIMUM_FRAMES + 1));
});

test('the probe disables autorotation so showinfo describes coded frames', () => {
	const args = buildFfmpegVideoTimingProbeArgs('input.mp4');
	const rotationIndex = args.indexOf('-noautorotate');
	assert.notEqual(rotationIndex, -1);
	// An input option only applies to the input it precedes.
	assert.ok(rotationIndex < args.indexOf('-i'));
});

test('FFmpeg showinfo parsing preserves exact CFR time bases and rational rates', () => {
	const result = parseFfmpegVideoTimingLogs([
		'[Parsed_showinfo_0] config in time_base: 1/90000, frame_rate: 30000/1001',
		'[Parsed_showinfo_0] n: 0 pts: 9009 pts_time:0.1001 duration: 3003 duration_time:0.0333667',
		'[Parsed_showinfo_0] n: 1 pts: 12012 pts_time:0.133467 duration: 3003 duration_time:0.0333667',
		'[Parsed_showinfo_0] n: 2 pts: 15015 pts_time:0.166833 duration: 3003 duration_time:0.0333667',
	]);

	assert.deepEqual(result.nominalRate, { num: 30_000, den: 1_001 });
	assert.equal(result.timescale, 90_000);
	assert.deepEqual(result.presentationTicks, [0n, 3_003n, 6_006n]);
	assert.equal(result.finalFrameDurationTicks, 3_003n);
});

test('FFmpeg showinfo parsing retains unequal VFR presentation deltas', () => {
	const result = parseFfmpegVideoTimingLogs([
		'[Parsed_showinfo_0] config in time_base: 1/1000000, frame_rate: 24/1',
		'[Parsed_showinfo_0] n: 0 pts: 0 pts_time:0',
		'[Parsed_showinfo_0] n: 1 pts: 33333 pts_time:0.033333',
		'[Parsed_showinfo_0] n: 2 pts: 83333 pts_time:0.083333',
		'[Parsed_showinfo_0] n: 3 pts: 116666 pts_time:0.116666 duration: 41667 duration_time:0.041667',
	]);

	assert.deepEqual(result.presentationTicks, [0n, 33_333n, 83_333n, 116_666n]);
	assert.equal(result.finalFrameDurationTicks, 41_667n);
});

test('FFmpeg timing parsing rejects missing, discontinuous, and backward PTS evidence', () => {
	assert.throws(() => parseFfmpegVideoTimingLogs([]), /complete/iu);
	assert.throws(() => parseFfmpegVideoTimingLogs([
		'[showinfo] config in time_base: 1/1000, frame_rate: 25/1',
		'[showinfo] n: 1 pts: 0 pts_time:0',
	]), /contiguous/iu);
	assert.throws(() => parseFfmpegVideoTimingLogs([
		'[showinfo] config in time_base: 1/1000, frame_rate: 25/1',
		'[showinfo] n: 0 pts: 10 pts_time:0.01',
		'[showinfo] n: 1 pts: 9 pts_time:0.009',
	]), /strictly increasing/iu);
});

test('a first-generation timing probe resolves WORKERFS after its runtime loads', async () => {
	const events: string[] = [];
	let loaded = false;
	let logListener: ((entry: { message?: string }) => void) | null = null;
	const result = await probeFfmpegVideoTiming({
		file: new File([Uint8Array.of(1, 2, 3)], '../unsafe/video.mp4', { type: 'video/mp4' }),
		workerFsType: () => loaded ? 'WORKERFS' : null,
		terminateRuntime() {},
		async run(task, beforeLoad) {
			beforeLoad?.();
			loaded = true;
			return task({
				async createDir() { events.push('mkdir'); },
				async mount(type: unknown, options: unknown) {
					events.push(`mount:${String(type)}:${String((options as { blobs: Blob[] }).blobs.length)}`);
				},
				async unmount() { events.push('unmount'); },
				async deleteDir() { events.push('rmdir'); },
				async deleteFile() { events.push('delete-file'); },
				async writeFile() { throw new Error('copied the whole File into MEMFS'); },
				async exec() {
					logListener?.({ message: '[Parsed_showinfo_0] config in time_base: 1/1000, frame_rate: 25/1' });
					logListener?.({ message: '[Parsed_showinfo_0] n: 0 pts: 0 duration: 40 fmt:yuv420p sar:1/1 s:1920x1080 i:P' });
					return 0;
				},
				on(_event: string, listener: (entry: { message?: string }) => void) { logListener = listener; },
				off() { logListener = null; },
			} as never);
		},
	});

	assert.equal(result.timescale, 1_000);
	assert.deepEqual(events, ['mkdir', 'mount:WORKERFS:1', 'unmount', 'rmdir']);
});

test('a queued timing probe cancels before acquiring a runtime', async () => {
	let release!: () => void;
	const gate = new Promise<void>((resolve) => { release = resolve; });
	let runtimeAcquisitions = 0;
	const controller = new AbortController();
	const reason = new DOMException('queued timing probe cancelled', 'AbortError');
	const probing = probeFfmpegVideoTiming({
		file: new Blob(['video']),
		signal: controller.signal,
		workerFsType: () => null,
		terminateRuntime() {},
		async run(task, beforeLoad) {
			await gate;
			beforeLoad?.();
			runtimeAcquisitions += 1;
			return task({} as never);
		},
	});

	controller.abort(reason);
	release();
	await assert.rejects(probing, (error: unknown) => error === reason);
	assert.equal(runtimeAcquisitions, 0);
});
