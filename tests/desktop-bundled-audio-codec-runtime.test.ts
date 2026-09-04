/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createBundledDesktopAudioCodecRuntime } from '../desktop/bundled-audio-codec-runtime.ts';
import { loadBundledFlacAudioCodecRuntime } from '../desktop/bundled-flac-audio-codec-runtime.ts';
import { loadBundledLameAudioCodecRuntime } from '../desktop/bundled-lame-audio-codec-runtime.ts';
import { loadBundledMpg123AudioCodecRuntime } from '../desktop/bundled-mpg123-audio-codec-runtime.ts';
import { loadBundledOpusAudioCodecRuntime } from '../desktop/bundled-opus-audio-codec-runtime.ts';
import { loadBundledTwolameAudioCodecRuntime } from '../desktop/bundled-twolame-audio-codec-runtime.ts';
import { loadBundledVorbisAudioCodecRuntime } from '../desktop/bundled-vorbis-audio-codec-runtime.ts';
import { loadBundledWavPackAudioCodecRuntime } from '../desktop/bundled-wavpack-audio-codec-runtime.ts';
import {
	createDesktopAudioCodecBroker,
	deriveDesktopAudioCodecOperation,
	type DesktopAudioCodecProviderRuntime,
} from '../desktop/desktop-audio-codec-broker.ts';
import type { DesktopAudioCodecRequest } from '../desktop/desktop-audio-codec-operation-contract.ts';
import type {
	DesktopCodecOperationReceipt,
	DesktopCodecProvider,
	DesktopCodecProviderKind,
} from '../src/common/editor/desktop-codec-coordinator.ts';
import { testMpegAudioStream } from './helpers/mpeg-audio-fixture.ts';

