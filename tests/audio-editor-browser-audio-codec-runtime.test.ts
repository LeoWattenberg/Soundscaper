/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	BrowserCodecRuntimeDisposedError,
	BrowserCodecRuntimeUnsupportedError,
	createBrowserAudioCodecRuntime,
	type BrowserDedicatedAudioCodecClient,
} from '../src/common/editor/browser-audio-codec-runtime.ts';
import type { DedicatedAudioEncodeRequest } from '../src/common/editor/browser-dedicated-audio-codec.ts';
import type { BrowserAacEncodeRequest } from '../src/common/editor/browser-webcodecs-aac.ts';
import type { FfmpegOutputSink } from '../src/common/editor/ffmpeg-output-stream.ts';
import { encodeWav } from '../src/common/editor/wav.js';

test('browser audio runtime maps staged WAV PCM into a dedicated file-producing codec', async () => {
	const requests: DedicatedAudioEncodeRequest[] = [];
	const client = clientFixture(requests, Uint8Array.of(0x66, 0x4c, 0x61, 0x43, 1, 2));
	const runtime = createBrowserAudioCodecRuntime({ codecClient: client, webCodecsAac: false });
	const wav = encodeWav([
		Float32Array.of(0.25, 0.5),
		Float32Array.of(-0.25, -0.5),
	], { sampleRate: 48_000, bitDepth: 32, float: true });

	assert.equal(await runtime.load(), runtime);
	const encoded = await runtime.encode(wav, 'flac', {
		sampleRate: 48_000,
		inputChannelCount: 2,
		channelMapping: 'mono',
		compressionLevel: 5,
		sampleFormat: 'int24',
		maximumOutputBytes: 1_024,
	});

	assert.equal(encoded.extension, '.flac');
	assert.equal(encoded.mimeType, 'audio/flac');
	assert.deepEqual([...encoded.bytes], [0x66, 0x4c, 0x61, 0x43, 1, 2]);
	assert.equal(requests.length, 1);
	assert.equal(requests[0]?.format, 'flac');
	assert.equal(requests[0]?.sampleRate, 48_000);
	assert.equal(requests[0]?.channelCount, 1);
	assert.equal(requests[0]?.frameCount, 2);
	assert.deepEqual(requests[0]?.settings, { compressionLevel: 5 });
	assert.deepEqual(readF32(requests[0]!.input), [0, 0]);

	const capabilities = runtime.capabilities();
	assert.equal(capabilities.profileId, 'browser-dedicated-codecs-v1');
	assert.equal(capabilities.ffmpegAvailable, false);
	assert.equal(capabilities.formats.flac.available, true);
	assert.equal(capabilities.formats['aac-m4a'].available, false);
	assert.equal(capabilities.formats['custom-ffmpeg'].available, false);
	runtime.dispose();
	assert.equal(client.disposed, true);
});

test('browser audio runtime generates a direct destination from dedicated codec bytes', async () => {
	const output = Uint8Array.from({ length: 13 }, (_value, index) => index);
	const client = clientFixture([], output);
	const runtime = createBrowserAudioCodecRuntime({ codecClient: client, webCodecsAac: false });
	const wav = new Blob([Uint8Array.from(encodeWav([
		Float32Array.of(0, 0),
	], { sampleRate: 48_000, bitDepth: 32, float: true }))], { type: 'audio/wav' });
	const events: unknown[] = [];
	const sink: FfmpegOutputSink<string> = {
		async open(byteLength) { events.push(['open', byteLength]); },
		async write(bytes) { events.push(['write', [...bytes]]); },
		async close() { events.push(['close']); return 'published'; },
		async abort(reason) { events.push(['abort', reason]); },
	};

	const result = await runtime.encodeFileToSink(wav, 'mp3', sink, {
		bitRate: 192,
		maximumOutputBytes: 1_024,
		maximumOutputChunkBytes: 5,
	});

	assert.equal(result.output, 'published');
	assert.equal(result.byteLength, output.byteLength);
	assert.equal(result.chunkCount, 3);
	assert.equal(result.extension, '.mp3');
	assert.deepEqual(events, [
		['open', 13],
		['write', [0, 1, 2, 3, 4]],
		['write', [5, 6, 7, 8, 9]],
		['write', [10, 11, 12]],
		['close'],
	]);
});

