/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createDesktopAudioCodecRuntime,
	type DesktopAudioCodecRendererBridge,
} from '../src/common/editor/desktop-audio-codec-runtime.ts';
import { createDesktopAudioCodecCapabilityQuery } from '../src/common/editor/desktop-audio-codec-capabilities.ts';
import { encodeWav } from '../src/common/editor/wav.js';
import {
	createDesktopAudioCodecResult,
	type DesktopAudioCodecFormat,
	type DesktopAudioCodecRequest,
} from '../desktop/desktop-audio-codec-operation-contract.ts';
import type { FfmpegOutputSink } from '../src/common/editor/ffmpeg-output-stream.ts';

const FORMAT_CASES = Object.freeze([
	Object.freeze({ format: 'flac', settings: Object.freeze({ compressionLevel: 5 }), expected: Object.freeze({ compressionLevel: 5, bitDepth: 24 }) }),
	Object.freeze({ format: 'mp3', settings: Object.freeze({ bitRate: 192 }), expected: Object.freeze({ bitrateKbps: 192 }) }),
	Object.freeze({ format: 'ogg-vorbis', settings: Object.freeze({ quality: 6 }), expected: Object.freeze({ quality: 6 }) }),
	Object.freeze({ format: 'opus', settings: Object.freeze({ bitRate: 128 }), expected: Object.freeze({ bitrateKbps: 128 }) }),
	Object.freeze({ format: 'wavpack', settings: Object.freeze({ compressionLevel: 2 }), expected: Object.freeze({ compressionLevel: 2 }) }),
	Object.freeze({ format: 'mp2', settings: Object.freeze({ bitRate: 192 }), expected: Object.freeze({ bitrateKbps: 192 }) }),
	Object.freeze({ format: 'aac-m4a', settings: Object.freeze({ bitRate: 192 }), expected: Object.freeze({ bitrateKbps: 192 }) }),
] as const);

test('load is fail-closed until main admits exact desktop audio tuples', async () => {
	const runtime = createDesktopAudioCodecRuntime(successBridge());
	assert.equal(await runtime.load(), runtime);
	const capabilities = runtime.capabilities();
	assert.equal(capabilities.ffmpegAvailable, false);
	assert.equal(capabilities.profileId, 'desktop-main-audio-codecs');
	for (const { format } of FORMAT_CASES) assert.equal(capabilities.formats[format]?.available, false, format);
	assert.equal(capabilities.formats['custom-ffmpeg']?.available, false);
	assert.equal(Object.isFrozen(capabilities), true);
	const exact = await runtime.desktopAudioCodecCapabilities(createDesktopAudioCodecCapabilityQuery({
		sampleRate: 48_000, channelCount: 2,
	}));
	assert.equal(exact.capabilities.every(({ available }) => available), true);
	runtime.dispose();
	await assert.rejects(() => runtime.load(), /disposed/iu);
});

test('all seven legacy encode calls stage interleaved f32le and map normalized settings', async () => {
	const requests: DesktopAudioCodecRequest[] = [];
	const bridge = successBridge((request) => {
		requests.push(request);
		return Uint8Array.of(1, 2, 3, requests.length);
	});
	const runtime = createDesktopAudioCodecRuntime(bridge);
	const wav = encodeWav([
		Float32Array.of(0.25, 0.5),
		Float32Array.of(-0.25, -0.5),
	], { sampleRate: 48_000, bitDepth: 32, float: true });
	for (const fixture of FORMAT_CASES) {
		const encoded = await runtime.encode(wav, fixture.format, {
			...fixture.settings, sampleRate: 48_000, maximumOutputBytes: 4_096,
		});
		assert.equal(encoded.extension, extension(fixture.format));
		assert.equal(encoded.bytes.at(-1), requests.length);
	}
	assert.equal(requests.length, FORMAT_CASES.length);
	for (const [index, fixture] of FORMAT_CASES.entries()) {
		const request = requests[index];
		assert.ok(request);
		assert.equal(request.operation, 'audio-encode');
		assert.equal(request.format, fixture.format);
		assert.deepEqual(request.settings, fixture.expected);
		assert.equal(request.sampleRate, 48_000);
		assert.equal(request.channelCount, 2);
		assert.match(request.requestId ?? '', /^desktop-audio-[a-f0-9]{32}$/u);
		assert.deepEqual(readF32(request.input), [0.25, -0.25, 0.5, -0.5]);
	}
});

