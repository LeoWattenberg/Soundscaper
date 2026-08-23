/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	applyManagedSdrGradePixelV1,
	applyManagedSdrGradeStackLinearPixelV1,
	applyManagedSdrGradeStackPixelV1,
	applyManagedSdrLinearGradeStackPixelV1,
	encodeManagedSdrLinearPixelV1,
	defaultVideoSourceColorInterpretationV1,
	normalizeVideoColorContextV1,
	normalizeVideoColorGradeV1,
	normalizeVideoSourceColorInterpretationV1,
	parseCubeLutV1,
	type LinearRgbaV1,
} from '../src/common/editor/video-color-management-v27.ts';

function close(actual: number, expected: number, tolerance = 1e-9): void {
	assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
}

test('unknown stills and videos receive disclosed, overrideable assumptions', () => {
	assert.deepEqual(defaultVideoSourceColorInterpretationV1('still', 'still-1'), {
		schemaVersion: 1,
		sourceId: 'still-1',
		sourceKind: 'still',
		primaries: 'srgb',
		transfer: 'srgb',
		matrix: 'rgb',
		range: 'full',
		provenance: 'default-still-srgb-full',
	});
	assert.deepEqual(defaultVideoSourceColorInterpretationV1('video', 'video-1'), {
		schemaVersion: 1,
		sourceId: 'video-1',
		sourceKind: 'video',
		primaries: 'bt709',
		transfer: 'bt709',
		matrix: 'bt709',
		range: 'limited',
		provenance: 'default-video-bt709-limited',
	});

	const override = normalizeVideoSourceColorInterpretationV1({
		...defaultVideoSourceColorInterpretationV1('video', 'video-1'),
		range: 'full',
		provenance: 'user-override',
	});
	assert.equal(override.range, 'full');
	assert.equal(Object.isFrozen(override), true);
});

test('the color context fixes one linear Rec.709 working and deterministic output space', () => {
	const context = normalizeVideoColorContextV1({
		schemaVersion: 1,
		sequenceId: 'sequence-1',
		workingSpace: 'linear-rec709-d65',
		outputSpace: 'srgb',
		alphaMode: 'straight-authored-premultiplied-working',
		toneMapping: 'none',
	});
	assert.deepEqual(context, {
		schemaVersion: 1,
		sequenceId: 'sequence-1',
		workingSpace: 'linear-rec709-d65',
		outputSpace: 'srgb',
		alphaMode: 'straight-authored-premultiplied-working',
		toneMapping: 'none',
	});
	assert.throws(() => normalizeVideoColorContextV1({ ...context, toneMapping: 'automatic' }), /tone|unsupported/iu);
});

test('managed SDR grading keeps straight alpha until its linear compositor', () => {
	const interpretation = defaultVideoSourceColorInterpretationV1('still', 'still-1');
	const grade = normalizeVideoColorGradeV1({
		schemaVersion: 1,
		exposureStops: 0,
		contrast: 1,
		pivot: 0.18,
		lift: [0, 0, 0],
		gamma: [1, 1, 1],
		gain: [1, 1, 1],
		saturation: 1,
		lut: null,
	});
	const result = applyManagedSdrGradePixelV1({
		rgba: [0.5, 0.5, 0.5, 0.25],
		interpretation,
		grade,
		outputSpace: 'linear-rec709-d65',
	});
	const expected = 0.21404114048223255;
	for (const channel of result.slice(0, 3)) close(channel, expected, 1e-12);
	close(result[3], 0.25);
	assert.equal(Object.isFrozen(result), true);
});

test('linear working pixels are encoded once without multiplying straight alpha', () => {
	const interpretation = defaultVideoSourceColorInterpretationV1('still', 'still-1');
	const linear = applyManagedSdrGradeStackLinearPixelV1({
		rgba: [0.5, 0.5, 0.5, 0.5], interpretation, grades: [],
	});
	close(linear[0], 0.21404114048223255, 1e-12);
	close(linear[3], 0.5);
	const encoded = encodeManagedSdrLinearPixelV1(linear, 'srgb');
	close(encoded[0], 0.5, 1e-12);
	close(encoded[3], 0.5);
	const raised = applyManagedSdrLinearGradeStackPixelV1({
		rgba: linear,
		grades: [{ ...normalizeVideoColorGradeV1(), exposureStops: 1 }],
	});
	close(raised[0], 0.4280822809644651, 1e-12);
	close(raised[3], 0.5);
});

test('the grade owns exposure, contrast/pivot, lift/gamma/gain, saturation, and a LUT reference', () => {
	const grade = normalizeVideoColorGradeV1({
		schemaVersion: 1,
		exposureStops: 1,
		contrast: 1,
		pivot: 0.18,
		lift: [0, 0, 0],
		gamma: [1, 1, 1],
		gain: [1, 1, 1],
		saturation: 0,
		lut: {
			storageKey: 'lut-sha256:' + 'a1'.repeat(32),
			sha256: 'a1'.repeat(32),
			byteLength: 128,
			size: 2,
			domainMin: [0, 0, 0],
			domainMax: [1, 1, 1],
		},
	});
	const result = applyManagedSdrGradePixelV1({
		rgba: [0.5, 0.25, 0.75, 1],
		interpretation: defaultVideoSourceColorInterpretationV1('still', 'still-1'),
		grade: { ...grade, lut: null },
		outputSpace: 'linear-rec709-d65',
	});
	close(result[0], result[1]);
	close(result[1], result[2]);
	assert.equal(grade.lut?.size, 2);
	assert.throws(() => normalizeVideoColorGradeV1({ ...grade, exposureStops: 13 }), /exposure/iu);
});

