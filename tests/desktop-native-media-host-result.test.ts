/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { parseNativeMediaHostControl } from '../desktop/native-media-host-result.ts';

const SHA256 = 'a'.repeat(64);
const PROFESSIONAL_CHARACTERISTICS = {
	backend: 'framescaper-media-host',
	codedWidth: 1920,
	codedHeight: 1080,
	rotationDegrees: null,
	pixelAspectRatio: { num: 1, den: 1 },
	fieldOrder: 'progressive',
	hasAlpha: true,
	videoCodec: 'prores',
	colour: {
		primaries: 'bt2020',
		transfer: 'smpte2084',
		matrix: 'bt2020nc',
		range: 'limited',
		masteringDisplay: {
			redPrimary: { x: { num: 34_000, den: 50_000 }, y: { num: 16_000, den: 50_000 } },
			greenPrimary: { x: { num: 13_250, den: 50_000 }, y: { num: 34_500, den: 50_000 } },
			bluePrimary: { x: { num: 7_500, den: 50_000 }, y: { num: 3_000, den: 50_000 } },
			whitePoint: { x: { num: 15_635, den: 50_000 }, y: { num: 16_450, den: 50_000 } },
			minimumLuminance: { num: 50, den: 10_000 },
			maximumLuminance: { num: 10_000_000, den: 10_000 },
		},
		contentLight: {
			maximumContentLightLevel: 1_000,
			maximumFrameAverageLightLevel: 400,
		},
	},
	audioStreams: [{ index: 1, codec: 'aac', channelCount: 2, sampleRate: 48_000, language: 'eng' }],
	extractedAudioStreamIndex: null,
	startTimecode: null,
	bitDepth: 10,
	pixelFormat: 'yuva444p10le',
	chromaFormat: '4:4:4',
	alphaMode: null,
	alphaInterpretation: null,
};

test('the media host admits only exact per-operation successful-control schemas', () => {
	assert.deepEqual(parseNativeMediaHostControl('probe-video-source', JSON.stringify({
		contractVersion: 1, operation: 'probe-video-source', format: 'mov,mp4',
		durationTimeBase: -9_223, videoStreams: 1, audioStreams: 1, width: 1920, height: 1080,
		characteristics: PROFESSIONAL_CHARACTERISTICS,
	})), {
		contractVersion: 1, operation: 'probe-video-source', format: 'mov,mp4',
		durationTimeBase: -9_223, videoStreams: 1, audioStreams: 1, width: 1920, height: 1080,
		characteristics: PROFESSIONAL_CHARACTERISTICS,
	});
	assert.deepEqual(parseNativeMediaHostControl('media-decode', JSON.stringify({
		contractVersion: 1, operation: 'media-decode',
		framePack: 'framescaper-rgba-frame-pack-v1', frameCount: 4,
		width: 640, height: 360, byteLength: 128, sha256: SHA256,
	})), {
		contractVersion: 1, operation: 'media-decode',
		framePack: 'framescaper-rgba-frame-pack-v1', frameCount: 4,
		width: 640, height: 360, byteLength: 128, sha256: SHA256,
	});
	for (const operation of ['media-encode', 'media-render'] as const) {
		assert.deepEqual(parseNativeMediaHostControl(operation, JSON.stringify({
			contractVersion: 1, operation, byteLength: 128, sha256: SHA256,
		})), { contractVersion: 1, operation, byteLength: 128, sha256: SHA256 });
	}
	assert.deepEqual(parseNativeMediaHostControl('media-render', JSON.stringify({
		contractVersion: 1, operation: 'media-render', profileId: 'encode-png-sequence',
		frameCount: 4, byteLength: 128, manifestSha256: SHA256,
		publication: 'temporary-directory',
	})), {
		contractVersion: 1, operation: 'media-render', profileId: 'encode-png-sequence',
		frameCount: 4, byteLength: 128, manifestSha256: SHA256,
		publication: 'temporary-directory',
	});
	assert.deepEqual(parseNativeMediaHostControl('media-proxy', JSON.stringify({
		contractVersion: 1, operation: 'media-proxy', container: 'mov', codec: 'prores_ks',
		profile: 'proxy', width: 960, height: 540, exportAuthority: 'original',
		byteLength: 128, sha256: SHA256,
	})), {
		contractVersion: 1, operation: 'media-proxy', container: 'mov', codec: 'prores_ks',
		profile: 'proxy', width: 960, height: 540, exportAuthority: 'original',
		byteLength: 128, sha256: SHA256,
	});
});

test('wrong operations, extra keys, invalid geometry, and malformed digests fail closed', () => {
	const render = {
		contractVersion: 1, operation: 'media-render', byteLength: 128, sha256: SHA256,
	};
	assert.throws(() => parseNativeMediaHostControl('media-encode', JSON.stringify(render)), /malformed/u);
	assert.throws(() => parseNativeMediaHostControl(
		'media-render', JSON.stringify({ ...render, ignored: true }),
	), /malformed/u);
	assert.throws(() => parseNativeMediaHostControl('media-proxy', JSON.stringify({
		contractVersion: 1, operation: 'media-proxy', container: 'mov', codec: 'prores_ks',
		profile: 'proxy', width: 0, height: 540, exportAuthority: 'original',
		byteLength: 128, sha256: SHA256,
	})), /malformed/u);
	assert.throws(() => parseNativeMediaHostControl(
		'media-render', JSON.stringify({ ...render, sha256: SHA256.toUpperCase() }),
	), /malformed/u);
	assert.throws(() => parseNativeMediaHostControl('media-render', JSON.stringify({
		contractVersion: 1, operation: 'media-render', profileId: 'encode-png-sequence',
		frameCount: 4, byteLength: 128, manifestSha256: SHA256, sha256: SHA256,
		publication: 'temporary-directory',
	})), /malformed/u);
	const probe = {
		contractVersion: 1, operation: 'probe-video-source', format: 'mov,mp4',
		durationTimeBase: 1, videoStreams: 1, audioStreams: 1, width: 1920, height: 1080,
		characteristics: PROFESSIONAL_CHARACTERISTICS,
	};
	assert.throws(() => parseNativeMediaHostControl(
		'probe-video-source', JSON.stringify({ ...probe, characteristics: {
			...PROFESSIONAL_CHARACTERISTICS, guessedField: 'bt709',
		} }),
	), /malformed/u);
	assert.throws(() => parseNativeMediaHostControl(
		'probe-video-source', JSON.stringify({ ...probe, characteristics: {
			...PROFESSIONAL_CHARACTERISTICS, bitDepth: 9,
		} }),
	), /malformed/u);
	const { bitDepth: _omitted, ...incomplete } = PROFESSIONAL_CHARACTERISTICS;
	assert.throws(() => parseNativeMediaHostControl(
		'probe-video-source', JSON.stringify({ ...probe, characteristics: incomplete }),
	), /malformed/u);
	assert.throws(() => parseNativeMediaHostControl(
		'probe-video-source', JSON.stringify({ ...probe, width: 1280 }),
	), /malformed/u);
});