test('an unavailable exact tuple refuses before the operation bridge executes', async () => {
	let executions = 0;
	const runtime = createDesktopAudioCodecRuntime({
		capabilities: (query) => ({
			schemaVersion: 1,
			capabilities: query.operations.map((operation) => ({
				...operation, available: false, provider: null,
				reason: 'configure-external-ffmpeg',
			})),
		}),
		execute() { executions += 1; throw new Error('must not execute'); },
		cancel() {},
	});
	const wav = encodeWav([Float32Array.of(0)], { sampleRate: 48_000, bitDepth: 32, float: true });
	await assert.rejects(
		() => runtime.encode(wav, 'opus', { bitRate: 128 }),
		/Preferences > General/iu,
	);
	await assert.rejects(
		() => runtime.decode(new File([Uint8Array.of(1)], 'project.flac'), { sampleRate: 48_000 }),
		/Preferences > General/iu,
	);
	assert.equal(executions, 0);
});

test('ordinary titled-project metadata is intentionally dropped by the closed broker request', async () => {
	const requests: DesktopAudioCodecRequest[] = [];
	const runtime = createDesktopAudioCodecRuntime(successBridge((request) => {
		requests.push(request);
		return Uint8Array.of(1);
	}));
	const wav = encodeWav([Float32Array.of(0)], { sampleRate: 48_000, bitDepth: 32, float: true });
	await runtime.encode(wav, 'flac', {
		compressionLevel: 5,
		metadata: { title: 'Named Project' },
	});
	assert.deepEqual(requests[0]?.settings, { compressionLevel: 5, bitDepth: 24 });
	assert.equal(Object.hasOwn(requests[0] ?? {}, 'metadata'), false);
});

test('integer staged WAVs reuse the WAV reader and multichannel open formats retain channel order', async () => {
	const requests: DesktopAudioCodecRequest[] = [];
	const runtime = createDesktopAudioCodecRuntime(successBridge((request) => {
		requests.push(request);
		return Uint8Array.of(9);
	}));
	const integerWav = encodeWav([
		Float32Array.of(0.5, -0.5),
		Float32Array.of(0.25, -0.25),
	], { sampleRate: 48_000, bitDepth: 16, float: false, dither: false });
	await runtime.encode(integerWav, 'flac', { compressionLevel: 5 });
	assert.deepEqual(readF32(requests[0]?.input ?? new Uint8Array()), [0.5, 0.25, -0.5, -0.25]);

	const channels = Array.from({ length: 4 }, (_, channel) => Float32Array.of(channel / 8, (channel + 4) / 8));
	const multichannel = new Blob([Uint8Array.from(encodeWav(channels, {
		sampleRate: 48_000, bitDepth: 32, float: true,
	}))], { type: 'audio/wav' });
	await runtime.encodeFile(multichannel, 'aac-m4a', { bitRate: 192 });
	assert.equal(requests[1]?.channelCount, 4);
	assert.deepEqual(readF32(requests[1]?.input ?? new Uint8Array()), [
		0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875,
	]);
	await assert.rejects(
		() => runtime.encodeFile(multichannel, 'mp3', { bitRate: 192 }),
		/at most 2 output channels|channel count/iu,
	);
	assert.equal(requests.length, 2);
});

test('native FLAC STREAMINFO supplies decode geometry instead of project defaults', async () => {
	const requests: DesktopAudioCodecRequest[] = [];
	const runtime = createDesktopAudioCodecRuntime(successBridge((request) => {
		requests.push(request);
		return new Uint8Array(Float32Array.of(0.25).buffer);
	}));
	const decoded = await runtime.decode(new File([flacStreamInfo(96_000, 1, 1)], 'mono.flac'));
	assert.equal(requests[0]?.operation, 'audio-decode');
	assert.equal(requests[0]?.sampleRate, 96_000);
	assert.equal(requests[0]?.channelCount, 1);
	assert.equal(decoded.sampleRate, 96_000);
	assert.equal(decoded.channels.length, 1);
	assert.equal(decoded.frameCount, 1);
});

