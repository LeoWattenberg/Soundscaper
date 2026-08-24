/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
	createOperatingSystemAudioCodecCanaryAdapter,
	OPERATING_SYSTEM_AAC_M4A_CANARY_SHA256,
	OPERATING_SYSTEM_MP3_CANARY_SHA256,
} from '../desktop/os-audio-codec-canary-adapter.ts';
import type { OperatingSystemCodecCanaryRequest } from '../desktop/os-codec-capability-adapter.ts';
import type {
	OperatingSystemAudioCodecOperationRunner,
} from '../desktop/os-audio-codec-operation-runner.ts';

const digest = (value: string): string => createHash('sha256').update(value).digest('hex');

const capability = Object.freeze({
	id: 'windows-media-foundation-decode-mp3-mp3-default-f32-48000hz-2ch',
	direction: 'decode' as const, mediaKind: 'audio' as const,
	container: 'mp3', codec: 'mp3', profile: null, sampleFormat: 'f32',
	pixelFormat: null, sampleRate: 48_000, channelCount: 2, width: null, height: null,
});
const aacCapability = Object.freeze({
	id: 'windows-media-foundation-decode-m4a-aac-lc-f32p-48000hz-2ch',
	direction: 'decode' as const, mediaKind: 'audio' as const,
	container: 'm4a', codec: 'aac', profile: 'lc', sampleFormat: 'f32p',
	pixelFormat: null, sampleRate: 48_000, channelCount: 2, width: null, height: null,
});

function request(
	overrides: Partial<OperatingSystemCodecCanaryRequest> = {},
): OperatingSystemCodecCanaryRequest {
	return {
		contractVersion: 1, target: 'win-x64', osVersion: '10.0.26100',
		implementation: 'windows-media-foundation', capability,
		capabilityDigest: digest(JSON.stringify(capability)), maximumDurationMs: 5_000,
		...overrides,
	};
}

test('canary decodes embedded MP3 through the supervised runner and binds exact evidence', async () => {
	const output = new Uint8Array(new Float32Array([0.25, -0.25, 0.5, -0.5]).buffer);
	let calls = 0;
	const runner: OperatingSystemAudioCodecOperationRunner = {
		execute: async (decodeRequest, options) => {
			calls += 1;
			assert.equal(decodeRequest.operation, 'audio-decode');
			assert.equal(decodeRequest.format, 'mp3');
			assert.equal(decodeRequest.sampleRate, null);
			assert.equal(decodeRequest.channelCount, null);
			assert.equal(createHash('sha256').update(decodeRequest.input).digest('hex'),
				OPERATING_SYSTEM_MP3_CANARY_SHA256);
			assert.equal(options?.signal instanceof AbortSignal, true);
			return {
				status: 'executed', output,
				decodedGeometry: { sampleRate: 48_000, channelCount: 2, frameCount: 2 },
			};
		},
	};
	const adapter = createOperatingSystemAudioCodecCanaryAdapter({ target: 'win-x64', runner });
	const signal = new AbortController().signal;
	const result = await adapter.runCanary(request(), signal);
	assert.equal(calls, 1);
	assert.equal(result.status, 'qualified');
	if (result.status !== 'qualified') assert.fail('The exact MP3 canary must qualify.');
	assert.deepEqual(result, {
		contractVersion: 1, status: 'qualified', target: 'win-x64', osVersion: '10.0.26100',
		capabilityId: capability.id, capabilityDigest: digest(JSON.stringify(capability)),
		implementation: 'windows-media-foundation', nativeApiReached: true,
		exactTuplePassed: true, evidenceDigest: result.evidenceDigest,
	});
	assert.match(result.evidenceDigest, /^[a-f0-9]{64}$/u);
});