test('the composite exposes one bundled tier and delegates every reviewed audio runtime', async () => {
	const flac = await loadBundledFlacAudioCodecRuntime({ target: 'linux-x64' });
	const lame = await loadBundledLameAudioCodecRuntime({ target: 'linux-x64' });
	const mpg123 = await loadBundledMpg123AudioCodecRuntime({ target: 'linux-x64' });
	const opus = await loadBundledOpusAudioCodecRuntime({ target: 'linux-x64' });
	const twolame = await loadBundledTwolameAudioCodecRuntime({ target: 'linux-x64' });
	const wavpack = await loadBundledWavPackAudioCodecRuntime({ target: 'linux-x64' });
	const vorbis = await loadBundledVorbisAudioCodecRuntime({ target: 'linux-x64' });
	assert.ok(flac);
	assert.ok(lame);
	assert.ok(mpg123);
	assert.ok(opus);
	assert.ok(twolame);
	assert.ok(wavpack);
	assert.ok(vorbis);
	const runtime = createBundledDesktopAudioCodecRuntime({
		target: 'linux-x64', runtimes: [wavpack, flac, opus, mpg123, lame, vorbis, twolame],
	});
	assert.equal(runtime.provider.kind, 'bundled');
	assert.equal(runtime.provider.implementation, 'soundscaper-reviewed-audio-codecs');
	assert.match(runtime.provider.capabilityGeneration, /libflac/u);
	assert.match(runtime.provider.capabilityGeneration, /lame/u);
	assert.match(runtime.provider.capabilityGeneration, /mpg123/u);
	assert.match(runtime.provider.capabilityGeneration, /libopus-libogg/u);
	assert.match(runtime.provider.capabilityGeneration, /twolame/u);
	assert.match(runtime.provider.capabilityGeneration, /libvorbis-libogg/u);
	assert.match(runtime.provider.capabilityGeneration, /wavpack/u);

	const flacRequest: DesktopAudioCodecRequest = {
		operation: 'audio-encode', format: 'flac',
		input: new Uint8Array(Float32Array.of(0.25, -0.5).buffer),
		sampleRate: 48_000, channelCount: 2,
		settings: { compressionLevel: 5, bitDepth: 24 }, maximumOutputBytes: 64 * 1024,
	};
	const flacResult = await runtime.execute(flacRequest, {
		operation: deriveDesktopAudioCodecOperation(flacRequest),
	}) as { readonly status: string; readonly output?: Uint8Array };
	assert.equal(flacResult.status, 'executed');
	assert.equal(Buffer.from(flacResult.output?.subarray(0, 4) ?? []).toString('ascii'), 'fLaC');

	const wavpackRequest: DesktopAudioCodecRequest = {
		operation: 'audio-encode', format: 'wavpack',
		input: new Uint8Array(Float32Array.of(0.25, -0.5).buffer),
		sampleRate: 48_000, channelCount: 2,
		settings: { compressionLevel: 2 }, maximumOutputBytes: 64 * 1024,
	};
	const wavpackResult = await runtime.execute(wavpackRequest, {
		operation: deriveDesktopAudioCodecOperation(wavpackRequest),
	}) as { readonly status: string; readonly output?: Uint8Array };
	assert.equal(wavpackResult.status, 'executed');
	assert.equal(Buffer.from(wavpackResult.output?.subarray(0, 4) ?? []).toString('ascii'), 'wvpk');

	const opusRequest: DesktopAudioCodecRequest = {
		operation: 'audio-encode', format: 'opus',
		input: new Uint8Array(Float32Array.from({ length: 960 * 2 }, (_, index) => (
			Math.sin(index / 31) * 0.25
		)).buffer),
		sampleRate: 48_000, channelCount: 2,
		settings: { bitrateKbps: 128, vbrMode: 1 }, maximumOutputBytes: 64 * 1024,
	};
	const opusResult = await runtime.execute(opusRequest, {
		operation: deriveDesktopAudioCodecOperation(opusRequest),
	}) as { readonly status: string; readonly output?: Uint8Array };
	assert.equal(opusResult.status, 'executed');
	assert.equal(Buffer.from(opusResult.output?.subarray(0, 4) ?? []).toString('ascii'), 'OggS');
	const vorbisRequest: DesktopAudioCodecRequest = {
		operation: 'audio-encode', format: 'ogg-vorbis',
		input: opusRequest.input, sampleRate: 48_000, channelCount: 2,
		settings: { quality: 6 }, maximumOutputBytes: 64 * 1024,
	};
	const vorbisResult = await runtime.execute(vorbisRequest, {
		operation: deriveDesktopAudioCodecOperation(vorbisRequest),
	}) as { readonly status: string; readonly output?: Uint8Array };
	assert.equal(vorbisResult.status, 'executed');
	assert.equal(Buffer.from(vorbisResult.output?.subarray(0, 4) ?? []).toString('ascii'), 'OggS');
	const mp2EncodeRequest: DesktopAudioCodecRequest = {
		operation: 'audio-encode', format: 'mp2', input: opusRequest.input,
		sampleRate: 48_000, channelCount: 2,
		settings: { bitrateKbps: 192 }, maximumOutputBytes: 64 * 1024,
	};
	const mp2EncodeResult = await runtime.execute(mp2EncodeRequest, {
		operation: deriveDesktopAudioCodecOperation(mp2EncodeRequest),
	}) as { readonly status: string; readonly output?: Uint8Array };
	assert.equal(mp2EncodeResult.status, 'executed');
	assert.equal(mp2EncodeResult.output?.[0], 0xff);
	const mp3EncodeRequest: DesktopAudioCodecRequest = {
		operation: 'audio-encode', format: 'mp3', input: stereoSinePcm(4_608, 48_000),
		sampleRate: 48_000, channelCount: 2,
		settings: { bitrateKbps: 192 }, maximumOutputBytes: 64 * 1024,
	};
	const mp3EncodeResult = await runtime.execute(mp3EncodeRequest, {
		operation: deriveDesktopAudioCodecOperation(mp3EncodeRequest),
	}) as { readonly status: string; readonly output?: Uint8Array };
	assert.equal(mp3EncodeResult.status, 'executed');
	assert.equal(mp3EncodeResult.output?.[0], 0xff);
	const mp2Request: DesktopAudioCodecRequest = {
		operation: 'audio-decode', format: 'mp2',
		input: testMpegAudioStream({ layer: 2, sampleRate: 48_000, channelCount: 2 }),
		sampleRate: null, channelCount: null,
		settings: { sampleFormat: 'f32le' }, maximumOutputBytes: 64 * 1024,
	};
	const mp2Result = await runtime.execute(mp2Request, {
		operation: deriveDesktopAudioCodecOperation(mp2Request),
	}) as { readonly status: string; readonly decodedGeometry?: unknown };
	assert.equal(mp2Result.status, 'executed');
	assert.deepEqual(mp2Result.decodedGeometry, {
		sampleRate: 48_000, channelCount: 2, frameCount: 4 * 1_152,
	});
	const wrongRate = { ...opusRequest, sampleRate: 24_000 } as DesktopAudioCodecRequest;
	assert.equal((await runtime.preflightRequest?.(wrongRate, {
		operation: deriveDesktopAudioCodecOperation(wrongRate),
	}))?.disposition, 'unsupported');
});

