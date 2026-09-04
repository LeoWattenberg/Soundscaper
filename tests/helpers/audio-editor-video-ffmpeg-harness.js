/* SPDX-License-Identifier: AGPL-3.0-only */

// Video plan fixtures the FFmpeg suites share: the plans each graph is built from
// and the mock runtime they are executed against. Split out of
// audio-editor-video-ffmpeg.test.js so its suites can sit in separate files.

import { register } from 'node:module';
import test from 'node:test';

export const ffmpegModuleUrl = `data:text/javascript,${encodeURIComponent(`
	export const FFFSType = { WORKERFS: 'WORKERFS' };
	export class FFmpeg {
		constructor() {
			return new globalThis.__soundscaperVideoFfmpegTestRuntime();
		}
	}

`)}`;

export const ffmpegLoader = `
	export async function resolve(specifier, context, nextResolve) {
		if (specifier === '@ffmpeg/ffmpeg') {
			return { url: ${JSON.stringify(ffmpegModuleUrl)}, shortCircuit: true };
		}
		return nextResolve(specifier, context);
	}

`;

register(`data:text/javascript,${encodeURIComponent(ffmpegLoader)}`, import.meta.url);

export const {
	FfmpegVideoEncodingError,
	createEditorFfmpeg,
	encoderArgs,
} = await import('../../src/common/editor/ffmpeg.js');

export const { buildVideoFfmpegArgs } = await import('../../src/common/editor/video-ffmpeg.js');

export const originalTestRuntime = globalThis.__soundscaperVideoFfmpegTestRuntime;

/**
 * Register the mock video FFmpeg runtime for the calling test file, restoring
 * whatever runtime was installed before it when the file finishes.
 */
export function useMockVideoFfmpegRuntime() {
	test.beforeEach(() => {
		MockVideoFfmpegRuntime.reset();
		globalThis.__soundscaperVideoFfmpegTestRuntime = MockVideoFfmpegRuntime;
	});

	test.afterEach(() => {
		if (originalTestRuntime === undefined) delete globalThis.__soundscaperVideoFfmpegTestRuntime;
		else globalThis.__soundscaperVideoFfmpegTestRuntime = originalTestRuntime;
	});
}
export class MockVideoFfmpegRuntime {
	static instances = [];
	static nextExitCode = 0;
	static pauseExec = false;

	static reset() {
		this.instances = [];
		this.nextExitCode = 0;
		this.pauseExec = false;
	}

	constructor() {
		this.loaded = false;
		this.mountCalls = [];
		this.execCalls = [];
		this.unmountCalls = [];
		this.deleteDirCalls = [];
		this.deleteFileCalls = [];
		this.terminateCalls = 0;
		this.pendingExec = [];
		MockVideoFfmpegRuntime.instances.push(this);
	}

	on() {}

	off() {}

	async load() {
		this.loaded = true;
	}

	async createDir(path) {
		this.createdDir = path;
	}

	async mount(type, options, mountPoint) {
		this.mountCalls.push({ type, options, mountPoint });
	}

	async exec(args, timeout, options) {
		this.execCalls.push({ args, timeout, options });
		if (MockVideoFfmpegRuntime.pauseExec) {
			return new Promise((resolve, reject) => this.pendingExec.push({ resolve, reject }));
		}
		return MockVideoFfmpegRuntime.nextExitCode;
	}

	// Whole-byte browser routes admit the final file before materializing it.
	async readFile() { return Uint8Array.of(9, 8, 7); }
	async statFile() { return { size: 3 }; }

	async deleteFile(path) {
		this.deleteFileCalls.push(path);
	}

	async unmount(path) {
		this.unmountCalls.push(path);
	}

	async deleteDir(path) {
		this.deleteDirCalls.push(path);
	}

	terminate() {
		this.terminateCalls += 1;
		this.loaded = false;
		for (const pending of this.pendingExec.splice(0)) pending.reject(new Error('FFmpeg runtime terminated.'));
	}
}

export async function waitFor(predicate) {
	const deadline = performance.now() + 5_000;
	while (performance.now() < deadline) {
		if (predicate()) return;
		await new Promise((resolve) => setImmediate(resolve));
	}
	throw new Error('Timed out waiting for the video FFmpeg runtime fixture.');
}

export function presentedMp4Plan() {
	const plan = reusedSourceMp4Plan();
	plan.version = 5;
	plan.inputs[0].presentation = {
		autorotate: true,
		sampleAspect: { num: 2, den: 1 },
		decodedWidth: 24,
		decodedHeight: 32,
		scaledWidth: 24,
		scaledHeight: 64,
	};
	return plan;
}

export function webmPlan() {
	return {
		version: 1,
		format: 'webm',
		container: 'webm',
		extension: 'webm',
		mimeType: 'video/webm',
		durationSeconds: 2.25,
		canvas: {
			width: 640,
			height: 360,
			frameRate: 24,
			pixelFormat: 'yuv420p',
			backgroundColor: '#112233',
		},
		codecs: {
			video: 'vp9',
			videoEncoder: 'libvpx-vp9',
			audio: 'opus',
			audioEncoder: 'libopus',
			pixelFormat: 'yuv420p',
		},
		inputs: [
			{ kind: 'video-source', inputIndex: 0, sourceId: 'source-a', mimeType: 'video/mp4' },
			{ kind: 'video-source', inputIndex: 1, sourceId: 'source-b', mimeType: 'video/webm' },
			{ kind: 'staged-audio-mix', inputIndex: 2, fileName: 'audio-mix.wav' },
		],
		segments: [
			{
				kind: 'video',
				inputIndex: 0,
				sourceId: 'source-a',
				sourceStartTimeSeconds: 0.5,
				sourceEndTimeSeconds: 2.5,
				playbackRate: 2,
				durationSeconds: 1,
			},
			{ kind: 'black', color: '#112233', durationSeconds: 0.25 },
			{
				kind: 'video',
				inputIndex: 1,
				sourceId: 'source-b',
				sourceStartTimeSeconds: 0,
				sourceEndTimeSeconds: 1,
				playbackRate: 1,
				durationSeconds: 1,
			},
		],
		filterPlan: { audio: { strategy: 'staged-mix', inputIndex: 2 } },
	};
}

