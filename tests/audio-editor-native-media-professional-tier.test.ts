/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
	createUnreportedNativeMediaProfessionalCharacteristics,
	nativeMediaProfessionalCharacteristicsAreReported,
	NATIVE_MEDIA_BIT_DEPTHS,
	NativeMediaCharacteristicsError,
	normalizeNativeMediaProfessionalCharacteristics,
	resolveNativeMediaHdrClaim,
	type NativeMediaProfessionalCharacteristicsV1,
} from '../src/common/editor/native-media-professional-characteristics.ts';
import {
	evaluateNativeMediaProfileAdmission,
	nativeMediaProfile,
	NATIVE_MEDIA_IMAGE_SEQUENCE_MAXIMUM_PRESERVED_BIT_DEPTH,
	NATIVE_MEDIA_PROFESSIONAL_PROFILES,
	NATIVE_MEDIA_PROFILE_POLICY_ROW_IDS,
} from '../src/common/editor/native-media-professional-profiles.ts';

const ALL_ROWS = NATIVE_MEDIA_PROFILE_POLICY_ROW_IDS;

test('unreported professional characteristics report nothing at all', () => {
	const unreported = createUnreportedNativeMediaProfessionalCharacteristics();

	assert.equal(nativeMediaProfessionalCharacteristicsAreReported(unreported), false);
	assert.deepEqual(unreported, normalizeNativeMediaProfessionalCharacteristics(null));
	assert.equal(unreported.bitDepth, null);
	assert.equal(unreported.pixelFormat, null);
	assert.equal(unreported.colour.masteringDisplay, null);
	assert.equal(Object.hasOwn(unreported, 'professionalCharacteristics'), false);
	assert.deepEqual(resolveNativeMediaHdrClaim(unreported), {
		transfer: 'unreported', hdr10Metadata: false, wideGamut: false,
	});
});

test('an unrecognized transfer stays unreported rather than falling back to SDR', () => {
	assert.equal(claim({ colourTransfer: 'bt709' }).transfer, 'sdr');
	assert.equal(claim({ colourTransfer: 'smpte2084' }).transfer, 'pq');
	assert.equal(claim({ colourTransfer: 'arib-std-b67' }).transfer, 'hlg');
	assert.equal(claim({ colourTransfer: 'some-future-tag' }).transfer, 'unreported');
	assert.equal(claim({}).transfer, 'unreported');
});

test('a PQ transfer without ST 2086 and CTA-861.3 metadata is not HDR10', () => {
	const pqOnly = claim({ colourTransfer: 'smpte2084', colourPrimaries: 'bt2020' });
	assert.deepEqual(pqOnly, { transfer: 'pq', hdr10Metadata: false, wideGamut: true });

	const full = claim({
		colourTransfer: 'smpte2084',
		colourPrimaries: 'bt2020',
		masteringDisplay: masteringDisplay(),
		contentLight: { maximumContentLightLevel: 1_000, maximumFrameAverageLightLevel: 400 },
	});
	assert.deepEqual(full, { transfer: 'pq', hdr10Metadata: true, wideGamut: true });

	// PQ with Rec.709 primaries is PQ, but it is not a wide-gamut claim.
	assert.equal(claim({ colourTransfer: 'smpte2084', colourPrimaries: 'bt709' }).wideGamut, false);
});

test('mastering-display metadata is reported whole or not at all', () => {
	const partial = { ...masteringDisplay() } as Record<string, unknown>;
	delete partial.whitePoint;

	assert.throws(
		() => normalizeNativeMediaProfessionalCharacteristics({ masteringDisplay: partial }),
		/whole or not at all/u,
	);
	assert.throws(() => normalizeNativeMediaProfessionalCharacteristics({
		masteringDisplay: { ...masteringDisplay(), minimumLuminance: { num: 20_000, den: 10_000 }, maximumLuminance: { num: 1, den: 10_000 } },
	}), /minimum luminance exceeds its maximum/u);
	assert.throws(() => normalizeNativeMediaProfessionalCharacteristics({
		contentLight: { maximumContentLightLevel: 100, maximumFrameAverageLightLevel: 200 },
	}), /cannot exceed the maximum content light level/u);
});