test('recognized HDR identity is retained but managed-SDR grading refuses without a transform', () => {
	const hdr = normalizeVideoSourceColorInterpretationV1({
		schemaVersion: 1,
		sourceId: 'hdr-1',
		sourceKind: 'video',
		primaries: 'bt2020',
		transfer: 'pq',
		matrix: 'bt2020-ncl',
		range: 'limited',
		provenance: 'metadata',
	});
	assert.equal(hdr.transfer, 'pq');
	assert.throws(() => applyManagedSdrGradePixelV1({
		rgba: [0.5, 0.5, 0.5, 1],
		interpretation: hdr,
		grade: normalizeVideoColorGradeV1(),
		outputSpace: 'srgb',
	}), /managed SDR|transform|HDR/iu);
});

test('bounded cube LUT parsing is deterministic and digest-bound', () => {
	const body = [
		'TITLE "identity"',
		'LUT_3D_SIZE 2',
		'DOMAIN_MIN 0 0 0',
		'DOMAIN_MAX 1 1 1',
		'0 0 0', '0 0 1', '0 1 0', '0 1 1',
		'1 0 0', '1 0 1', '1 1 0', '1 1 1',
	].join('\n');
	const parsed = parseCubeLutV1(body);
	assert.equal(parsed.size, 2);
	assert.equal(parsed.values.length, 24);
	assert.match(parsed.sha256, /^[a-f0-9]{64}$/u);
	assert.equal(Object.isFrozen(parsed), true);
	assert.throws(() => parseCubeLutV1(body.replace('LUT_3D_SIZE 2', 'LUT_3D_SIZE 129')), /size|bound/iu);
	assert.throws(() => parseCubeLutV1(`${body}\n0 0 0`), /entry|count/iu);
});

test('a verified cube LUT body is applied with deterministic trilinear sampling', () => {
	const body = [
		'LUT_3D_SIZE 2',
		'DOMAIN_MIN 0 0 0',
		'DOMAIN_MAX 1 1 1',
		'0 0 0', '0 0 1', '0 1 0', '0 1 1',
		'1 0 0', '1 0 1', '1 1 0', '1 1 1',
	].join('\n');
	const lut = parseCubeLutV1(body);
	const grade = normalizeVideoColorGradeV1({
		...normalizeVideoColorGradeV1(),
		lut: {
			storageKey: `lut-sha256:${lut.sha256}`,
			sha256: lut.sha256,
			byteLength: lut.byteLength,
			size: lut.size,
			domainMin: lut.domainMin,
			domainMax: lut.domainMax,
		},
	});
	const result = applyManagedSdrGradePixelV1({
		rgba: [0.25, 0.5, 0.75, 1],
		interpretation: defaultVideoSourceColorInterpretationV1('still', 'still-1'),
		grade,
		lut,
		outputSpace: 'linear-rec709-d65',
	});
	close(result[0], 0.05087608817155679, 1e-12);
	close(result[1], 0.21404114048223255, 1e-12);
	close(result[2], 0.5225215539683921, 1e-12);
	assert.throws(() => applyManagedSdrGradePixelV1({
		rgba: [0.25, 0.5, 0.75, 1],
		interpretation: defaultVideoSourceColorInterpretationV1('still', 'still-1'),
		grade: { ...grade, lut: { ...grade.lut!, sha256: 'b2'.repeat(32), storageKey: `lut-sha256:${'b2'.repeat(32)}` } },
		lut,
		outputSpace: 'srgb',
	}), /LUT.*digest|digest.*LUT/iu);
});

test('sRGB and Rec.709 outputs use named deterministic transfer functions', () => {
	const input: LinearRgbaV1 = Object.freeze([0.18, 0.18, 0.18, 1]);
	const grade = normalizeVideoColorGradeV1();
	const interpretation = defaultVideoSourceColorInterpretationV1('still', 'still-1');
	// Feed the encoded value that decodes to 0.18 so the output comparison is
	// solely between the two named output transfer functions.
	const encoded = 1.055 * Math.pow(0.18, 1 / 2.4) - 0.055;
	const srgb = applyManagedSdrGradePixelV1({
		rgba: [encoded, encoded, encoded, input[3]], interpretation, grade, outputSpace: 'srgb',
	});
	const rec709 = applyManagedSdrGradePixelV1({
		rgba: [encoded, encoded, encoded, input[3]], interpretation, grade, outputSpace: 'rec709',
	});
	close(srgb[0], encoded, 1e-12);
	assert.notEqual(srgb[0], rec709[0]);
});

test('a grade stack decodes once, applies each grade in linear working space, and encodes once', () => {
	const interpretation = defaultVideoSourceColorInterpretationV1('still', 'still-1');
	const oneStop = normalizeVideoColorGradeV1({
		...normalizeVideoColorGradeV1(), exposureStops: 1,
	});
	const encoded = 1.055 * Math.pow(0.1, 1 / 2.4) - 0.055;
	const result = applyManagedSdrGradeStackPixelV1({
		rgba: [encoded, encoded, encoded, 1], interpretation,
		grades: [oneStop, oneStop], outputSpace: 'linear-rec709-d65',
	});
	for (const channel of result.slice(0, 3)) close(channel, 0.4, 1e-12);
});
