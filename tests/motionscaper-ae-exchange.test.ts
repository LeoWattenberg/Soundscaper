/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { motionAeGaussianProfileFixture } from './helpers/motionscaper-ae-gaussian-fixture.ts';
import { normalizeMotionAeExchange, parseMotionAeExchange, serializeMotionAeExchange } from '../src/common/editor/motion-ae-exchange.ts';

function fixture(): Record<string, unknown> {
	return { format: 'org.motionscaper.ae-exchange', version: 1, transferId: 'transfer-one',
		producer: { application: 'after-effects', version: 'unqualified-test-host', bridgeVersion: '0.1.0' },
		source: { name: 'Original.aep', revisionDigest: null },
		color: { workingSpace: 'sRGB IEC61966-2.1', linearBlending: false, bitsPerChannel: 8 },
		footage: [], compositions: [{ id: 'comp-one', name: 'Composition', width: 64, height: 64, pixelAspect: 1,
			frameRate: 24, duration: 2, displayStartTime: 0, background: [0, 0, 0], layers: [] }], report: [] };
}
test('AE exchange round trips bounded immutable data without claiming an installed-AE qualification', () => {
	const source = fixture(), value = normalizeMotionAeExchange(source);
	assert.equal(value.producer.version, 'unqualified-test-host'); assert.ok(Object.isFrozen(value.compositions[0]));
	assert.deepEqual(parseMotionAeExchange(serializeMotionAeExchange(value)), value);
	assert.throws(() => normalizeMotionAeExchange({ ...source, version: 2 }), /version/u);
	assert.throws(() => normalizeMotionAeExchange({ ...source, importedScript: 'execute()' }), /unknown|unsupported/u);
	assert.equal(normalizeMotionAeExchange({ ...source, source: { name: 'Cafe\u0301.aep', revisionDigest: null } }).source.name, 'Cafe\u0301.aep');
});
test('AE package media paths remain relative, closed and unique before any filesystem operation', () => {
	const source = fixture();
	const item = { id: 'source-one', name: 'Picture', path: 'media/source-one.png', byteLength: 4, sha256: null,
		width: 64, height: 64, pixelAspect: 1, frameRate: 1, duration: 0, hasVideo: true, hasAudio: false, still: true };
	assert.equal(normalizeMotionAeExchange({ ...source, footage: [item] }).footage[0]!.path, item.path);
	for (const path of ['../source.png', '/source.png', 'C:/source.png', 'media/../source.png', 'media/a\\b.png', 'media/%2e%2e.png', 'media/.hidden', 'media/CON.png']) {
		assert.throws(() => normalizeMotionAeExchange({ ...source, footage: [{ ...item, path }] }), /path/u);
	}
	assert.throws(() => normalizeMotionAeExchange({ ...source, footage: [item, { ...item, id: 'source-two' }] }), /path/u);
	assert.throws(() => normalizeMotionAeExchange({ ...source, footage: [{ ...item, path: null }] }), /missing-media/u);
	assert.equal(normalizeMotionAeExchange({ ...source, footage: [{ ...item, path: null, byteLength: null }], report: [
		{ scopeId: item.id, propertyPath: '', status: 'unsupported', code: 'missing-media', message: 'Relink the original media before transfer.' },
	] }).footage[0]!.path, null);
});
test('AE property custody is inert, dimension checked and covered by a truthful expression report', () => {
	const source = fixture(), comp = (source.compositions as Record<string, unknown>[])[0]!;
	const property = { kind: 'numeric', matchName: 'ADBE Position', name: 'Position', value: [32, 32], spatial: true,
		keys: [], expression: { source: 'throw new Error("never execute")', enabled: true, disposition: 'unsupported' } };
	const layer = { id: 'layer-one', name: 'Control', kind: 'null', sourceId: null, parentId: null, matte: null,
		startTime: 0, inPoint: 0, outPoint: 2, stretch: 100, enabled: true, threeD: false, adjustment: false, blendMode: 'normal', properties: [property] };
	const report = [{ scopeId: layer.id, propertyPath: '0:ADBE Position', status: 'unsupported', code: 'expression', message: 'Sample or render this expression in After Effects.' }];
	const value = normalizeMotionAeExchange({ ...source, compositions: [{ ...comp, layers: [layer] }], report });
	assert.equal(value.compositions[0]!.layers[0]!.properties[0]!.kind, 'numeric');
	assert.throws(() => normalizeMotionAeExchange({ ...source, compositions: [{ ...comp, layers: [layer] }] }), /expression.*report/u);
	assert.throws(() => normalizeMotionAeExchange({ ...source, compositions: [{ ...comp, layers: [{ ...layer, properties: [property, property] }] }], report }), /expression.*report/u);
	assert.throws(() => normalizeMotionAeExchange({ ...source, compositions: [{ ...comp, layers: [{ ...layer, properties: [{ ...property, value: [1, 2, 3, 4, 5] }] }] }], report }), /value/u);
	assert.throws(() => normalizeMotionAeExchange({ ...source, compositions: [{ ...comp, layers: [{ ...layer, parentId: layer.id }] }], report }), /parent.*cycle/u);
});
test('AE exchange rejects oversized input, unresolved composition sources, and forged reports', () => {
	assert.throws(() => parseMotionAeExchange(' '.repeat(16_777_217)), /budget/u);
	assert.throws(() => normalizeMotionAeExchange({ ...fixture(), source: { name: 'x'.repeat(16_777_217), revisionDigest: null } }), /budget/u);
	const source = fixture();
	assert.throws(() => normalizeMotionAeExchange({ ...source, report: [{ scopeId: 'missing', propertyPath: '', status: 'rendered', code: 'bake', message: 'Done' }] }), /scope/u);
	assert.throws(() => normalizeMotionAeExchange({ ...source, report: [{ scopeId: 'comp-one', propertyPath: '', status: 'rendered', code: 'bake', message: 'Done' }] }), /rendered.*media/u);
});
test('AE color keys retain the single temporal ease documented for non-vector value types', () => {
	const source = fixture(), comp = (source.compositions as Record<string, unknown>[])[0]!;
	const color = [1, 0, 0, 1], ease = [{ speed: 0, influence: 33.333 }];
	const property = { kind: 'numeric', matchName: 'ADBE Vector Fill Color', name: 'Color', value: color, spatial: false, expression: null,
		keys: [{ time: 0, value: color, inInterpolation: 'bezier', outInterpolation: 'bezier', inEase: ease, outEase: ease, inSpatialTangent: null, outSpatialTangent: null, roving: false }] };
	const layer = { id: 'shape', name: 'Shape', kind: 'shape', sourceId: null, parentId: null, matte: null, startTime: 0, inPoint: 0, outPoint: 2, stretch: 100,
		enabled: true, threeD: false, adjustment: false, blendMode: 'normal', properties: [property] };
	assert.equal(normalizeMotionAeExchange({ ...source, compositions: [{ ...comp, layers: [layer] }] }).compositions[0]!.layers[0]!.properties[0]!.kind, 'numeric');
});

test('Motion AE Gaussian profile custody preserves optional absence and exact inert reviewed control closure', () => {
	const source = fixture(), gaussianProfile = motionAeGaussianProfileFixture();
	assert.equal(Object.hasOwn(normalizeMotionAeExchange(source), 'gaussianProfile'), false);
	const value = normalizeMotionAeExchange({ ...source, gaussianProfile });
	assert.deepEqual(parseMotionAeExchange(serializeMotionAeExchange(value)).gaussianProfile, gaussianProfile);
	assert.ok(Object.isFrozen(value.gaussianProfile?.controls));
	assert.throws(() => normalizeMotionAeExchange({ ...source, gaussianProfile: { ...gaussianProfile, reviewed: false } }), /review/iu);
});
