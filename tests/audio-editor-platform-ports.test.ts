/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import type { AudioDeviceHostPort, AudioInputStreamPort, AudioOutputStreamPort } from '../src/common/editor/platform/audio-device-port.ts';
import type { AudioEffectHostPort, AudioEffectInstancePort } from '../src/common/editor/platform/audio-effect-host-port.ts';
import {
	PLATFORM_TRANSFER_HARD_LIMITS,
	createBoundedAudioChunk,
	createBoundedByteChunk,
	createBoundedPortMessage,
} from '../src/common/editor/platform/bounded-transfer.ts';
import {
	DEFERRED_PLATFORM_CONTRACTS,
	PLATFORM_PORT_CONTRACT,
} from '../src/common/editor/platform/contract-policy.ts';
import type {
	MediaDecodePort,
	MediaDecodeSessionPort,
	MediaEncodePort,
	MediaEncodeSessionPort,
	MediaProbePort,
} from '../src/common/editor/platform/media-codec-port.ts';
import type {
	MediaByteReaderPort,
	MediaByteWriterPort,
	StreamingMediaReadPort,
	StreamingMediaWritePort,
} from '../src/common/editor/platform/media-stream-port.ts';
import type { RenderJobHostPort, RenderJobPort } from '../src/common/editor/platform/render-job-port.ts';

type MethodRequest<Method> = Method extends (request: infer Request) => unknown ? Request : never;

function requiresSignal<Request extends Readonly<{ signal: AbortSignal }>>(..._evidence: Request[]): true {
	return true;
}

test('platform port operations require AbortSignal at the type boundary', () => {
	const evidence = [
		requiresSignal<MethodRequest<StreamingMediaReadPort<string>['open']>>(),
		requiresSignal<MethodRequest<MediaByteReaderPort['read']>>(),
		requiresSignal<MethodRequest<MediaByteReaderPort['close']>>(),
		requiresSignal<MethodRequest<StreamingMediaWritePort<string>['open']>>(),
		requiresSignal<MethodRequest<MediaByteWriterPort['write']>>(),
		requiresSignal<MethodRequest<MediaByteWriterPort['commit']>>(),
		requiresSignal<MethodRequest<MediaByteWriterPort['abort']>>(),
		requiresSignal<MethodRequest<MediaProbePort['probe']>>(),
		requiresSignal<MethodRequest<MediaDecodePort['open']>>(),
		requiresSignal<MethodRequest<MediaDecodeSessionPort['read']>>(),
		requiresSignal<MethodRequest<MediaDecodeSessionPort['close']>>(),
		requiresSignal<MethodRequest<MediaEncodePort['open']>>(),
		requiresSignal<MethodRequest<MediaEncodeSessionPort['write']>>(),
		requiresSignal<MethodRequest<MediaEncodeSessionPort['finish']>>(),
		requiresSignal<MethodRequest<MediaEncodeSessionPort['abort']>>(),
		requiresSignal<MethodRequest<RenderJobHostPort['open']>>(),
		requiresSignal<MethodRequest<RenderJobPort['read']>>(),
		requiresSignal<MethodRequest<RenderJobPort['result']>>(),
		requiresSignal<MethodRequest<RenderJobPort['cancel']>>(),
		requiresSignal<MethodRequest<AudioDeviceHostPort['enumerate']>>(),
		requiresSignal<MethodRequest<AudioDeviceHostPort['openInput']>>(),
		requiresSignal<MethodRequest<AudioDeviceHostPort['openOutput']>>(),
		requiresSignal<MethodRequest<AudioInputStreamPort['read']>>(),
		requiresSignal<MethodRequest<AudioInputStreamPort['close']>>(),
		requiresSignal<MethodRequest<AudioOutputStreamPort['write']>>(),
		requiresSignal<MethodRequest<AudioOutputStreamPort['close']>>(),
		requiresSignal<MethodRequest<AudioEffectHostPort['enumerate']>>(),
		requiresSignal<MethodRequest<AudioEffectHostPort['open']>>(),
		requiresSignal<MethodRequest<AudioEffectInstancePort['process']>>(),
		requiresSignal<MethodRequest<AudioEffectInstancePort['readState']>>(),
		requiresSignal<MethodRequest<AudioEffectInstancePort['writeState']>>(),
		requiresSignal<MethodRequest<AudioEffectInstancePort['close']>>(),
	];
	assert.equal(evidence.every(Boolean), true);
});

