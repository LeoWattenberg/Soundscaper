/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createBundledDesktopAudioCodecRuntime } from '../desktop/bundled-audio-codec-runtime.ts';
import { loadBundledFlacAudioCodecRuntime } from '../desktop/bundled-flac-audio-codec-runtime.ts';
import { loadBundledOpusAudioCodecRuntime } from '../desktop/bundled-opus-audio-codec-runtime.ts';
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

test('the composite exposes one bundled tier and delegates exact FLAC, Opus, and WavPack operations', async () => {
	const flac = await loadBundledFlacAudioCodecRuntime({ target: 'linux-x64' });
	const opus = await loadBundledOpusAudioCodecRuntime({ target: 'linux-x64' });
	const wavpack = await loadBundledWavPackAudioCodecRuntime({ target: 'linux-x64' });
	assert.ok(flac);
	assert.ok(opus);
	assert.ok(wavpack);
	const runtime = createBundledDesktopAudioCodecRuntime({
		target: 'linux-x64', runtimes: [wavpack, flac, opus],
	});
	assert.equal(runtime.provider.kind, 'bundled');
	assert.equal(runtime.provider.implementation, 'soundscaper-reviewed-audio-codecs');
	assert.match(runtime.provider.capabilityGeneration, /libflac/u);
	assert.match(runtime.provider.capabilityGeneration, /libopus-libogg/u);
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
		settings: { bitrateKbps: 128 }, maximumOutputBytes: 64 * 1024,
	};
	const opusResult = await runtime.execute(opusRequest, {
		operation: deriveDesktopAudioCodecOperation(opusRequest),
	}) as { readonly status: string; readonly output?: Uint8Array };
	assert.equal(opusResult.status, 'executed');
	assert.equal(Buffer.from(opusResult.output?.subarray(0, 4) ?? []).toString('ascii'), 'OggS');
	const wrongRate = { ...opusRequest, sampleRate: 24_000 } as DesktopAudioCodecRequest;
	assert.equal((await runtime.preflightRequest?.(wrongRate, {
		operation: deriveDesktopAudioCodecOperation(wrongRate),
	}))?.disposition, 'unsupported');
});

test('broker receipts attribute bundled encode and decode to each concrete reviewed runtime', async () => {
	const flac = await loadBundledFlacAudioCodecRuntime({ target: 'linux-x64' });
	const opus = await loadBundledOpusAudioCodecRuntime({ target: 'linux-x64' });
	const wavpack = await loadBundledWavPackAudioCodecRuntime({ target: 'linux-x64' });
	assert.ok(flac);
	assert.ok(opus);
	assert.ok(wavpack);
	const bundled = createBundledDesktopAudioCodecRuntime({
		target: 'linux-x64', runtimes: [wavpack, flac, opus],
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
			settings: { bitrateKbps: 128 }, maximumOutputBytes: 256 * 1024,
		}],
	] as const satisfies readonly (readonly [
		'flac' | 'wavpack' | 'opus', DesktopAudioCodecProviderRuntime, DesktopAudioCodecRequest,
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
