/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	DESKTOP_CODEC_TARGETS,
	createBundledDesktopCodecProvider,
	createExternalFfmpegDesktopCodecProvider,
	createOperatingSystemDesktopCodecProvider,
	type BundledDesktopCodecComponent,
	type DesktopCodecCapability,
} from '../src/common/editor/desktop-codec-provider-catalog.ts';
import type { DesktopCodecOperation } from '../src/common/editor/desktop-codec-coordinator.ts';
import type {
	Av1TargetQualificationDecisionV1,
} from '../src/common/editor/av1-codec-qualification.ts';

const VIDEO_RANGE = Object.freeze({ minimum: 16, maximum: 8_192, multipleOf: 2 });
const AV1_ENCODE = operation({
	direction: 'encode', mediaKind: 'video', container: 'webm', codec: 'av1',
	profile: 'main', pixelFormat: 'yuv420p', width: 1_920, height: 1_080,
});
const AV1_DECODE = operation({ ...AV1_ENCODE, direction: 'decode' });

test('the desktop target matrix is closed and macOS x64 is rejected', () => {
	assert.deepEqual(DESKTOP_CODEC_TARGETS, [
		'linux-x64', 'linux-arm64', 'mac-arm64', 'win-x64', 'win-arm64',
	]);
	assert.throws(() => createBundledDesktopCodecProvider({
		target: 'mac-x64' as 'mac-arm64', capabilityGeneration: 'review-1', inventory: {},
	}), /target/iu);
});

test('bundled capabilities are admitted only when every reviewed payload is present', async () => {
	const inventory: Partial<Record<BundledDesktopCodecComponent, string>> = {
		'specialized-pcm': '1.0.0', libsndfile: '1.2.2', libflac: '1.5.0',
		libogg: '1.3.6', libvorbis: '1.3.7', libopus: '1.5.2', mpg123: '1.33.7',
		lame: '3.100', twolame: '0.4.0', wavpack: '5.8.1', libwebm: '1.0.0.32',
		libvpx: '1.15.2', dav1d: '1.5.4', 'svt-av1': '4.2.0',
	};
	const complete = createBundledDesktopCodecProvider({
		target: 'linux-x64', capabilityGeneration: 'review-42', inventory,
	});
	for (const candidate of [
		operation({ direction: 'encode', mediaKind: 'audio', container: 'bw64', codec: 'pcm', sampleFormat: 's24', sampleRate: 96_000, channelCount: 8 }),
		operation({ direction: 'decode', mediaKind: 'audio', container: 'flac', codec: 'flac', sampleFormat: 's24', sampleRate: 192_000, channelCount: 6 }),
		operation({ direction: 'encode', mediaKind: 'audio', container: 'ogg', codec: 'vorbis', sampleFormat: 'f32p', sampleRate: 48_000, channelCount: 2 }),
		operation({ direction: 'decode', mediaKind: 'audio', container: 'mp3', codec: 'mp3', sampleFormat: 'f32', sampleRate: 44_100, channelCount: 2 }),
		operation({ direction: 'encode', mediaKind: 'audio', container: 'mp3', codec: 'mp3', sampleFormat: 'f32p', sampleRate: 48_000, channelCount: 2 }),
		operation({ direction: 'encode', mediaKind: 'audio', container: 'mp2', codec: 'mp2', sampleFormat: 'f32p', sampleRate: 48_000, channelCount: 2 }),
		operation({ direction: 'decode', mediaKind: 'audio', container: 'mp2', codec: 'mp2', sampleFormat: 'f32', sampleRate: 48_000, channelCount: 2 }),
		operation({ direction: 'decode', mediaKind: 'audio', container: 'wavpack', codec: 'wavpack', sampleFormat: 's32', sampleRate: 192_000, channelCount: 8 }),
		operation({ direction: 'encode', mediaKind: 'video', container: 'webm', codec: 'vp9', profile: 'profile-0', pixelFormat: 'yuv420p', width: 1_920, height: 1_080 }),
	]) assert.equal((await complete.preflight(candidate, {})).disposition, 'supported');
	const bundledMp2Decode = operation({
		direction: 'decode', mediaKind: 'audio', container: 'mp2', codec: 'mp2',
		sampleFormat: 'f32', sampleRate: 44_100, channelCount: 1,
	});
	assert.equal(complete.resolve(bundledMp2Decode)?.implementation, 'mpg123');
	assert.equal((await complete.preflight(operation({
		...bundledMp2Decode, sampleRate: 24_000,
	}), {})).disposition, 'unsupported');

	const missingContainer = createBundledDesktopCodecProvider({
		target: 'linux-x64', capabilityGeneration: 'review-43',
		inventory: { libopus: '1.5.2' },
	});
	assert.equal((await missingContainer.preflight(operation({
		direction: 'encode', mediaKind: 'audio', container: 'ogg', codec: 'opus',
		sampleFormat: 'f32p', sampleRate: 48_000, channelCount: 2,
	}), {})).disposition, 'unsupported');
	assert.equal(missingContainer.capabilities.length, 0);
});