test('bounded transfer factories reject oversized or malformed chunks and messages', () => {
	const bytes = createBoundedByteChunk(new Uint8Array([1, 2, 3]), {
		sequence: 4,
		maximumByteLength: 4,
		final: true,
	});
	assert.deepEqual({
		sequence: bytes.sequence,
		byteLength: bytes.byteLength,
		maximumByteLength: bytes.maximumByteLength,
		final: bytes.final,
	}, { sequence: 4, byteLength: 3, maximumByteLength: 4, final: true });
	assert.equal(Object.isFrozen(bytes), true);
	assert.throws(() => createBoundedByteChunk(new Uint8Array(5), {
		sequence: 0,
		maximumByteLength: 4,
	}), /maximumByteLength/u);
	assert.throws(() => createBoundedByteChunk(new Uint8Array(1), {
		sequence: 0,
		maximumByteLength: PLATFORM_TRANSFER_HARD_LIMITS.mediaChunkBytes + 1,
	}), /hard limit/u);

	const audio = createBoundedAudioChunk([
		new Float32Array([0.25, -0.25]),
		new Float32Array([0.5, -0.5]),
	], {
		sequence: 2,
		maximumFrameCount: 4,
		startFrame: 8,
	});
	assert.deepEqual({
		sequence: audio.sequence,
		channelCount: audio.channelCount,
		frameCount: audio.frameCount,
		byteLength: audio.byteLength,
		startFrame: audio.startFrame,
	}, { sequence: 2, channelCount: 2, frameCount: 2, byteLength: 16, startFrame: 8 });
	assert.equal(Object.isFrozen(audio.channels), true);
	assert.throws(() => createBoundedAudioChunk([
		new Float32Array(2),
		new Float32Array(1),
	], { sequence: 0, maximumFrameCount: 2 }), /same frame count/u);

	const progress = { completed: 3, total: 10 };
	const message = createBoundedPortMessage('progress', progress, {
		sequence: 1,
		maximumEncodedBytes: 256,
	});
	progress.completed = 9;
	assert.equal(message.type, 'progress');
	assert.equal(message.payload.completed, 3);
	assert.equal(Object.isFrozen(message.payload), true);
	assert.equal(message.encodedByteLength <= message.maximumEncodedBytes, true);
	assert.throws(() => createBoundedPortMessage('progress', { detail: 'x'.repeat(256) }, {
		sequence: 0,
		maximumEncodedBytes: 32,
	}), /maximumEncodedBytes/u);
	assert.throws(() => createBoundedPortMessage('progress', { completed: Number.POSITIVE_INFINITY }, {
		sequence: 0,
		maximumEncodedBytes: 256,
	}), /JSON-compatible/u);
});

test('runtime policy exposes only the enacted port families and keeps deferred contracts blocked', () => {
	assert.equal(PLATFORM_PORT_CONTRACT.version, 1);
	assert.equal(PLATFORM_PORT_CONTRACT.requiresAbortSignal, true);
	assert.deepEqual(PLATFORM_PORT_CONTRACT.implementationBoundary, {
		projectDomainImplementations: 'forbidden',
		reactUiImplementations: 'forbidden',
	});
	assert.deepEqual(PLATFORM_PORT_CONTRACT.activeFamilies, [
		'audio-device',
		'audio-effect-host',
		'media-decode',
		'media-encode',
		'media-probe',
		'media-stream-read',
		'media-stream-write',
		'persistent-render-queue',
		'render-job',
	]);
	assert.deepEqual(DEFERRED_PLATFORM_CONTRACTS.map(({ id, milestone, status }) => ({ id, milestone, status })), [
		{ id: 'framescaper-capture', milestone: '8A', status: 'blocked' },
		{ id: 'midi-device', milestone: '8B', status: 'blocked' },
		{ id: 'midi-event', milestone: '8B', status: 'blocked' },
	]);
	assert.equal(Object.isFrozen(PLATFORM_PORT_CONTRACT.activeFamilies), true);
	assert.equal(Object.isFrozen(DEFERRED_PLATFORM_CONTRACTS), true);
});

test('port contracts remain direct owner imports without a platform barrel', () => {
	const platformDirectory = fileURLToPath(new URL('../src/common/editor/platform/', import.meta.url));
	assert.equal(existsSync(`${platformDirectory}/index.ts`), false);
	assert.deepEqual(PLATFORM_PORT_CONTRACT.ownerModules, {
		'audio-device': 'src/common/editor/platform/audio-device-port.ts',
		'audio-effect-host': 'src/common/editor/platform/audio-effect-host-port.ts',
		'bounded-transfer': 'src/common/editor/platform/bounded-transfer.ts',
		'media-codec': 'src/common/editor/platform/media-codec-port.ts',
		'media-stream': 'src/common/editor/platform/media-stream-port.ts',
		'persistent-render-queue': 'src/common/editor/platform/persistent-render-queue-port.ts',
		'render-job': 'src/common/editor/platform/render-job-port.ts',
	});
	for (const path of Object.values(PLATFORM_PORT_CONTRACT.ownerModules)) {
		assert.equal(existsSync(fileURLToPath(new URL(`../${path}`, import.meta.url))), true, path);
	}
});