test('luminance ordering is decided exactly, not on rounded cross-products', () => {
	const minimumLuminance = { num: 999_999_997, den: 999_999_999 };
	const maximumLuminance = { num: 999_999_995, den: 999_999_997 };

	assert.equal(
		minimumLuminance.num * maximumLuminance.den > maximumLuminance.num * minimumLuminance.den,
		false,
		'this pair only exercises the defect while its cross-products collide in double precision',
	);
	assert.equal(
		BigInt(minimumLuminance.num) * BigInt(maximumLuminance.den)
			> BigInt(maximumLuminance.num) * BigInt(minimumLuminance.den),
		true,
	);
	assert.throws(() => normalizeNativeMediaProfessionalCharacteristics({
		masteringDisplay: { ...masteringDisplay(), minimumLuminance, maximumLuminance },
	}), /minimum luminance exceeds its maximum/u);

	const equal = normalizeNativeMediaProfessionalCharacteristics({
		masteringDisplay: {
			...masteringDisplay(), minimumLuminance, maximumLuminance: { ...minimumLuminance },
		},
	});
	assert.deepEqual(equal.colour.masteringDisplay?.maximumLuminance, minimumLuminance);
});

test('probed colour and alpha facts are validated rather than coerced', () => {
	const characteristics = normalizeNativeMediaProfessionalCharacteristics({
		bitDepth: 10,
		pixelFormat: 'yuv422p10le',
		chromaFormat: '4:2:2',
		colourRange: 'limited',
		hasAlpha: true,
		alphaMode: 'premultiplied',
		alphaInterpretation: 'transparency',
	});

	assert.equal(characteristics.bitDepth, 10);
	assert.equal(characteristics.pixelFormat, 'yuv422p10le');
	assert.equal(nativeMediaProfessionalCharacteristicsAreReported(characteristics), true);
	assert.deepEqual([...NATIVE_MEDIA_BIT_DEPTHS], [8, 10, 12, 16, 32]);

	for (const [value, pattern] of [
		[{ bitDepth: 9 }, /bitDepth is unsupported/u],
		[{ chromaFormat: '4:1:1' }, /chromaFormat is unsupported/u],
		[{ colourRange: 'video' }, /range is unsupported/u],
		[{ alphaMode: 'associated' }, /alphaMode is unsupported/u],
		[{ hasAlpha: 'yes' }, /hasAlpha must be a boolean/u],
		[{ pixelFormat: 'yuv 422' }, /pixelFormat must be a bounded probe tag/u],
		[{ unknownKey: 1 }, /unsupported key unknownKey/u],
		[{ hasAlpha: false, alphaMode: 'straight' }, /without alpha cannot carry an alpha mode/u],
	] as const) {
		assert.throws(
			() => normalizeNativeMediaProfessionalCharacteristics(value),
			pattern,
		);
	}
	assert.throws(
		() => normalizeNativeMediaProfessionalCharacteristics({ masteringDisplay: 7 }),
		NativeMediaCharacteristicsError,
	);
});

test('the required professional baseline covers every named decode and encode row', () => {
	const ids = NATIVE_MEDIA_PROFESSIONAL_PROFILES.map((profile) => profile.id);

	assert.deepEqual(ids.filter((id) => id.startsWith('decode-')), [
		'decode-h264', 'decode-hevc', 'decode-vp9', 'decode-av1',
		'decode-prores', 'decode-dnxhr',
		'decode-png-sequence', 'decode-tiff-sequence', 'decode-openexr-sequence',
	]);
	assert.deepEqual(ids.filter((id) => id.startsWith('encode-')), [
		'encode-mp4-h264', 'encode-hevc-main10-hdr10', 'encode-hevc-main10-sdr',
		'encode-webm-vp9',
		'encode-mov-prores-proxy', 'encode-mov-prores-422-hq', 'encode-mov-prores-4444',
		'encode-mxf-dnxhr-hqx', 'encode-matroska-ffv1',
		'encode-png-sequence', 'encode-tiff-sequence', 'encode-openexr-sequence',
	]);
	assert.equal(new Set(ids).size, ids.length);
	assert.equal(NATIVE_MEDIA_PROFESSIONAL_PROFILES.every((profile) => profile.policyRowIds.length > 0), true);
});

