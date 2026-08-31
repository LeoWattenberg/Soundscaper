/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
	deriveDesktopAudioOperatingSystemCandidates,
	deriveDesktopAudioOperatingSystemCandidatesFromOperation,
} from '../desktop/desktop-audio-os-codec-candidates.ts';
import { deriveDesktopAudioCodecOperation } from '../desktop/desktop-audio-codec-broker.ts';
import {
	verifyOperatingSystemCodecCapabilities,
	type OperatingSystemCodecCanaryRequest,
} from '../desktop/os-codec-capability-adapter.ts';

test('Windows x64 and ARM64 derive exact Media Foundation AAC encode candidates', () => {
	for (const target of ['win-x64', 'win-arm64'] as const) {
		const request = aacRequest('audio-encode', 48_000, 6);
		const result = deriveDesktopAudioOperatingSystemCandidates(target, request);
		const operation = deriveDesktopAudioCodecOperation(request);
		assert.equal(result.target, target);
		assert.equal(result.implementation, 'windows-media-foundation');
		assert.equal(result.candidates.length, 1);
		assert.deepEqual(result.candidates[0]?.capability, {
			id: expectedId('windows-media-foundation', operation),
			...operation,
		});
		assert.equal(Object.isFrozen(result), true);
		assert.equal(Object.isFrozen(result.candidates), true);
		assert.equal(Object.isFrozen(result.candidates[0]), true);
		assert.equal(Object.isFrozen(result.candidates[0]?.capability), true);
	}
});

test('macOS ARM64 derives the same reviewed encode tuple with the Apple audio binding', () => {
	const request = aacRequest('audio-encode', 96_000, 2);
	const result = deriveDesktopAudioOperatingSystemCandidates('mac-arm64', request);
	const operation = deriveDesktopAudioCodecOperation(request);
	assert.equal(result.implementation, 'apple-audiotoolbox-avfoundation');
	assert.deepEqual(result.candidates[0]?.capability, {
		id: expectedId('apple-audiotoolbox-avfoundation', operation),
		...operation,
	});
});

test('decode canary candidates require explicit resolved source geometry', () => {
	for (const [target, implementation] of [
		['win-x64', 'windows-media-foundation'],
		['mac-arm64', 'apple-audiotoolbox-avfoundation'],
	] as const) {
		for (const operation of [
			resolvedDecodeOperation('aac-m4a', 44_100, 2),
			resolvedDecodeOperation('mp3', 48_000, 1),
		]) {
			const result = deriveDesktopAudioOperatingSystemCandidatesFromOperation(target, operation);
			assert.deepEqual(result.candidates[0]?.capability, {
				id: expectedId(implementation, operation), ...operation,
			});
		}
		assert.deepEqual(
			deriveDesktopAudioOperatingSystemCandidates(target, aacRequest('audio-decode')).candidates,
			[],
		);
		assert.deepEqual(
			deriveDesktopAudioOperatingSystemCandidates(target, mp3DecodeRequest()).candidates,
			[],
		);
	}
});

test('Linux has no OS provider candidate and macOS x64 is explicitly unsupported', () => {
	for (const target of ['linux-x64', 'linux-arm64'] as const) {
		const result = deriveDesktopAudioOperatingSystemCandidates(target, aacRequest('audio-decode'));
		assert.deepEqual(result, { target, implementation: null, candidates: [] });
	}
	assert.throws(() => deriveDesktopAudioOperatingSystemCandidates(
		'mac-x64', aacRequest('audio-decode'),
	), /macOS x64.*unsupported/iu);
	assert.throws(() => deriveDesktopAudioOperatingSystemCandidates(
		'win-ia32', aacRequest('audio-decode'),
	), /target.*unsupported/iu);
});

test('open codecs remain bundled-owner territory outside the reviewed Windows MP3 encoder', () => {
	for (const request of [
		encodeRequest('flac', { compressionLevel: 5, bitDepth: 24 }),
		encodeRequest('ogg-vorbis', { quality: 6 }),
		encodeRequest('opus', { bitrateKbps: 128 }),
		encodeRequest('wavpack', { compressionLevel: 2 }),
		encodeRequest('mp2', { bitrateKbps: 192 }),
		decodeRequest('flac'), decodeRequest('ogg-vorbis'), decodeRequest('opus'),
		decodeRequest('wavpack'), decodeRequest('mp2'),
	]) {
		for (const target of ['win-x64', 'mac-arm64'] as const) {
			assert.deepEqual(
				deriveDesktopAudioOperatingSystemCandidates(target, request).candidates,
				[],
			);
		}
	}
	const request = encodeRequest('mp3', { bitrateKbps: 192 });
	const operation = deriveDesktopAudioCodecOperation(request);
	for (const target of ['win-x64', 'win-arm64'] as const) {
		assert.deepEqual(
			deriveDesktopAudioOperatingSystemCandidates(target, request).candidates[0]?.capability,
			{ id: expectedId('windows-media-foundation', operation), ...operation },
		);
	}
	assert.deepEqual(
		deriveDesktopAudioOperatingSystemCandidates('mac-arm64', request).candidates,
		[],
	);
	assert.deepEqual(
		deriveDesktopAudioOperatingSystemCandidates(
			'win-x64', encodeRequest('mp3', { bitrateKbps: 160 }),
		).candidates,
		[],
	);
});

