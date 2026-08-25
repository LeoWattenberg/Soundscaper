/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import test from 'node:test';

import {
	inspectExternalFfmpegVideoCanaryOutput,
} from '../desktop/external-ffmpeg-video-canary-inspection.ts';
import type {
	ExternalFfmpegProcessRequest,
	ExternalFfmpegProcessResult,
	ExternalFfmpegProcessRunner,
} from '../desktop/external-ffmpeg-probe.ts';
import type {
	ExternalFfmpegVideoChildProcess,
	ExternalFfmpegVideoLaunchOptions,
	ExternalFfmpegVideoSpawn,
} from '../desktop/external-ffmpeg-video-process.ts';

const WORKING_DIRECTORY = '/private/video-canary';
const FFPROBE_PATH = '/opt/ffprobe';
const OUTPUT_LIMIT = 64 * 1024;

test('inspects MP4 and WebM with one exact bounded shell-free ffprobe command', async () => {
	for (const [format, streams] of [
		['mp4', [stream(0, 'video', 'h264'), stream(1, 'audio', 'aac')]],
		['webm', [stream(0, 'video', 'vp9'), stream(1, 'audio', 'opus')]],
	] as const) {
		const requests: ExternalFfmpegProcessRequest[] = [];
		const outputPath = `${WORKING_DIRECTORY}/canary.${format}`;
		await inspectExternalFfmpegVideoCanaryOutput({
			format, ffprobePath: FFPROBE_PATH, outputPath, workingDirectory: WORKING_DIRECTORY,
			runner: runner((request) => {
				requests.push(request);
				return exited(JSON.stringify({ streams }));
			}),
		});
		assert.deepEqual(requests, [Object.freeze({
			executablePath: FFPROBE_PATH,
			arguments: Object.freeze([
				'-v', 'error',
				'-protocol_whitelist', 'file',
				'-show_entries',
				'stream=index,codec_type,codec_name,width,height,pix_fmt,sample_rate,channels',
				'-of', 'json',
				'-i', outputPath,
			]),
			shell: false,
			standardInput: 'ignore',
			maximumDurationMs: 5_000,
			maximumOutputBytes: OUTPUT_LIMIT,
		})]);
	}
});

test('refuses wrong, missing, duplicate, or extra streams for the exact format', async () => {
	const cases: readonly Readonly<{
		readonly name: string;
		readonly format: 'mp4' | 'webm';
		readonly streams: readonly unknown[];
	}>[] = [
		{ name: 'wrong MP4 video', format: 'mp4', streams: [stream(0, 'video', 'hevc'), stream(1, 'audio', 'aac')] },
		{ name: 'wrong MP4 audio', format: 'mp4', streams: [stream(0, 'video', 'h264'), stream(1, 'audio', 'mp3')] },
		{ name: 'wrong MP4 geometry', format: 'mp4', streams: [
			{ ...stream(0, 'video', 'h264'), width: 32 }, stream(1, 'audio', 'aac'),
		] },
		{ name: 'wrong MP4 pixel format', format: 'mp4', streams: [
			{ ...stream(0, 'video', 'h264'), pix_fmt: 'yuv444p' }, stream(1, 'audio', 'aac'),
		] },
		{ name: 'wrong MP4 sample rate', format: 'mp4', streams: [
			stream(0, 'video', 'h264'), { ...stream(1, 'audio', 'aac'), sample_rate: '44100' },
		] },
		{ name: 'wrong MP4 audio layout', format: 'mp4', streams: [
			stream(0, 'video', 'h264'), { ...stream(1, 'audio', 'aac'), channels: 1 },
		] },
		{ name: 'missing MP4 audio', format: 'mp4', streams: [stream(0, 'video', 'h264')] },
		{ name: 'duplicate WebM video', format: 'webm', streams: [
			stream(0, 'video', 'vp9'), stream(1, 'video', 'vp9'),
		] },
		{ name: 'extra WebM subtitle', format: 'webm', streams: [
			stream(0, 'video', 'vp9'), stream(1, 'audio', 'opus'), stream(2, 'subtitle', 'webvtt'),
		] },
	];
	for (const fixture of cases) await assert.rejects(
		inspect(fixture.format, exited(JSON.stringify({ streams: fixture.streams }))),
		/does not contain exactly|codec tuple/iu,
		fixture.name,
	);
});

test('refuses malformed ffprobe JSON and malformed stream records', async () => {
	for (const stdout of [
		'', '{', '[]', '{}', '{"streams":{}}',
		JSON.stringify({ streams: [stream(0, 'video', 'h264'), { index: 1, codec_type: 'audio' }] }),
		JSON.stringify({ streams: [stream(0, 'video', 'h264'), stream(0, 'audio', 'aac')] }),
	]) await assert.rejects(inspect('mp4', exited(stdout)), /ffprobe|stream|JSON|codec tuple/iu);
});

test('refuses command failure, runner failure, and unavailable ffprobe results', async () => {
	await assert.rejects(inspect('mp4', exited('{}', 7)), /command|exit/iu);
	for (const reason of ['timeout', 'output-limit', 'launch-failed'] as const) await assert.rejects(
		inspect('mp4', Object.freeze({ status: 'unavailable', reason })),
		/ffprobe.*failed|unavailable/iu,
	);
	await assert.rejects(inspectWithRunner('mp4', {
		run() { return Promise.reject(new Error('runner failed')); },
	}), /ffprobe.*failed|unavailable/iu);
});