test('image-sequence profiles disclose the selected RGBA8 SDR preservation ceiling', () => {
	assert.equal(NATIVE_MEDIA_IMAGE_SEQUENCE_MAXIMUM_PRESERVED_BIT_DEPTH, 8);
	for (const id of [
		'decode-png-sequence', 'decode-tiff-sequence', 'decode-openexr-sequence',
		'encode-png-sequence', 'encode-tiff-sequence', 'encode-openexr-sequence',
	]) {
		const profile = nativeMediaProfile(id);
		assert.equal(profile?.maximumBitDepth, 8, `${id} must not claim high-precision preservation`);
		assert.equal(profile?.preservesHdrMetadata, false, `${id} must not claim HDR preservation`);
		assert.equal(
			profile?.supportsAlpha, id.startsWith('encode-'),
			`${id} must report the selected decode/export alpha boundary`,
		);
	}
	for (const [profileId, bitDepth, colourTransfer, refusals] of [
		['decode-png-sequence', 16, 'bt709', ['bit-depth-not-preserved']],
		['decode-tiff-sequence', 16, 'bt709', ['bit-depth-not-preserved']],
		['decode-openexr-sequence', 32, 'smpte2084', [
			'bit-depth-not-preserved', 'hdr-metadata-not-preserved',
		]],
	] as const) {
		const verdict = evaluateNativeMediaProfileAdmission({
			profileId,
			source: source({
				bitDepth, chromaFormat: '4:4:4', hasAlpha: true,
				colourTransfer, colourPrimaries: colourTransfer === 'smpte2084' ? 'bt2020' : 'bt709',
			}),
			recordedLicensingRowIds: ALL_ROWS,
			requirements: { preserveBitDepth: true, preserveHdrMetadata: true },
		});
		assert.equal(verdict.admitted, false);
		assert.deepEqual(verdict.refusals, refusals);
	}
	const alpha = evaluateNativeMediaProfileAdmission({
		profileId: 'decode-png-sequence',
		source: source({
			bitDepth: 8, chromaFormat: '4:4:4', hasAlpha: true,
			colourPrimaries: 'bt709', colourTransfer: 'iec61966-2-1',
		}),
		recordedLicensingRowIds: ALL_ROWS,
		requirements: { preserveAlpha: true },
	});
	assert.deepEqual(alpha.refusals, ['alpha-not-preserved']);
});

test('every profile policy row retains a named distribution disposition', async () => {
	const matrix = JSON.parse(await readFile(
		new URL('../config/production-licensing-matrix.json', import.meta.url), 'utf8',
	)) as { nativeFormatPolicies: { id: string; status: string; blocker: string }[] };
	const rows = new Map(matrix.nativeFormatPolicies.map((row) => [row.id, row]));

	for (const rowId of ALL_ROWS) {
		const row = rows.get(rowId);
		assert.ok(row, `the licensing register is missing ${rowId}`);
		assert.equal(row.status, 'blocked', `${rowId} must name its distribution restriction`);
		assert.ok(row.blocker.length > 0, `${rowId} needs a named blocker`);
	}
});

test('unresolved licensing rows are metadata, not execution refusals', () => {
	const verdict = evaluateNativeMediaProfileAdmission({
		profileId: 'encode-mov-prores-4444',
		source: source({ bitDepth: 12, chromaFormat: '4:4:4', hasAlpha: true, colourTransfer: 'bt709' }),
	});

	assert.equal(verdict.admitted, true);
	assert.deepEqual(verdict.refusals, []);
	assert.deepEqual(verdict.unresolvedLicensingRowIds, [
		'codec-native-ffmpeg-current-set', 'codec-encode-prores-mov-4444',
	]);
});

test('an unknown profile is refused rather than treated as permissive', () => {
	const verdict = evaluateNativeMediaProfileAdmission({
		profileId: 'encode-mov-prores-8888',
		source: source({}),
		recordedLicensingRowIds: ALL_ROWS,
	});

	assert.deepEqual(verdict.refusals, ['profile-unknown']);
	assert.equal(nativeMediaProfile('encode-mov-prores-8888'), null);
});

test('a required bit depth, chroma, HDR, or alpha a profile cannot hold is refused up front', () => {
	const hdrAlpha = source({
		bitDepth: 12,
		chromaFormat: '4:4:4',
		hasAlpha: true,
		colourTransfer: 'smpte2084',
		colourPrimaries: 'bt2020',
		masteringDisplay: masteringDisplay(),
		contentLight: { maximumContentLightLevel: 1_000, maximumFrameAverageLightLevel: 400 },
	});
	const verdict = evaluateNativeMediaProfileAdmission({
		profileId: 'encode-mp4-h264',
		source: hdrAlpha,
		recordedLicensingRowIds: ALL_ROWS,
		requirements: {
			preserveBitDepth: true, preserveChroma: true,
			preserveHdrMetadata: true, preserveAlpha: true,
		},
	});

	assert.equal(verdict.admitted, false);
	assert.deepEqual(verdict.refusals, [
		'bit-depth-not-preserved',
		'chroma-not-preserved',
		'hdr-metadata-not-preserved',
		'alpha-not-preserved',
	]);
	assert.deepEqual(verdict.disclosures, []);
});

test('a profile that can hold every requirement is admitted', () => {
	const verdict = evaluateNativeMediaProfileAdmission({
		profileId: 'encode-mov-prores-4444',
		source: source({
			bitDepth: 12,
			chromaFormat: '4:4:4',
			hasAlpha: true,
			colourTransfer: 'smpte2084',
			colourPrimaries: 'bt2020',
			masteringDisplay: masteringDisplay(),
			contentLight: { maximumContentLightLevel: 1_000, maximumFrameAverageLightLevel: 400 },
		}),
		recordedLicensingRowIds: ALL_ROWS,
		requirements: {
			preserveBitDepth: true, preserveChroma: true,
			preserveHdrMetadata: true, preserveAlpha: true,
		},
	});

	assert.deepEqual(verdict, {
		admitted: true,
		profileId: 'encode-mov-prores-4444',
		refusals: [],
		disclosures: [],
		unresolvedLicensingRowIds: [],
	});
});