test('disposing the browser audio runtime cancels an active destination stream', async () => {
	const output = Uint8Array.from({ length: 13 }, (_value, index) => index);
	const client = clientFixture([], output);
	const runtime = createBrowserAudioCodecRuntime({ codecClient: client, webCodecsAac: false });
	const wav = new Blob([Uint8Array.from(encodeWav([
		Float32Array.of(0, 0),
	], { sampleRate: 48_000, bitDepth: 32, float: true }))], { type: 'audio/wav' });
	let closeCalls = 0;
	let abortReason: unknown;
	const sink: FfmpegOutputSink<string> = {
		async open() {},
		async write() { runtime.dispose(); },
		async close() { closeCalls += 1; return 'must-not-publish'; },
		async abort(reason) { abortReason = reason; },
	};

	await assert.rejects(
		() => runtime.encodeFileToSink(wav, 'mp3', sink, {
			bitRate: 192,
			maximumOutputBytes: 1_024,
			maximumOutputChunkBytes: 5,
		}),
		(error) => error instanceof BrowserCodecRuntimeDisposedError,
	);
	assert.equal(closeCalls, 0);
	assert.ok(abortReason instanceof BrowserCodecRuntimeDisposedError);
	assert.equal(client.disposed, true);
});

test('browser audio runtime routes AAC/M4A file generation to WebCodecs', async () => {
	const calls: unknown[] = [];
	const runtime = createBrowserAudioCodecRuntime({
		codecClient: clientFixture([], Uint8Array.of(1)),
		webCodecsAac: true,
		async encodeAac(request: unknown) {
			calls.push(request);
			return Uint8Array.of(0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70);
		},
	});
	const wav = encodeWav([
		Float32Array.of(0.25, 0.5),
		Float32Array.of(-0.25, -0.5),
	], { sampleRate: 48_000, bitDepth: 32, float: true });
	const output = await runtime.encode(wav, 'aac-m4a', {
		bitRate: 192,
		maximumOutputBytes: 1_024,
	});
	assert.equal(output.extension, '.m4a');
	assert.equal(output.mimeType, 'audio/mp4');
	assert.equal(calls.length, 1);
	const { signal, ...aacRequest } = calls[0] as BrowserAacEncodeRequest;
	assert.ok(signal instanceof AbortSignal);
	assert.deepEqual(aacRequest, {
		input: new Uint8Array(new Float32Array([0.25, -0.25, 0.5, -0.5]).buffer),
		frameCount: 2,
		channelCount: 2,
		sampleRate: 48_000,
		bitrate: 192_000,
		maximumOutputBytes: 1_024,
	});
});

test('browser audio runtime passes the live export signal into AAC file generation', async () => {
	const controller = new AbortController();
	let receivedSignal: AbortSignal | undefined;
	const runtime = createBrowserAudioCodecRuntime({
		codecClient: clientFixture([], Uint8Array.of(1)),
		webCodecsAac: true,
		async encodeAac(request) {
			receivedSignal = request.signal;
			return Uint8Array.of(0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70);
		},
	});
	const wav = encodeWav([
		Float32Array.of(0.25, 0.5),
		Float32Array.of(-0.25, -0.5),
	], { sampleRate: 48_000, bitDepth: 32, float: true });

	await runtime.encode(wav, 'aac-m4a', { bitRate: 192, signal: controller.signal });

	assert.ok(receivedSignal instanceof AbortSignal);
	const reason = new DOMException('caller canceled', 'AbortError');
	controller.abort(reason);
	assert.equal(receivedSignal.aborted, true);
	assert.equal(receivedSignal.reason, reason);
});