test('direct derived operations produce the same tuple and reject inexact operation shapes', () => {
	const request = aacRequest('audio-encode', 48_000, 8);
	const operation = deriveDesktopAudioCodecOperation(request);
	const fromRequest = deriveDesktopAudioOperatingSystemCandidates('mac-arm64', request);
	const fromOperation = deriveDesktopAudioOperatingSystemCandidatesFromOperation('mac-arm64', operation);
	assert.deepEqual(fromOperation, fromRequest);
	assert.throws(() => deriveDesktopAudioOperatingSystemCandidatesFromOperation(
		'win-x64', { ...operation, inputPath: '/renderer/input' },
	), /inexact shape/u);
	assert.throws(() => deriveDesktopAudioOperatingSystemCandidatesFromOperation(
		'win-x64', { ...operation, channelCount: 0 },
	), /channel count/u);
	assert.throws(() => deriveDesktopAudioOperatingSystemCandidatesFromOperation(
		'win-x64', { ...operation, mediaKind: 'video' },
	), /audio operation/u);
});

test('direct MP3 encode candidates stay Windows-only and changed AAC profiles remain unreviewed', () => {
	const mp3Encode = deriveDesktopAudioCodecOperation(encodeRequest('mp3', { bitrateKbps: 192 }));
	assert.equal(
		deriveDesktopAudioOperatingSystemCandidatesFromOperation('win-arm64', mp3Encode).candidates.length,
		1,
	);
	assert.deepEqual(
		deriveDesktopAudioOperatingSystemCandidatesFromOperation('mac-arm64', mp3Encode).candidates, [],
	);
	const changedProfile = { ...resolvedDecodeOperation('aac-m4a', 48_000, 2), profile: 'he' };
	assert.deepEqual(
		deriveDesktopAudioOperatingSystemCandidatesFromOperation('mac-arm64', changedProfile).candidates,
		[],
	);
});

test('derived candidates bind canonically through the existing canary verification seam', async () => {
	const candidateSet = deriveDesktopAudioOperatingSystemCandidatesFromOperation(
		'mac-arm64', resolvedDecodeOperation('aac-m4a', 48_000, 2),
	);
	const received: OperatingSystemCodecCanaryRequest[] = [];
	const verification = await verifyOperatingSystemCodecCapabilities({
		target: candidateSet.target,
		osVersion: '15.4',
		candidates: candidateSet.candidates,
		runner: { run(request) {
			received.push(request);
			return Promise.resolve({
				contractVersion: 1, status: 'passed', target: request.target,
				osVersion: request.osVersion, capabilityId: request.capability.id,
				capabilityDigest: request.capabilityDigest, implementation: request.implementation,
				nativeApiReached: true, exactTuplePassed: true, resultDigest: 'a'.repeat(64),
			});
		} },
	});
	assert.equal(received.length, 1);
	assert.equal(received[0]?.implementation, candidateSet.implementation);
	assert.equal(verification.status, 'available');
	assert.equal(verification.providerOptions.canaryVerifiedCapabilities[0]?.implementation,
		'apple-audiotoolbox-avfoundation');
});

test('candidate derivation has no subprocess, path, URL, argv, or execution authority', async () => {
	const source = await readFile(new URL('../desktop/desktop-audio-os-codec-candidates.ts', import.meta.url), 'utf8');
	assert.doesNotMatch(source, /node:child_process|\bspawn\s*\(|\bexec(?:File)?\s*\(/u);
	assert.doesNotMatch(source, /executablePath|inputPath|outputPath|\bargv\b|https?:\/\//u);
});

function aacRequest(
	operation: 'audio-encode' | 'audio-decode', sampleRate = 48_000, channelCount = 2,
): Record<string, unknown> {
	return operation === 'audio-encode'
		? encodeRequest('aac-m4a', { bitrateKbps: 192 }, sampleRate, channelCount)
		: decodeRequest('aac-m4a', sampleRate, channelCount);
}

function mp3DecodeRequest(): Record<string, unknown> {
	return decodeRequest('mp3', 44_100, 2);
}

function decodeRequest(format: string, sampleRate = 48_000, channelCount = 2): Record<string, unknown> {
	assert.ok(sampleRate > 0 && channelCount > 0);
	return {
		operation: 'audio-decode', format, input: Uint8Array.of(1, 2, 3),
		sampleRate: null, channelCount: null, settings: { sampleFormat: 'f32le' },
		maximumOutputBytes: 8_192,
	};
}

function resolvedDecodeOperation(format: 'aac-m4a' | 'mp3', sampleRate: number, channelCount: number) {
	return Object.freeze({
		...deriveDesktopAudioCodecOperation(decodeRequest(format)), sampleRate, channelCount,
	});
}

function encodeRequest(
	format: string, settings: Readonly<Record<string, unknown>>,
	sampleRate = format === 'opus' ? 48_000 : format === 'mp2' ? 48_000 : 48_000,
	channelCount = 2,
): Record<string, unknown> {
	return {
		operation: 'audio-encode', format,
		input: new Uint8Array(Float32Array.BYTES_PER_ELEMENT * channelCount),
		sampleRate, channelCount, settings, maximumOutputBytes: 8_192,
	};
}

function expectedId(implementation: string, operation: ReturnType<typeof deriveDesktopAudioCodecOperation>): string {
	return [
		implementation, operation.direction, operation.container, operation.codec,
		operation.profile ?? 'default', operation.sampleFormat,
		`${String(operation.sampleRate)}hz`, `${String(operation.channelCount)}ch`,
	].join('-');
}