test('decode infers all seven file formats and converts exact interleaved results to planar channels', async () => {
	const formats: DesktopAudioCodecFormat[] = [];
	const runtime = createDesktopAudioCodecRuntime(successBridge((request) => {
		formats.push(request.format);
		return interleavedBytes([1, 10, 2, 20]);
	}));
	for (const [name, format] of [
		['track.flac', 'flac'], ['track.mp3', 'mp3'], ['track.ogg', 'ogg-vorbis'],
		['track.opus', 'opus'], ['track.wv', 'wavpack'], ['track.mp2', 'mp2'],
		['track.m4a', 'aac-m4a'],
	] as const) {
		const decoded = await runtime.decode(new File([Uint8Array.of(1, 2, 3)], name), {
			sampleRate: 48_000, channelCount: 2, maximumOutputBytes: 64,
		});
		assert.equal(decoded.sampleRate, 48_000);
		assert.equal(decoded.frameCount, 2);
		assert.deepEqual(decoded.channels.map((channel) => [...channel]), [[1, 2], [10, 20]]);
		assert.equal(formats.at(-1), format);
	}
	await assert.rejects(
		() => runtime.decode(new Blob([Uint8Array.of(1, 2, 3)]), { sampleRate: 48_000 }),
		/cannot determine/iu,
	);
});

test('encoded bridge bytes stream to the existing sink in chunks no larger than 1 MiB', async () => {
	const outputBytes = new Uint8Array(2 * 1_024 * 1_024 + 17).fill(7);
	const runtime = createDesktopAudioCodecRuntime(successBridge(() => outputBytes));
	const sink = collectingSink();
	const wav = new Blob([Uint8Array.from(encodeWav([Float32Array.of(0, 0)], {
		sampleRate: 48_000, bitDepth: 32, float: true,
	}))]);
	const streamed = await runtime.encodeFileToSink(wav, 'opus', sink, {
		bitRate: 128, maximumOutputBytes: outputBytes.byteLength,
	});
	assert.deepEqual(sink.chunks.map(({ byteLength }) => byteLength), [1_024 * 1_024, 1_024 * 1_024, 17]);
	assert.equal(streamed.byteLength, outputBytes.byteLength);
	assert.equal(streamed.chunkCount, 3);
	assert.equal(streamed.output, 'sealed');
	assert.equal(sink.opened, outputBytes.byteLength);
	assert.equal(sink.aborted, null);
});

test('AbortSignal cancellation uses only the opaque active request ID', async () => {
	const captured: { request: DesktopAudioCodecRequest | null; cancelled: string[] } = {
		request: null, cancelled: [],
	};
	let invoked!: () => void;
	const started = new Promise<void>((resolve) => { invoked = resolve; });
	const bridge: DesktopAudioCodecRendererBridge = {
		capabilities: admittedCapabilities,
		execute(request) {
			captured.request = request;
			invoked();
			return new Promise(() => {});
		},
		cancel(requestId) { captured.cancelled.push(requestId); },
	};
	const runtime = createDesktopAudioCodecRuntime(bridge);
	const controller = new AbortController();
	const pending = runtime.decode(new File([Uint8Array.of(1)], 'track.flac'), {
		sampleRate: 48_000, signal: controller.signal,
	});
	await started;
	controller.abort(new DOMException('cancel renderer decode', 'AbortError'));
	await assert.rejects(() => pending, /cancel renderer decode/iu);
	assert.deepEqual(captured.cancelled, [captured.request?.requestId]);
	assert.match(captured.cancelled[0] ?? '', /^desktop-audio-[a-f0-9]{32}$/u);
});