test('canary decodes embedded AAC-LC M4A through the reviewed native method', async () => {
	const output = new Uint8Array(new Float32Array([0.25, -0.25]).buffer);
	let calls = 0;
	const runner: OperatingSystemAudioCodecOperationRunner = {
		execute: async (decodeRequest) => {
			calls += 1;
			assert.equal(decodeRequest.format, 'aac-m4a');
			assert.equal(createHash('sha256').update(decodeRequest.input).digest('hex'),
				OPERATING_SYSTEM_AAC_M4A_CANARY_SHA256);
			return {
				status: 'executed', output,
				decodedGeometry: { sampleRate: 48_000, channelCount: 2, frameCount: 1 },
			};
		},
	};
	const adapter = createOperatingSystemAudioCodecCanaryAdapter({ target: 'mac-arm64', runner });
	const aacRequest = request({
		target: 'mac-arm64', osVersion: '15.6.1',
		implementation: 'apple-audiotoolbox-avfoundation', capability: aacCapability,
		capabilityDigest: digest(JSON.stringify(aacCapability)),
	});
	const result = await adapter.runCanary(aacRequest, new AbortController().signal);
	assert.equal(calls, 1);
	assert.equal(result.status, 'qualified');
	if (result.status !== 'qualified') assert.fail('The exact AAC-LC M4A canary must qualify.');
	assert.equal(result.capabilityId, aacCapability.id);
	assert.equal(result.implementation, 'apple-audiotoolbox-avfoundation');
	assert.match(result.evidenceDigest, /^[a-f0-9]{64}$/u);
});

test('canary refuses mismatched tuples, silent output, and non-native runner failures', async () => {
	let calls = 0;
	const runner: OperatingSystemAudioCodecOperationRunner = {
		execute: async () => { calls += 1; return {
			status: 'executed', output: new Uint8Array(8),
			decodedGeometry: { sampleRate: 48_000, channelCount: 2, frameCount: 1 },
		}; },
	};
	const adapter = createOperatingSystemAudioCodecCanaryAdapter({ target: 'win-x64', runner });
	assert.deepEqual(await adapter.runCanary(request({
		capability: { ...capability, codec: 'aac' },
	}), new AbortController().signal), {
		contractVersion: 1, status: 'unavailable', reason: 'canary-refused',
	});
	assert.equal(calls, 0);
	assert.deepEqual(await adapter.runCanary(request(), new AbortController().signal), {
		contractVersion: 1, status: 'unavailable', reason: 'canary-refused',
	});

	const unsupported: OperatingSystemAudioCodecOperationRunner = {
		execute: async () => ({
			status: 'unavailable', reason: 'tuple-unsupported', detail: 'unsupported',
		}),
	};
	assert.deepEqual(await createOperatingSystemAudioCodecCanaryAdapter({
		target: 'win-x64', runner: unsupported,
	}).runCanary(request(), new AbortController().signal), {
		contractVersion: 1, status: 'unavailable', reason: 'tuple-unsupported',
	});
});

test('canary target binding excludes macOS x64', () => {
	const runner = { execute: async () => ({
		status: 'unavailable' as const, reason: 'api-unavailable' as const, detail: 'unavailable',
	}) };
	assert.throws(() => createOperatingSystemAudioCodecCanaryAdapter({
		target: 'mac-x64' as 'mac-arm64', runner,
	}), /target/iu);
});

test('startup canary is byte-identical to the target-native self-test fixture', async () => {
	const source = await readFile(new URL(
		'../native/soundscaper-professional-host/tests/os_audio_codec_self_test.cpp', import.meta.url,
	), 'utf8');
	const block = /constexpr char canaryBase64\[\] =([\s\S]*?);/u.exec(source)?.[1];
	assert.equal(typeof block, 'string');
	const encoded = [...block!.matchAll(/"([^"]*)"/gu)].map((match) => match[1]).join('');
	const fixture = Buffer.from(encoded, 'base64');
	assert.equal(fixture.byteLength, 1_536);
	assert.equal(createHash('sha256').update(fixture).digest('hex'), OPERATING_SYSTEM_MP3_CANARY_SHA256);
	const aacBlock = /constexpr char aacM4aCanaryBase64\[\] =([\s\S]*?);/u.exec(source)?.[1];
	assert.equal(typeof aacBlock, 'string');
	const aacEncoded = [...aacBlock!.matchAll(/"([^"]*)"/gu)].map((match) => match[1]).join('');
	const aacFixture = Buffer.from(aacEncoded, 'base64');
	assert.equal(aacFixture.byteLength, 1_909);
	assert.equal(createHash('sha256').update(aacFixture).digest('hex'),
		OPERATING_SYSTEM_AAC_M4A_CANARY_SHA256);
});