test('disposing the browser runtime actively cancels AAC file generation', async () => {
	let announceStart: (() => void) | undefined;
	const started = new Promise<void>((resolve) => { announceStart = resolve; });
	const runtime = createBrowserAudioCodecRuntime({
		codecClient: clientFixture([], Uint8Array.of(1)),
		webCodecsAac: true,
		encodeAac: async (request) => new Promise<Uint8Array>((_resolve, reject) => {
			announceStart?.();
			request.signal?.addEventListener('abort', () => reject(request.signal?.reason), { once: true });
		}),
	});
	const wav = encodeWav([
		Float32Array.of(0.25, 0.5),
	], { sampleRate: 48_000, bitDepth: 32, float: true });
	const encoding = runtime.encode(wav, 'aac-m4a', { bitRate: 192 });
	await started;
	runtime.dispose();
	await assert.rejects(encoding, (error) => (
		error instanceof Error && error.name === 'BrowserCodecRuntimeDisposedError'
	));
});

test('browser audio preflight proves the exact AAC tuple before render-sized work', async () => {
	const configurations: unknown[] = [];
	const runtime = createBrowserAudioCodecRuntime({
		codecClient: clientFixture([], Uint8Array.of(1)),
		webCodecsAac: true,
		audioEncoderProbe: {
			async isConfigSupported(configuration) {
				configurations.push(configuration);
				return { supported: true };
			},
		},
	});
	await runtime.preflightEncodeFile('aac-m4a', {
		frameCount: 48_000,
		sampleRate: 48_000,
		inputChannelCount: 2,
		channelMapping: 'stereo',
		bitRate: 192,
		metadata: { title: 'Complete M4A', year: '2026' },
	});
	assert.deepEqual(configurations, [{
		codec: 'mp4a.40.2', sampleRate: 48_000, numberOfChannels: 2, bitrate: 192_000,
	}]);
	await assert.rejects(() => runtime.preflightEncodeFile('aac-m4a', {
		frameCount: 48_000, sampleRate: 48_000, bitRate: 192,
		metadata: { copyright: 'unsupported atom' },
	}), /metadata fields: copyright/iu);
});

test('browser audio preflight refuses dedicated metadata and complete-file bounds', async () => {
	const runtime = createBrowserAudioCodecRuntime({
		codecClient: clientFixture([], Uint8Array.of(1)), webCodecsAac: false,
	});
	await assert.rejects(() => runtime.preflightEncodeFile('mp3', {
		frameCount: 48_000, sampleRate: 48_000, inputChannelCount: 2,
		bitRate: 192, metadata: { title: 'Not silently discarded' },
	}), /does not write metadata tags/iu);
	await assert.rejects(() => runtime.preflightEncodeFile('mp3', {
		frameCount: 8_388_609, sampleRate: 48_000, inputChannelCount: 1,
		bitRate: 192,
	}), /complete-file browser codec input bound/iu);
	await runtime.preflightEncodeFile('wav', { frameCount: 100 });
});

test('browser audio runtime refuses custom FFmpeg and omits unsupported operation capabilities', async () => {
	const runtime = createBrowserAudioCodecRuntime({ codecClient: clientFixture([], Uint8Array.of(1)), webCodecsAac: false });
	const wav = encodeWav([Float32Array.of(0)], { sampleRate: 48_000, bitDepth: 32, float: true });
	await assert.rejects(
		() => runtime.encode(wav, 'custom-ffmpeg'),
		(error) => error instanceof BrowserCodecRuntimeUnsupportedError
			&& error.code === 'BROWSER_CODEC_RUNTIME_UNSUPPORTED',
	);
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
});

function clientFixture(
	requests: DedicatedAudioEncodeRequest[],
	output: Uint8Array,
): BrowserDedicatedAudioCodecClient & { disposed: boolean } {
	return {
		disposed: false,
		async encode(request) {
			requests.push(request);
			return Uint8Array.from(output);
		},
		async decode() { throw new Error('decode was not expected'); },
		dispose() { this.disposed = true; },
	};
}

function readF32(bytes: Uint8Array): number[] {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	return Array.from({ length: bytes.byteLength / 4 }, (_value, index) => view.getFloat32(index * 4, true));
}