test('bundled AV1 stays unavailable without complete same-target qualification', async () => {
	for (const target of DESKTOP_CODEC_TARGETS) {
		const unqualified = createBundledDesktopCodecProvider({
			target, capabilityGeneration: `review-${target}`,
			inventory: av1Inventory(),
		});
		assert.equal((await unqualified.preflight(AV1_DECODE, {})).disposition, 'unsupported');
		assert.equal((await unqualified.preflight(AV1_ENCODE, {})).disposition, 'unsupported');

		const incomplete = createBundledDesktopCodecProvider({
			target, capabilityGeneration: `review-${target}-incomplete`, inventory: av1Inventory(),
			av1Qualification: av1Qualification(target, { complete: false }),
		});
		assert.equal((await incomplete.preflight(AV1_DECODE, {})).disposition, 'unsupported');
		assert.equal((await incomplete.preflight(AV1_ENCODE, {})).disposition, 'unsupported');
	}
	assert.throws(() => createBundledDesktopCodecProvider({
		target: 'linux-x64', capabilityGeneration: 'review-cross-target', inventory: av1Inventory(),
		av1Qualification: av1Qualification('win-x64'),
	}), /same desktop target/iu);
});

test('complete target evidence admits dav1d decode and its exact qualified encoder', async () => {
	for (const target of DESKTOP_CODEC_TARGETS) {
		const provider = bundledAv1(target, 'svt-av1');
		assert.equal((await provider.preflight(AV1_DECODE, {})).disposition, 'supported');
		assert.equal(provider.resolve(AV1_DECODE)?.implementation, 'dav1d');
		assert.notEqual(provider.resolve(AV1_DECODE)?.implementation, 'libaom');
		assert.equal((await provider.preflight(AV1_ENCODE, {})).disposition, 'supported');
		assert.equal(provider.resolve(AV1_ENCODE)?.implementation, 'svt-av1');
	}
	const fallbackArm = bundledAv1('win-arm64', 'libaom');
	assert.equal(fallbackArm.resolve(AV1_ENCODE)?.implementation, 'libaom');

	const nonArmFallback = bundledAv1('win-x64', 'libaom');
	assert.equal((await nonArmFallback.preflight(AV1_ENCODE, {})).disposition, 'unsupported');
	const missingSelectedPayload = createBundledDesktopCodecProvider({
		target: 'win-arm64', capabilityGeneration: 'review-win-arm64-missing-payload',
		inventory: { libwebm: '1.0.0.32', dav1d: '1.5.4', 'svt-av1': '4.2.0' },
		av1Qualification: av1Qualification('win-arm64', { encoder: 'libaom' }),
	});
	assert.equal((await missingSelectedPayload.preflight(AV1_ENCODE, {})).disposition, 'unsupported');
});

test('AV1 decisions are bound to the exact codec versions measured by their benchmark', async () => {
	const versionDrift = createBundledDesktopCodecProvider({
		target: 'linux-x64', capabilityGeneration: 'review-version-drift',
		inventory: { ...av1Inventory(), dav1d: '1.5.5', 'svt-av1': '4.3.0' },
		av1Qualification: av1Qualification('linux-x64'),
	});
	assert.equal((await versionDrift.preflight(AV1_DECODE, {})).disposition, 'unsupported');
	assert.equal((await versionDrift.preflight(AV1_ENCODE, {})).disposition, 'unsupported');
});