test('a loss the caller did not require is admitted but never silent', () => {
	const verdict = evaluateNativeMediaProfileAdmission({
		profileId: 'encode-mp4-h264',
		source: source({
			bitDepth: 12,
			chromaFormat: '4:4:4',
			hasAlpha: true,
			colourTransfer: 'smpte2084',
			colourPrimaries: 'bt2020',
		}),
		recordedLicensingRowIds: ALL_ROWS,
	});

	assert.equal(verdict.admitted, true);
	assert.deepEqual(verdict.disclosures, [
		'bit-depth-reduced', 'chroma-subsampled', 'hdr-metadata-dropped', 'alpha-dropped',
	]);
});

test('an unreported fact is disclosed, so alpha is never lost without saying so', () => {
	const verdict = evaluateNativeMediaProfileAdmission({
		profileId: 'encode-mp4-h264',
		source: createUnreportedNativeMediaProfessionalCharacteristics(),
		recordedLicensingRowIds: ALL_ROWS,
	});

	assert.equal(verdict.admitted, true);
	assert.deepEqual(verdict.disclosures, [
		'bit-depth-unreported', 'chroma-unreported', 'transfer-unreported', 'alpha-presence-unreported',
	]);
});

test('a requirement that probing cannot establish is refused, not assumed satisfied', () => {
	const verdict = evaluateNativeMediaProfileAdmission({
		profileId: 'encode-matroska-ffv1',
		source: createUnreportedNativeMediaProfessionalCharacteristics(),
		recordedLicensingRowIds: ALL_ROWS,
		requirements: { preserveBitDepth: true, preserveAlpha: true },
	});

	assert.equal(verdict.admitted, false);
	assert.deepEqual(verdict.refusals, ['bit-depth-not-preserved', 'alpha-not-preserved']);
});

test('HDR10 metadata probing established is disclosed even when the transfer tag is not', () => {
	const hdr10 = {
		bitDepth: 8,
		chromaFormat: '4:2:0',
		hasAlpha: false,
		colourPrimaries: 'bt2020',
		masteringDisplay: masteringDisplay(),
		contentLight: { maximumContentLightLevel: 1_000, maximumFrameAverageLightLevel: 400 },
	};

	for (const colourTransfer of ['vendor-log-3', null]) {
		const carrier = source({ ...hdr10, colourTransfer });
		assert.deepEqual(resolveNativeMediaHdrClaim(carrier), {
			transfer: 'unreported', hdr10Metadata: true, wideGamut: false,
		});

		const dropped = evaluateNativeMediaProfileAdmission({
			profileId: 'encode-mp4-h264',
			source: carrier,
			recordedLicensingRowIds: ALL_ROWS,
		});
		assert.equal(dropped.admitted, true);
		assert.deepEqual(dropped.disclosures, ['transfer-unreported', 'hdr-metadata-dropped']);

		const required = evaluateNativeMediaProfileAdmission({
			profileId: 'encode-mp4-h264',
			source: carrier,
			recordedLicensingRowIds: ALL_ROWS,
			requirements: { preserveHdrMetadata: true },
		});
		assert.equal(required.admitted, false);
		assert.deepEqual(required.refusals, ['hdr-metadata-not-preserved']);

		const held = evaluateNativeMediaProfileAdmission({
			profileId: 'encode-mov-prores-422-hq',
			source: carrier,
			recordedLicensingRowIds: ALL_ROWS,
		});
		assert.deepEqual(held.disclosures, ['transfer-unreported']);
	}
});

test('an SDR source loses nothing to a profile that carries no HDR metadata', () => {
	const verdict = evaluateNativeMediaProfileAdmission({
		profileId: 'encode-webm-vp9',
		source: source({ bitDepth: 8, chromaFormat: '4:2:0', hasAlpha: false, colourTransfer: 'bt709' }),
		recordedLicensingRowIds: ALL_ROWS,
		requirements: { preserveBitDepth: true, preserveChroma: true, preserveAlpha: true },
	});

	assert.deepEqual(verdict.refusals, []);
	assert.deepEqual(verdict.disclosures, []);
});

function claim(overrides: Record<string, unknown>) {
	return resolveNativeMediaHdrClaim(source(overrides));
}

function source(overrides: Record<string, unknown>): NativeMediaProfessionalCharacteristicsV1 {
	return normalizeNativeMediaProfessionalCharacteristics(overrides);
}

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