test('broker receipts attribute bundled encode and decode to each concrete reviewed runtime', async () => {
	const flac = await loadBundledFlacAudioCodecRuntime({ target: 'linux-x64' });
	const lame = await loadBundledLameAudioCodecRuntime({ target: 'linux-x64' });
	const mpg123 = await loadBundledMpg123AudioCodecRuntime({ target: 'linux-x64' });
	const opus = await loadBundledOpusAudioCodecRuntime({ target: 'linux-x64' });
	const twolame = await loadBundledTwolameAudioCodecRuntime({ target: 'linux-x64' });
	const wavpack = await loadBundledWavPackAudioCodecRuntime({ target: 'linux-x64' });
	const vorbis = await loadBundledVorbisAudioCodecRuntime({ target: 'linux-x64' });
	assert.ok(flac);
	assert.ok(lame);
	assert.ok(mpg123);
	assert.ok(opus);
	assert.ok(twolame);
	assert.ok(wavpack);
	assert.ok(vorbis);
	const bundled = createBundledDesktopAudioCodecRuntime({
		target: 'linux-x64', runtimes: [wavpack, flac, opus, mpg123, lame, vorbis, twolame],
	});
	const broker = createDesktopAudioCodecBroker({ runtimes: [
		bundled, unreachableRuntime('operating-system'), unreachableRuntime('external-ffmpeg'),
	] });
	const pcm = new Uint8Array(Float32Array.from({ length: 960 * 2 }, (_, index) => (
		Math.sin(index / 31) * 0.25
	)).buffer);
	const fixtures = [
		['flac', flac, {
			operation: 'audio-encode', format: 'flac', input: pcm,
			sampleRate: 48_000, channelCount: 2,
			settings: { compressionLevel: 5, bitDepth: 24 }, maximumOutputBytes: 256 * 1024,
		}],
		['wavpack', wavpack, {
			operation: 'audio-encode', format: 'wavpack', input: pcm,
			sampleRate: 48_000, channelCount: 2,
			settings: { compressionLevel: 2 }, maximumOutputBytes: 256 * 1024,
		}],
		['opus', opus, {
			operation: 'audio-encode', format: 'opus', input: pcm,
			sampleRate: 48_000, channelCount: 2,
			settings: { bitrateKbps: 128, vbrMode: 1 }, maximumOutputBytes: 256 * 1024,
		}],
		['ogg-vorbis', vorbis, {
			operation: 'audio-encode', format: 'ogg-vorbis', input: pcm,
			sampleRate: 48_000, channelCount: 2,
			settings: { quality: 6 }, maximumOutputBytes: 256 * 1024,
		}],
	] as const satisfies readonly (readonly [
		'flac' | 'wavpack' | 'opus' | 'ogg-vorbis', DesktopAudioCodecProviderRuntime, DesktopAudioCodecRequest,
	])[];

	for (const [format, concrete, request] of fixtures) {
		const encoded = await broker.execute(request);
		assertConcreteReceipt(encoded.receipt, concrete.provider);
		assert.equal(encoded.result.operation, 'audio-encode');
		const decoded = await broker.execute({
			operation: 'audio-decode', format, input: encoded.result.bytes,
			sampleRate: null, channelCount: null, settings: { sampleFormat: 'f32le' },
			maximumOutputBytes: 256 * 1024,
		});
		assertConcreteReceipt(decoded.receipt, concrete.provider);
		assert.equal(decoded.result.operation, 'audio-decode');
	}
	for (const [format, layer] of [['mp3', 3], ['mp2', 2]] as const) {
		const decoded = await broker.execute({
			operation: 'audio-decode', format,
			input: testMpegAudioStream({ layer }), sampleRate: null, channelCount: null,
			settings: { sampleFormat: 'f32le' }, maximumOutputBytes: 256 * 1024,
		});
		assertConcreteReceipt(decoded.receipt, mpg123.provider);
		assert.equal(decoded.result.operation, 'audio-decode');
	}
	const twolamePcm = stereoSinePcm(4_608, 48_000);
	const mp2Encoded = await broker.execute({
		operation: 'audio-encode', format: 'mp2', input: twolamePcm,
		sampleRate: 48_000, channelCount: 2, settings: { bitrateKbps: 192 },
		maximumOutputBytes: 256 * 1024,
	});
	assertConcreteReceipt(mp2Encoded.receipt, twolame.provider);
	assert.equal(mp2Encoded.result.operation, 'audio-encode');
	const mp2Decoded = await broker.execute({
		operation: 'audio-decode', format: 'mp2', input: mp2Encoded.result.bytes,
		sampleRate: null, channelCount: null, settings: { sampleFormat: 'f32le' },
		maximumOutputBytes: 256 * 1024,
	});
	assertConcreteReceipt(mp2Decoded.receipt, mpg123.provider);
	assert.equal(mp2Decoded.result.operation, 'audio-decode');
	assert.deepEqual(mp2Decoded.result.metadata, {
		kind: 'decoded-audio', sourceFormat: 'mp2', sampleFormat: 'f32le',
		interleaving: 'interleaved', sampleRate: 48_000, channelCount: 2, frameCount: 4_608,
	});
	assert.ok(bestAlignedSnr(twolamePcm, mp2Decoded.result.bytes, 2, 1_024) > 20,
		'TwoLAME -> mpg123 should preserve a modest aligned signal-to-noise ratio');
	const lamePcm = stereoSinePcm(4_608, 48_000);
	const mp3Encoded = await broker.execute({
		operation: 'audio-encode', format: 'mp3', input: lamePcm,
		sampleRate: 48_000, channelCount: 2, settings: { bitrateKbps: 192 },
		maximumOutputBytes: 256 * 1024,
	});
	assertConcreteReceipt(mp3Encoded.receipt, lame.provider);
	assert.equal(mp3Encoded.result.operation, 'audio-encode');
	const mp3Decoded = await broker.execute({
		operation: 'audio-decode', format: 'mp3', input: mp3Encoded.result.bytes,
		sampleRate: null, channelCount: null, settings: { sampleFormat: 'f32le' },
		maximumOutputBytes: 256 * 1024,
	});
	assertConcreteReceipt(mp3Decoded.receipt, mpg123.provider);
	assert.deepEqual(mp3Decoded.result.metadata, {
		kind: 'decoded-audio', sourceFormat: 'mp3', sampleFormat: 'f32le',
		interleaving: 'interleaved', sampleRate: 48_000, channelCount: 2, frameCount: 4_608,
	});
	assert.ok(bestAlignedSnr(lamePcm, mp3Decoded.result.bytes, 2, 1_024) > 20,
		'LAME -> mpg123 should preserve a modest aligned signal-to-noise ratio');
});

