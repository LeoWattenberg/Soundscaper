/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readMotionAeHostProperty, type MotionAePropertyHost, type MotionAePropertyReadHost } from '../src/common/editor/motion-ae-host-property.ts';
import { parseMotionAeShapeProfile, motionAeShapeStyle, type MotionAeShapeProfile } from '../src/common/editor/motion-ae-host-shape-profile.ts';
const host = { version: '25.0.1', buildNumber: 7, locale: 'en_US' };
const profile: MotionAeShapeProfile = { format: 'org.motionscaper.ae-shape-profile', version: 1, host, reviewed: true,
	mapping: { groupNormal: 81, fillNormal: 82, strokeNormal: 83, fillNonzero: 91, fillEvenodd: 92, capButt: 101, capRound: 102, capSquare: 103,
		joinMiter: 111, joinRound: 112, joinBevel: 113, pathForward: 121, pathReversed: 122 } };
test('Motion AE shape profile is closed, bounded and bound to exact reviewed host build and locale', () => {
	assert.deepEqual(parseMotionAeShapeProfile(JSON.stringify(profile), host), profile);
	for (const altered of [{ ...profile, reviewed: false }, { ...profile, extra: 'ignored?' }, { ...profile, host: { ...host, version: '25.0.2' } },
		{ ...profile, host: { ...host, buildNumber: 8 } }, { ...profile, host: { ...host, locale: 'de_DE' } },
		{ ...profile, mapping: { ...profile.mapping, capSquare: profile.mapping.capRound } }, { ...profile, mapping: { ...profile.mapping, groupNormal: 1.5 } }]) {
		assert.throws(() => parseMotionAeShapeProfile(JSON.stringify(altered), host), /profile/iu);
	}
	assert.throws(() => parseMotionAeShapeProfile(' '.repeat(8193), host), /budget/iu);
});
test('Motion AE named shape capture never infers raw style enums without the exact selected profile', () => {
	const read = (values: Record<string, number>) => (name: string) => values[name] ?? null;
	const fill = read({ 'ADBE Vector Blend Mode': 82, 'ADBE Vector Fill Rule': 91 });
	assert.deepEqual(motionAeShapeStyle('ADBE Vector Graphic - Fill', fill, null), { blendMode: 'unavailable', fillRule: 'unavailable' });
	assert.deepEqual(motionAeShapeStyle('ADBE Vector Graphic - Fill', fill, profile), { blendMode: 'normal', fillRule: 'nonzero' });
	assert.deepEqual(motionAeShapeStyle('ADBE Vector Graphic - Stroke', read({ 'ADBE Vector Blend Mode': 83, 'ADBE Vector Stroke Line Cap': 102, 'ADBE Vector Stroke Line Join': 113 }), profile),
		{ blendMode: 'normal', lineCap: 'round', lineJoin: 'bevel' });
	assert.deepEqual(motionAeShapeStyle('ADBE Vector Shape - Group', read({ 'ADBE Vector Shape Direction': 121 }), profile), { blendMode: 'unavailable', pathDirection: 'forward' });
	assert.deepEqual(motionAeShapeStyle('ADBE Vector Group', read({ 'ADBE Vector Blend Mode': 82 }), profile), { blendMode: 'unsupported' });
	assert.deepEqual(motionAeShapeStyle('ADBE Vector Graphic - Fill', read({}), profile), { blendMode: 'unavailable', fillRule: 'unavailable' });
});

test('Motion AE source property capture preserves vector switches without writing or assuming unavailable switches', () => {
	const raw = (matchName: string, value: number, children: MotionAePropertyHost[] = []): MotionAePropertyHost => ({
		name: matchName, matchName, propertyType: children.length ? 'group' : 'numeric', propertyValueType: 'number', numProperties: children.length, numKeys: 0,
		canSetEnabled: true, enabled: false, property: index => children[index - 1]!, valueAtTime: (_time, preExpression) => { assert.equal(preExpression, true); return value; },
		keyTime: () => 0, keyValue: () => 0, keyInInterpolationType: () => 'linear', keyOutInterpolationType: () => 'linear', keyInTemporalEase: () => [], keyOutTemporalEase: () => [],
		keyInSpatialTangent: () => [], keyOutSpatialTangent: () => [], keyRoving: () => false,
	});
	const child = raw('ADBE Vector Blend Mode', 81), source = raw('ADBE Vector Group', 0, [child]);
	const reader: MotionAePropertyReadHost = { kind: property => property.propertyType === 'group' ? 'group' : 'numeric', interpolation: () => 'linear', text: () => { throw new Error('No text'); }, checkCancelled: () => {},
		vector: item => motionAeShapeStyle(item.matchName, name => name === child.matchName ? 81 : null, profile) };
	const result = readMotionAeHostProperty(source, reader, 'layer', '', [], { properties: 0, keys: 0 }); assert.equal(result.kind, 'group');
	if (result.kind !== 'group') throw new Error('Expected group.'); assert.equal(result.enabled, false); assert.deepEqual(result.vectorStyle, { blendMode: 'normal' });
	const unavailable = readMotionAeHostProperty({ ...source, canSetEnabled: false }, { ...reader, vector: undefined }, 'layer', '', [], { properties: 0, keys: 0 });
	assert.equal(Object.hasOwn(unavailable, 'enabled'), false); assert.equal(Object.hasOwn(unavailable, 'vectorStyle'), false);
});