test('OS providers expose only exact canary-qualified tuples and Linux stays unavailable', async () => {
	const capability = videoCapability('wmf-h264-canary', 'h264', 'main', 'nv12');
	const windows = createOperatingSystemDesktopCodecProvider({
		target: 'win-x64', osVersion: '10.0.26100', capabilityGeneration: 'canary-17',
		canaryQualifiedCapabilities: [{ capability, implementation: 'media-foundation-h264' }],
	});
	const exact = operation({
		direction: 'decode', mediaKind: 'video', container: 'mp4', codec: 'h264',
		profile: 'main', pixelFormat: 'nv12', width: 1_920, height: 1_080,
	});
	assert.equal((await windows.preflight(exact, {})).disposition, 'supported');
	assert.equal(windows.resolve(exact)?.implementation, 'media-foundation-h264');
	assert.equal((await windows.preflight(operation({ ...exact, profile: 'high' }), {})).disposition, 'unsupported');
	assert.equal((await windows.preflight(operation({ ...exact, width: 8_194 }), {})).disposition, 'unsupported');

	const linux = createOperatingSystemDesktopCodecProvider({
		target: 'linux-arm64', osVersion: '6.14', capabilityGeneration: 'canary-linux',
		canaryQualifiedCapabilities: [{ capability, implementation: 'must-not-leak' }],
	});
	assert.equal((await linux.preflight(exact, {})).disposition, 'unavailable');
	assert.equal(linux.capabilities.length, 0);
	assert.equal(linux.resolve(exact), null);
});

test('unknown audio decode geometry may select a ranged capability but encode remains exact', async () => {
	const range = Object.freeze({ minimum: 8_000, maximum: 192_000, multipleOf: 1 });
	const capability: DesktopCodecCapability = {
		id: 'wmf-mp3-source-geometry', direction: 'decode', mediaKind: 'audio',
		container: 'mp3', codec: 'mp3', profile: null, sampleFormat: 'f32', pixelFormat: null,
		sampleRate: range, channelCount: { minimum: 1, maximum: 2, multipleOf: 1 },
		width: null, height: null,
	};
	const provider = createOperatingSystemDesktopCodecProvider({
		target: 'win-x64', osVersion: '10.0.26100', capabilityGeneration: 'canary-audio',
		canaryQualifiedCapabilities: [{ capability, implementation: 'media-foundation-mp3' }],
	});
	const unresolved = operation({
		direction: capability.direction, mediaKind: capability.mediaKind,
		container: capability.container, codec: capability.codec, profile: capability.profile,
		sampleFormat: capability.sampleFormat, pixelFormat: capability.pixelFormat,
		sampleRate: null, channelCount: null, width: null, height: null,
	});
	assert.equal((await provider.preflight(unresolved, {})).disposition, 'supported');
	assert.equal((await provider.preflight({ ...unresolved, direction: 'encode' }, {})).disposition, 'unsupported');
});

test('external FFmpeg requires both an exact tuple and every probed implementation', async () => {
	const qualified = [{
		capability: { ...videoCapability('ffmpeg-av1', 'av1', 'main', 'yuv420p'), direction: 'encode' as const },
		implementation: 'libsvtav1',
		requires: { encoders: ['libsvtav1'], muxers: ['webm'], filters: ['scale'] },
	}] as const;
	const provider = createExternalFfmpegDesktopCodecProvider({
		target: 'mac-arm64', version: '9.0.1', capabilityGeneration: 'probe-sha256-abc',
		capabilitySets: {
			encoders: ['libsvtav1'], decoders: ['dav1d'], muxers: ['webm'],
			demuxers: ['webm'], filters: ['scale'],
		},
		qualifiedCapabilities: qualified,
	});
	const exact = operation({ ...AV1_ENCODE });
	assert.equal((await provider.preflight(exact, {})).disposition, 'supported');
	assert.equal(provider.resolve(exact)?.implementation, 'libsvtav1');
	assert.equal((await provider.preflight(operation({ ...exact, pixelFormat: 'yuv444p' }), {})).disposition, 'unsupported');

	const missingEncoder = createExternalFfmpegDesktopCodecProvider({
		target: 'mac-arm64', version: '9.0.1', capabilityGeneration: 'probe-sha256-def',
		capabilitySets: {
			encoders: ['libaom-av1'], decoders: [], muxers: ['webm'], demuxers: [], filters: ['scale'],
		},
		qualifiedCapabilities: qualified,
	});
	assert.equal((await missingEncoder.preflight(exact, {})).disposition, 'unsupported');
	assert.equal(missingEncoder.capabilities.length, 0);
});