test('the composite remains fail closed for an empty or wrong-tier runtime list', () => {
	assert.throws(() => createBundledDesktopAudioCodecRuntime({
		target: 'mac-arm64', runtimes: [],
	}), /runtime list/iu);
	assert.throws(() => createBundledDesktopAudioCodecRuntime({
		target: 'mac-x64' as 'mac-arm64', runtimes: [{}] as never,
	}), /target|runtime/iu);
});

function unreachableRuntime(kind: Exclude<DesktopCodecProviderKind, 'bundled'>): DesktopAudioCodecProviderRuntime {
	return Object.freeze({
		provider: Object.freeze({
			kind, id: `${kind}-unreachable`, implementation: `${kind}-unreachable`,
			version: '1.0.0', capabilityGeneration: `${kind}-unreachable-generation`,
			preflight(): never { throw new Error(`${kind} must not be preflighted.`); },
		}),
		execute(): never { throw new Error(`${kind} must not execute.`); },
	});
}

function assertConcreteReceipt(
	receipt: DesktopCodecOperationReceipt,
	provider: DesktopCodecProvider,
): void {
	assert.deepEqual(receipt.provider, {
		kind: provider.kind, id: provider.id,
		implementation: provider.implementation, version: provider.version,
	});
	assert.equal(receipt.capabilityGeneration, provider.capabilityGeneration);
}

function stereoSinePcm(frameCount: number, sampleRate: number): Uint8Array {
	const values = new Float32Array(frameCount * 2);
	for (let frame = 0; frame < frameCount; frame++) {
		values[frame * 2] = Math.sin(2 * Math.PI * 440 * frame / sampleRate) * 0.35;
		values[frame * 2 + 1] = Math.sin(2 * Math.PI * 660 * frame / sampleRate) * 0.25;
	}
	return new Uint8Array(values.buffer);
}

function bestAlignedSnr(
	expectedBytes: Uint8Array,
	actualBytes: Uint8Array,
	channelCount: number,
	maximumLag: number,
): number {
	const expected = new Float32Array(
		expectedBytes.buffer, expectedBytes.byteOffset, expectedBytes.byteLength / Float32Array.BYTES_PER_ELEMENT,
	);
	const actual = new Float32Array(
		actualBytes.buffer, actualBytes.byteOffset, actualBytes.byteLength / Float32Array.BYTES_PER_ELEMENT,
	);
	const frameCount = expected.length / channelCount;
	let best = Number.NEGATIVE_INFINITY;
	for (let lag = 0; lag <= maximumLag; lag++) {
		let signal = 0;
		let error = 0;
		for (let frame = maximumLag; frame + lag < frameCount; frame++) {
			for (let channel = 0; channel < channelCount; channel++) {
				const source = expected[frame * channelCount + channel]!;
				const decoded = actual[(frame + lag) * channelCount + channel]!;
				signal += source * source;
				error += (source - decoded) ** 2;
			}
		}
		best = Math.max(best, 10 * Math.log10(signal / error));
	}
	return best;
}