test('defends the output bound and private canary path when an injected runner drifts', async () => {
	await assert.rejects(inspect('mp4', exited(' '.repeat(OUTPUT_LIMIT + 1))), /output.*limit|bounded/iu);
	await assert.rejects(inspectWithRunner('mp4', runner(() => exited(JSON.stringify({ streams: [
		stream(0, 'video', 'h264'), stream(1, 'audio', 'aac'),
		] }))), '/outside/canary.mp4'), /private|working directory|path/iu);
});

test('the production runner uses the private cwd, curated environment, and detached shell-free launch', async () => {
	const launches: Array<Readonly<{
		executable: string;
		arguments_: readonly string[];
		options: ExternalFfmpegVideoLaunchOptions;
	}>> = [];
	const spawn: ExternalFfmpegVideoSpawn = (executable, arguments_, options) => {
		const child = probeChild();
		launches.push({ executable, arguments_, options });
		queueMicrotask(() => {
			child.stdout.write(JSON.stringify({ streams: [
				stream(0, 'video', 'h264'), stream(1, 'audio', 'aac'),
			] }));
			child.emit('close', 0, null);
		});
		return child;
	};
	await inspectExternalFfmpegVideoCanaryOutput({
		format: 'mp4', ffprobePath: FFPROBE_PATH,
		outputPath: `${WORKING_DIRECTORY}/canary.mp4`, workingDirectory: WORKING_DIRECTORY,
		environment: { PATH: '/host/bin', SystemRoot: 'C:\\Windows' }, spawn,
	});
	assert.equal(launches.length, 1);
	const launch = launches[0]!;
	assert.equal(launch.executable, FFPROBE_PATH);
	assert.equal(launch.options.cwd, WORKING_DIRECTORY);
	assert.equal(launch.options.shell, false);
	assert.deepEqual(launch.options.stdio, ['ignore', 'pipe', 'pipe']);
	assert.equal(launch.options.detached, process.platform !== 'win32');
	assert.equal(launch.options.env.PATH, undefined);
	assert.equal(launch.options.env.HOME, WORKING_DIRECTORY);
	assert.equal(launch.options.env.TMP, WORKING_DIRECTORY);
	assert.equal(launch.options.env.SystemRoot, 'C:\\Windows');
});

test('the production runner terminates and drains its tree on output overflow and cancellation', async () => {
	for (const reason of ['output-limit', 'cancelled'] as const) {
		const controller = new AbortController();
		const kills: NodeJS.Signals[] = [];
		const spawn: ExternalFfmpegVideoSpawn = () => {
			const child = probeChild(kills);
			queueMicrotask(() => {
				if (reason === 'output-limit') child.stdout.write(Buffer.alloc(OUTPUT_LIMIT + 1));
				else controller.abort(new Error('cancelled'));
			});
			return child;
		};
		await assert.rejects(inspectExternalFfmpegVideoCanaryOutput({
			format: 'mp4', ffprobePath: FFPROBE_PATH,
			outputPath: `${WORKING_DIRECTORY}/canary.mp4`, workingDirectory: WORKING_DIRECTORY,
			spawn, signal: controller.signal, terminationGraceMs: 1, killWaitMs: 1,
		}), /ffprobe.*failed|unavailable/iu);
		assert.deepEqual(kills, ['SIGTERM', 'SIGKILL'], reason);
	}
});

function inspect(format: 'mp4' | 'webm', result: ExternalFfmpegProcessResult): Promise<void> {
	return inspectWithRunner(format, runner(() => result));
}

function inspectWithRunner(
	format: 'mp4' | 'webm',
	runnerValue: ExternalFfmpegProcessRunner,
	outputPath = `${WORKING_DIRECTORY}/canary.${format}`,
): Promise<void> {
	return inspectExternalFfmpegVideoCanaryOutput({
		format, ffprobePath: FFPROBE_PATH, outputPath,
		workingDirectory: WORKING_DIRECTORY, runner: runnerValue,
	});
}

function runner(
	run: (request: ExternalFfmpegProcessRequest) => ExternalFfmpegProcessResult,
): ExternalFfmpegProcessRunner {
	return Object.freeze({
		run: async (request: ExternalFfmpegProcessRequest): Promise<ExternalFfmpegProcessResult> => run(request),
	});
}

function exited(stdout: string, exitCode = 0): ExternalFfmpegProcessResult {
	return Object.freeze({ status: 'exited', exitCode, stdout, stderr: '' });
}

function stream(index: number, codecType: string, codecName: string) {
	const common = { index, codec_type: codecType, codec_name: codecName };
	if (codecType === 'video') {
		return Object.freeze({ ...common, width: 16, height: 16, pix_fmt: 'yuv420p' });
	}
	if (codecType === 'audio') {
		return Object.freeze({ ...common, sample_rate: '48000', channels: 2 });
	}
	return Object.freeze(common);
}

type ProbeChild = ExternalFfmpegVideoChildProcess & EventEmitter & Readonly<{
	stdout: PassThrough;
	stderr: PassThrough;
}>;

function probeChild(kills: NodeJS.Signals[] = []): ProbeChild {
	const stdout = new PassThrough();
	const stderr = new PassThrough();
	return Object.assign(new EventEmitter(), {
		stdout, stderr, stdio: [null, stdout, stderr],
		kill: (signal: NodeJS.Signals) => { kills.push(signal); return true; },
	}) as unknown as ProbeChild;
}