test('provider identities and admitted capabilities are immutable copies', () => {
	const capabilities = [videoCapability('apple-hevc', 'hevc', 'main', 'p010le')];
	const provider = createOperatingSystemDesktopCodecProvider({
		target: 'mac-arm64', osVersion: '15.4', capabilityGeneration: 'canary-88',
		canaryQualifiedCapabilities: [{ capability: capabilities[0]!, implementation: 'video-toolbox-hevc' }],
	});
	capabilities.splice(0);
	assert.equal(provider.kind, 'operating-system');
	assert.equal(provider.id, 'operating-system-codecs-mac-arm64');
	assert.equal(provider.implementation, 'apple-audiotoolbox-avfoundation-videotoolbox');
	assert.equal(provider.version, '15.4');
	assert.equal(provider.capabilityGeneration, 'canary-88');
	assert.equal(provider.capabilities.length, 1);
	assert.equal(Object.isFrozen(provider), true);
	assert.equal(Object.isFrozen(provider.capabilities), true);
	assert.equal(Object.isFrozen(provider.capabilities[0]), true);
	assert.throws(() => {
		(provider as { version: string }).version = 'changed';
	}, TypeError);
});

function bundledAv1(
	target: typeof DESKTOP_CODEC_TARGETS[number], encoder: 'svt-av1' | 'libaom',
) {
	return createBundledDesktopCodecProvider({
		target, capabilityGeneration: `review-${target}`,
		inventory: av1Inventory(), av1Qualification: av1Qualification(target, { encoder }),
	});
}

function av1Inventory(): Partial<Record<BundledDesktopCodecComponent, string>> {
	return {
		libwebm: '1.0.0.32', dav1d: '1.5.4', 'svt-av1': '4.2.0', libaom: '3.14.1',
	};
}

function av1Qualification(
	target: typeof DESKTOP_CODEC_TARGETS[number],
	options: Readonly<{ complete?: boolean; encoder?: 'svt-av1' | 'libaom' }> = {},
): Av1TargetQualificationDecisionV1 {
	const complete = options.complete !== false;
	const encoder = options.encoder ?? 'svt-av1';
	const fallback = target === 'win-arm64';
	const operatingSystem: 'linux' | 'macos' | 'windows' = target.startsWith('linux-')
		? 'linux' : target.startsWith('win-') ? 'windows' : 'macos';
	const cpuArchitecture: 'x64' | 'arm64' = target.endsWith('-x64') ? 'x64' : 'arm64';
	const decision: Av1TargetQualificationDecisionV1 = {
		target,
		benchmark: {
			environment: {
				operatingSystem,
				operatingSystemVersion: '1.0.0', cpuModel: 'Synthetic-CPU',
				cpuArchitecture, logicalCoreCount: 8,
			},
			toolchain: {
				dav1d: { version: '1.5.4', buildSha256: 'a'.repeat(64) },
				libaom: { version: '3.14.1', buildSha256: 'b'.repeat(64) },
				'svt-av1': { version: '4.2.0', buildSha256: 'c'.repeat(64) },
				benchmarkHarnessSha256: 'd'.repeat(64),
			},
			encoderSettings: {
				settingsSha256: 'e'.repeat(64), threadCount: 8,
				svtAv1Preset: 'preset-8', libaomPreset: 'cpu-used-6',
			},
		},
		evidenceComplete: complete, evidenceCaseCount: complete ? 12 : 11,
		decode: {
			defaultCandidate: 'dav1d', comparedAgainst: 'libaom', admitted: complete,
			selected: complete ? 'dav1d' : null,
			failures: complete ? [] : ['incomplete-corpus-evidence'],
		},
		encode: {
			defaultCandidate: 'svt-av1', fallbackCandidate: fallback ? 'libaom' : null,
			admitted: complete, selected: complete ? encoder : null,
			defaultFailures: complete && encoder === 'svt-av1' ? [] : ['correctness-failed'],
			fallbackFailures: fallback ? [] : null,
		},
	};
	return Object.freeze(decision);
}

function videoCapability(
	id: string, codec: string, profile: string, pixelFormat: string,
): DesktopCodecCapability {
	return {
		id, direction: 'decode', mediaKind: 'video', container: codec === 'h264' ? 'mp4' : 'webm', codec,
		profile, sampleFormat: null, pixelFormat, sampleRate: null, channelCount: null,
		width: VIDEO_RANGE, height: VIDEO_RANGE,
	};
}

function operation(overrides: Partial<DesktopCodecOperation>): DesktopCodecOperation {
	return Object.freeze({
		direction: 'decode', mediaKind: 'audio', container: 'wav', codec: 'pcm', profile: null,
		sampleFormat: null, pixelFormat: null, sampleRate: null, channelCount: null,
		width: null, height: null, ...overrides,
	});
}