test('dispose cancels active work and custom FFmpeg and video methods stay closed', async () => {
	const cancelled: string[] = [];
	const capture: { request: DesktopAudioCodecRequest | null } = { request: null };
	let invoked!: () => void;
	const started = new Promise<void>((resolve) => { invoked = resolve; });
	const runtime = createDesktopAudioCodecRuntime({
		capabilities: admittedCapabilities,
		execute(request) { capture.request = request; invoked(); return new Promise(() => {}); },
		cancel(requestId) { cancelled.push(requestId); },
	});
	const pending = runtime.decode(new File([Uint8Array.of(1)], 'track.flac'), { sampleRate: 48_000 });
	await started;
	runtime.dispose();
	await assert.rejects(() => pending, /disposed/iu);
	assert.deepEqual(cancelled, [capture.request?.requestId]);

	const closed = createDesktopAudioCodecRuntime(successBridge());
	const wav = encodeWav([Float32Array.of(0)], { sampleRate: 48_000, bitDepth: 32, float: true });
	await assert.rejects(() => closed.encode(wav, 'custom-ffmpeg', {}), /custom FFmpeg/iu);
	await assert.rejects(() => closed.encodeVideo({}, null, {}, {}), /video/iu);
	await assert.rejects(() => closed.probeVideoTiming(new Blob()), /video/iu);
});

test('result correlation rejects malformed or cross-request bridge evidence', async () => {
	const runtime = createDesktopAudioCodecRuntime({
		capabilities: admittedCapabilities,
		execute(request) {
			return {
				...createDesktopAudioCodecResult(request, Uint8Array.of(1)),
				requestId: 'another-request',
			};
		},
		cancel() {},
	});
	const wav = encodeWav([Float32Array.of(0)], { sampleRate: 48_000, bitDepth: 32, float: true });
	await assert.rejects(() => runtime.encode(wav, 'flac', { compressionLevel: 5 }), /request ID/iu);
});

function successBridge(
	output: (request: DesktopAudioCodecRequest) => Uint8Array = () => Uint8Array.of(1),
): DesktopAudioCodecRendererBridge {
	return {
		capabilities: admittedCapabilities,
		execute(request) { return createDesktopAudioCodecResult(request, output(request)); },
		cancel() {},
	};
}

function admittedCapabilities(query: Parameters<DesktopAudioCodecRendererBridge['capabilities']>[0]) {
	return {
		schemaVersion: 1 as const,
		capabilities: query.operations.map((operation) => ({
			...operation, available: true as const, provider: 'external-ffmpeg' as const, reason: null,
		})),
	};
}

function extension(format: DesktopAudioCodecFormat): string {
	return `.${format === 'ogg-vorbis' ? 'ogg' : format === 'wavpack' ? 'wv' : format === 'aac-m4a' ? 'm4a' : format}`;
}

function readF32(bytes: Uint8Array): number[] {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	return Array.from({ length: bytes.byteLength / 4 }, (_, index) => view.getFloat32(index * 4, true));
}

function interleavedBytes(samples: readonly number[]): Uint8Array {
	const bytes = new Uint8Array(samples.length * 4);
	const view = new DataView(bytes.buffer);
	for (const [index, sample] of samples.entries()) view.setFloat32(index * 4, sample, true);
	return bytes;
}

function flacStreamInfo(
	sampleRate: number, channelCount: number, frameCount: number,
): Uint8Array<ArrayBuffer> {
	const bytes = new Uint8Array(43);
	bytes.set([0x66, 0x4c, 0x61, 0x43, 0x80, 0, 0, 34]);
	const view = new DataView(bytes.buffer);
	view.setUint16(8, 16, false);
	view.setUint16(10, 16, false);
	const packed = (BigInt(sampleRate) << 44n) | (BigInt(channelCount - 1) << 41n)
		| (23n << 36n) | BigInt(frameCount);
	view.setBigUint64(18, packed, false);
	bytes[42] = 0xff;
	return bytes;
}

function collectingSink(): FfmpegOutputSink<string> & {
	readonly chunks: Uint8Array[];
	opened: number | null;
	aborted: unknown;
} {
	const chunks: Uint8Array[] = [];
	return {
		chunks,
		opened: null,
		aborted: null,
		async open(exactByteLength) { this.opened = exactByteLength; },
		async write(chunk) { chunks.push(new Uint8Array(chunk)); },
		async close() { return 'sealed'; },
		async abort(reason) { this.aborted = reason; },
	};
}
