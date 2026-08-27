/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createEditorCodecRuntime as createBrowserRuntime } from '../src/common/editor/editor-codec-runtime.ts';
import {
	DesktopCodecRuntimeUnavailableError,
	createEditorCodecRuntime as createDesktopRuntime,
} from '../src/common/editor/editor-codec-runtime.desktop.ts';
import {
	createDesktopAudioCodecResult,
	type DesktopAudioCodecRequest,
} from '../desktop/desktop-audio-codec-operation-contract.ts';
import type { DesktopAudioCodecCapabilityQuery } from '../desktop/desktop-audio-codec-capability-contract.ts';

test('browser codec composition uses dedicated codecs without a browser FFmpeg runtime', () => {
	const runtime = createBrowserRuntime({ idleTimeoutMs: false });
	assert.equal(typeof runtime.load, 'function');
	assert.equal(typeof runtime.decode, 'function');
	assert.equal(typeof runtime.encodeFileToSink, 'function');
	assert.equal(runtime.capabilities().profileId, 'browser-dedicated-codecs-v1');
	assert.equal(runtime.capabilities().ffmpegAvailable, false);
	assert.equal(runtime.capabilities().formats.mp3.available, true);
	assert.equal(runtime.capabilities().formats['custom-ffmpeg'].available, false);
	for (const operation of [
		'encodeVideo',
		'encodeVideoToSink',
		'probeVideoTiming',
		'conformVideoToCfr',
		'runVideoKeyframeEncoderOperation',
		'runTrimMediaOperation',
		'runProxyMediaOperation',
	] as const) {
		assert.equal(Object.hasOwn(runtime, operation), false, `${operation} must not advertise a missing capability`);
	}
	runtime.dispose();
});

test('desktop codec composition fails closed without a main-process operation bridge', async () => {
	const runtime = createDesktopRuntime();
	const capabilities = runtime.capabilities();
	const formats = capabilities.formats as Readonly<Record<string, Readonly<{ available: boolean }>>>;
	assert.equal(formats.wav?.available, true);
	assert.equal(formats.mp3?.available, false);
	await assert.rejects(
		() => runtime.load(),
		(error) => error instanceof DesktopCodecRuntimeUnavailableError
			&& error.code === 'DESKTOP_CODEC_RUNTIME_UNAVAILABLE',
	);
	await assert.rejects(() => runtime.decode(new Blob()), /desktop codec providers are unavailable/iu);
	assert.equal(runtime.dispose(), undefined);
});

test('desktop codec composition routes audio through file service while video stays closed', async () => {
	const requests: DesktopAudioCodecRequest[] = [];
	const cancelled: string[] = [];
	const runtime = createDesktopRuntime({
		fileService: {
			getDesktopAudioCodecCapabilities(query: DesktopAudioCodecCapabilityQuery) {
				return {
					schemaVersion: 2,
					capabilities: query.operations.map((operation) => ({
						...operation, available: true, provider: 'external-ffmpeg', reason: null,
					})),
				};
			},
			runDesktopAudioCodecOperation(request: DesktopAudioCodecRequest) {
				requests.push(request);
				return createDesktopAudioCodecResult(
					request, interleavedF32([0.25, -0.5]),
					{ sampleRate: 44_100, channelCount: 1, frameCount: 2 },
				);
			},
			cancelDesktopAudioCodecOperation(requestId: string) { cancelled.push(requestId); return true; },
		},
	});
	assert.equal(await runtime.load(), runtime);
	const decoded = await runtime.decode(new File([Uint8Array.of(1, 2, 3)], 'voice.flac'), {
		sampleRate: 48_000, channelCount: 1, maximumOutputBytes: 64,
	});
	assert.deepEqual(decoded.channels.map((channel) => [...channel]), [[0.25, -0.5]]);
	assert.equal(decoded.sampleRate, 44_100);
	assert.equal(requests.length, 1);
	assert.equal(requests[0]?.operation, 'audio-decode');
	assert.equal(requests[0]?.format, 'flac');
	assert.equal(requests[0]?.sampleRate, null);
	assert.equal(requests[0]?.channelCount, null);
	assert.deepEqual(cancelled, []);
	await assert.rejects(() => runtime.encodeVideo({}, null, {}, {}), /video/iu);
	await assert.rejects(() => runtime.runProxyMediaOperation({}), /video/iu);
	assert.equal(requests.length, 1, 'video operations must not reach the audio bridge');
	runtime.dispose();
});

test('advertised desktop video capability reaches the owner-scoped keyframe runner', async () => {
	const calls: string[] = [];
	const operationId = `desktop-video-${'1'.repeat(32)}`;
	const fileService = {
		getDesktopAudioCodecCapabilities(query: DesktopAudioCodecCapabilityQuery) {
			return { schemaVersion: 2, capabilities: query.operations.map((operation) => ({
				...operation, available: true, provider: 'external-ffmpeg', reason: null,
			})) };
		},
		runDesktopAudioCodecOperation() { throw new Error('audio was not requested'); },
		cancelDesktopAudioCodecOperation() { return true; },
		getDesktopVideoExportCapabilities() {
			return { schemaVersion: 1, formats: {
				mp4: { available: true, provider: 'external-ffmpeg', reason: null },
				webm: { available: false, provider: null, reason: 'unsupported' },
			} };
		},
		beginDesktopVideoCodecOperation() { calls.push('begin'); return { operationId }; },
		writeDesktopVideoCodecInput() { throw new Error('input was not requested'); },
		closeDesktopVideoCodecInput() { throw new Error('input was not requested'); },
		executeDesktopVideoCodecOperation() { throw new Error('execution was not requested'); },
		statDesktopVideoCodecOutput() { throw new Error('output was not requested'); },
		readDesktopVideoCodecOutput() { throw new Error('output was not requested'); },
		deleteDesktopVideoCodecOperation() { throw new Error('output was not requested'); },
		cancelDesktopVideoCodecOperation(id: string) { calls.push(`cancel:${id}`); return true; },
	};
	assert.equal((await fileService.getDesktopVideoExportCapabilities()).formats.mp4.available, true);
	const runtime = createDesktopRuntime({ fileService });
	assert.equal(await runtime.load(), runtime);
	const result = await runtime.runVideoKeyframeEncoderOperation(
		(lease: unknown) => { assert.ok(lease); calls.push('lease'); return 'reached'; },
		{
			desktopExternalFfmpeg: {
				plan: {
					schemaVersion: 1, format: 'mp4', quality: 'balanced', width: 2, height: 2,
					frameRate: { num: 1, den: 1 }, frameCount: 2, sampleRate: 48_000,
					durationFrames: 96_000, videoInputBytes: 32, audioInputBytes: null,
					ringCapacityBytes: 4_096, audioRingCapacityBytes: null,
					maximumOutputBytes: 1024 * 1024,
				},
				videoInputPath: '/renderer-local-input.rgba', outputPath: '/renderer-local-output.mp4',
				ffmpegArguments: ['fixed-renderer-local-argv'],
			},
		},
	);
	assert.equal(result, 'reached');
	assert.deepEqual(calls, ['begin', 'lease', `cancel:${operationId}`]);
	runtime.dispose();
});

function interleavedF32(samples: readonly number[]): Uint8Array {
	const bytes = new Uint8Array(samples.length * Float32Array.BYTES_PER_ELEMENT);
	const view = new DataView(bytes.buffer);
	for (const [index, sample] of samples.entries()) view.setFloat32(index * 4, sample, true);
	return bytes;
}
