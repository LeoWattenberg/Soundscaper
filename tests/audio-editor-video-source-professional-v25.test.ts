/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createUnreportedVideoSourceCharacteristicsV25,
	normalizeVideoSourceCharacteristicsV25,
	resolveVideoSourceHdrClaimV25,
	videoSourceCharacteristicsV25AreReported,
} from '../src/common/editor/video-source-professional-characteristics-v25.ts';

test('V25 extends the existing source-characteristics record instead of carrying a second record', () => {
	const characteristics = normalizeVideoSourceCharacteristicsV25({
		backend: 'framescaper-media-host',
		codedWidth: 3_840,
		codedHeight: 2_160,
		hasAlpha: true,
		bitDepth: 12,
		pixelFormat: 'gbrap12le',
		chromaFormat: '4:4:4',
		alphaMode: 'straight',
		alphaInterpretation: 'transparency',
		colour: {
			primaries: 'bt2020',
			transfer: 'smpte2084',
			matrix: 'bt2020nc',
			range: 'full',
			masteringDisplay: masteringDisplay(),
			contentLight: {
				maximumContentLightLevel: 1_000,
				maximumFrameAverageLightLevel: 400,
			},
		},
	});

	assert.equal(characteristics.backend, 'framescaper-media-host');
	assert.equal(characteristics.bitDepth, 12);
	assert.equal(characteristics.colour.transfer, 'smpte2084');
	assert.equal(characteristics.hasAlpha, true);
	assert.equal(Object.hasOwn(characteristics, 'professionalCharacteristics'), false);
	assert.equal(videoSourceCharacteristicsV25AreReported(characteristics), true);
	assert.deepEqual(resolveVideoSourceHdrClaimV25(characteristics), {
		transfer: 'pq', hdr10Metadata: true, wideGamut: true,
	});
});

test('unreported V25 facts stay null and are never guessed', () => {
	const value = createUnreportedVideoSourceCharacteristicsV25();

	assert.equal(value.bitDepth, null);
	assert.equal(value.pixelFormat, null);
	assert.equal(value.chromaFormat, null);
	assert.equal(value.colour.transfer, null);
	assert.equal(value.colour.masteringDisplay, null);
	assert.equal(value.hasAlpha, null);
	assert.equal(resolveVideoSourceHdrClaimV25(value).transfer, 'unreported');
	assert.equal(videoSourceCharacteristicsV25AreReported(value), false);
});

test('V25 professional source facts are closed, exact, and internally consistent', () => {
	for (const [value, pattern] of [
		[{ bitDepth: 9 }, /bitDepth is unsupported/u],
		[{ chromaFormat: '4:1:1' }, /chromaFormat is unsupported/u],
		[{ pixelFormat: 'yuv 420' }, /pixelFormat must be a bounded probe tag/u],
		[{ hasAlpha: false, alphaMode: 'straight' }, /without alpha cannot carry/u],
		[{ futureProfessionalRecord: {} }, /unsupported key futureProfessionalRecord/u],
		[{ colour: { masteringDisplay: { redPrimary: {} } } }, /whole or not at all/u],
	] as const) {
		assert.throws(() => normalizeVideoSourceCharacteristicsV25(value), pattern);
	}
});

test('mastering luminance ordering uses exact integer cross-products', () => {
	const minimumLuminance = { num: 999_999_997, den: 999_999_999 };
	const maximumLuminance = { num: 999_999_995, den: 999_999_997 };
	assert.equal(
		minimumLuminance.num * maximumLuminance.den
			> maximumLuminance.num * minimumLuminance.den,
		false,
	);
	assert.throws(() => normalizeVideoSourceCharacteristicsV25({
		colour: {
			masteringDisplay: { ...masteringDisplay(), minimumLuminance, maximumLuminance },
		},
	}), /minimum luminance exceeds its maximum/u);
});

function masteringDisplay() {
	return {
		redPrimary: { x: { num: 34_000, den: 50_000 }, y: { num: 16_000, den: 50_000 } },
		greenPrimary: { x: { num: 13_250, den: 50_000 }, y: { num: 34_500, den: 50_000 } },
		bluePrimary: { x: { num: 7_500, den: 50_000 }, y: { num: 3_000, den: 50_000 } },
		whitePoint: { x: { num: 15_635, den: 50_000 }, y: { num: 16_450, den: 50_000 } },
		minimumLuminance: { num: 50, den: 10_000 },
		maximumLuminance: { num: 10_000_000, den: 10_000 },
	};
}