export function layeredWebmPlan() {
	return {
		version: 2,
		format: 'webm',
		container: 'webm',
		extension: 'webm',
		mimeType: 'video/webm',
		durationSeconds: 1.5,
		canvas: {
			width: 640,
			height: 360,
			frameRate: 24,
			pixelFormat: 'yuv420p',
			backgroundColor: '#112233',
		},
		codecs: {
			video: 'vp9',
			videoEncoder: 'libvpx-vp9',
			audio: 'opus',
			audioEncoder: 'libopus',
			pixelFormat: 'yuv420p',
		},
		inputs: [
			{ kind: 'video-source', inputIndex: 0, sourceId: 'source-a', mimeType: 'video/mp4' },
			{ kind: 'video-source', inputIndex: 1, sourceId: 'source-b', mimeType: 'video/webm' },
			{ kind: 'video-source', inputIndex: 2, sourceId: 'source-c', mimeType: 'video/mp4' },
			{ kind: 'staged-audio-mix', inputIndex: 3, fileName: 'audio-mix.wav' },
		],
		intervals: [
			{
				kind: 'composition',
				durationSeconds: 1,
				layers: [
					{
						trackId: 'lower-track',
						clips: [{
							role: 'single',
							inputIndex: 0,
							sourceId: 'source-a',
							sourceStartTimeSeconds: 1,
							sourceEndTimeSeconds: 2,
							playbackRate: 1,
							opacityStart: 1,
							opacityEnd: 1,
						}],
					},
					{
						trackId: 'top-track',
						clips: [
							{
								role: 'outgoing',
								inputIndex: 1,
								sourceId: 'source-b',
								sourceStartTimeSeconds: 2.5,
								sourceEndTimeSeconds: 3.5,
								playbackRate: 1,
								opacityStart: 0.75,
								opacityEnd: 0.25,
							},
							{
								role: 'incoming',
								inputIndex: 2,
								sourceId: 'source-c',
								sourceStartTimeSeconds: 0.5,
								sourceEndTimeSeconds: 2.5,
								playbackRate: 2,
								opacityStart: 0.25,
								opacityEnd: 0.75,
							},
						],
					},
				],
			},
			{
				kind: 'black',
				color: '#112233',
				durationSeconds: 0.5,
				layers: [],
			},
		],
		filterPlan: { audio: { strategy: 'staged-mix', inputIndex: 3 } },
	};
}

export function reusedSourceMp4Plan() {
	return {
		version: 2,
		format: 'mp4',
		container: 'mp4',
		extension: 'mp4',
		mimeType: 'video/mp4',
		durationSeconds: 2,
		canvas: {
			width: 320,
			height: 180,
			frameRate: 30,
			pixelFormat: 'yuv420p',
			backgroundColor: 'black',
		},
		codecs: {
			video: 'h264',
			videoEncoder: 'libx264',
			audio: null,
			audioEncoder: null,
			pixelFormat: 'yuv420p',
		},
		inputs: [
			{ kind: 'video-source', inputIndex: 0, sourceId: 'shared', mimeType: 'video/mp4' },
		],
		intervals: [
			{
				kind: 'composition',
				durationSeconds: 1,
				layers: [{
					trackId: 'video-track',
					clips: [
						{
							role: 'outgoing',
							inputIndex: 0,
							sourceId: 'shared',
							sourceStartTimeSeconds: 0,
							sourceEndTimeSeconds: 1,
							playbackRate: 1,
							opacityStart: 1,
							opacityEnd: 0,
						},
						{
							role: 'incoming',
							inputIndex: 0,
							sourceId: 'shared',
							sourceStartTimeSeconds: 1,
							sourceEndTimeSeconds: 2,
							playbackRate: 1,
							opacityStart: 0,
							opacityEnd: 1,
						},
					],
				}],
			},
			{
				kind: 'composition',
				durationSeconds: 1,
				layers: [{
					trackId: 'video-track',
					clips: [{
						role: 'single',
						inputIndex: 0,
						sourceId: 'shared',
						sourceStartTimeSeconds: 2,
						sourceEndTimeSeconds: 3,
						playbackRate: 1,
						opacityStart: 1,
						opacityEnd: 1,
					}],
				}],
			},
		],
		filterPlan: { audio: { strategy: 'none' } },
	};
}

export function silentMp4Plan() {
	return {
		version: 1,
		format: 'mp4',
		container: 'mp4',
		extension: 'mp4',
		mimeType: 'video/mp4',
		durationSeconds: 5,
		canvas: {
			width: 1_280,
			height: 720,
			frameRate: 30,
			pixelFormat: 'yuv420p',
			backgroundColor: 'black',
		},
		codecs: {
			video: 'h264',
			videoEncoder: 'libx264',
			audio: null,
			audioEncoder: null,
			pixelFormat: 'yuv420p',
		},
		inputs: [],
		segments: [
			{ kind: 'black', color: 'black', durationSeconds: 5 },
		],
		filterPlan: { audio: { strategy: 'none' } },
	};
}

export function videoEffect(id, type, params, enabled = true) {
	return { id, type, enabled, params };
}
