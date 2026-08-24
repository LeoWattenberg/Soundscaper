/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	assertNativeImageSequenceRgba8DecodeCompatibility,
	NativeImageSequenceRgba8AdmissionError,
	type NativeImageSequenceRgba8RefusalCode,
} from '../src/common/editor/native-media-image-sequence-rgba8-admission.ts';

test('native image-sequence RGBA8 admission accepts only reported opaque sRGB/RGB/full sources', () => {
	assert.doesNotThrow(() => assertNativeImageSequenceRgba8DecodeCompatibility(source()));
});

test('native image-sequence RGBA8 admission refuses high precision and HDR with typed reasons', () => {
	for (const [name, value, code] of [
		['unreported depth', source({ bitDepth: null }), 'bit-depth-unreported'],
		['16-bit PNG', source({ bitDepth: 16, videoCodec: 'png' }), 'bit-depth-exceeds-rgba8'],
		['16-bit TIFF', source({ bitDepth: 16, videoCodec: 'tiff' }), 'bit-depth-exceeds-rgba8'],
		['float OpenEXR', source({ bitDepth: 32, videoCodec: 'exr' }), 'bit-depth-exceeds-rgba8'],
		['PQ OpenEXR', source({ videoCodec: 'exr', colour: colour({
			primaries: 'bt2020', transfer: 'smpte2084',
		}) }), 'hdr-transfer-unsupported'],
		['HLG OpenEXR', source({ videoCodec: 'exr', colour: colour({
			primaries: 'bt2020', transfer: 'arib-std-b67',
		}) }), 'hdr-transfer-unsupported'],
		['HDR metadata', source({ colour: colour({
			contentLight: { maximumContentLightLevel: 1_000, maximumFrameAverageLightLevel: 400 },
		}) }), 'hdr-metadata-unsupported'],
	] as const) {
		assertRefusal(name, value, code);
	}
});

test('native image-sequence RGBA8 admission refuses unreported or incompatible colour interpretation', () => {
	for (const [name, value, code] of [
		['unreported primaries', source({ colour: colour({ primaries: null }) }), 'colour-unreported'],
		['unreported transfer', source({ colour: colour({ transfer: null }) }), 'colour-unreported'],
		['unreported matrix', source({ colour: colour({ matrix: null }) }), 'colour-unreported'],
		['unreported range', source({ colour: colour({ range: null }) }), 'colour-unreported'],
		['wide gamut', source({ colour: colour({ primaries: 'bt2020' }) }), 'wide-gamut-unsupported'],
		['BT.709 primaries', source({ colour: colour({ primaries: 'bt709' }) }), 'colour-interpretation-unsupported'],
		['BT.709 transfer', source({ colour: colour({ transfer: 'bt709' }) }), 'colour-interpretation-unsupported'],
		['BT.709 matrix', source({ colour: colour({ matrix: 'bt709' }) }), 'colour-interpretation-unsupported'],
		['limited range', source({ colour: colour({ range: 'limited' }) }), 'colour-interpretation-unsupported'],
	] as const) {
		assertRefusal(name, value, code);
	}
});

test('native image-sequence RGBA8 admission refuses unknown or present alpha before decode', () => {
	assertRefusal('unreported alpha', source({ hasAlpha: null }), 'alpha-presence-unreported');
	assertRefusal('straight alpha', source({
		hasAlpha: true, alphaMode: 'straight', alphaInterpretation: 'transparency',
	}), 'alpha-decode-unsupported');
});

function assertRefusal(name: string, value: unknown, code: NativeImageSequenceRgba8RefusalCode): void {
	assert.throws(
		() => assertNativeImageSequenceRgba8DecodeCompatibility(value),
		(error: unknown) => error instanceof NativeImageSequenceRgba8AdmissionError
			&& error.code === code,
		name,
	);
}

function source(overrides: Readonly<Record<string, unknown>> = {}): Readonly<Record<string, unknown>> {
	return Object.freeze({
		backend: 'ffmpeg', codedWidth: 1, codedHeight: 1,
		hasAlpha: false, videoCodec: 'png', bitDepth: 8,
		pixelFormat: 'rgb24', chromaFormat: '4:4:4',
		alphaMode: null, alphaInterpretation: null,
		colour: colour(),
		...overrides,
	});
}

function colour(overrides: Readonly<Record<string, unknown>> = {}): Readonly<Record<string, unknown>> {
	return Object.freeze({
		primaries: 'srgb', transfer: 'iec61966-2-1', matrix: 'rgb', range: 'full',
		masteringDisplay: null, contentLight: null,
		...overrides,
	});
}
