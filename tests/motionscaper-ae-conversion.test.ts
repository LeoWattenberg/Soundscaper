/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { convertMotionscaperAeExchange } from '../src/motionscaper/editor-ae-conversion.ts';
import type { MotionAeExchange, MotionAeLayer } from '../src/common/editor/motion-ae-exchange-types.ts';
import type { MotionAsset } from '../src/common/editor/motion-asset.ts';
const asset: MotionAsset = { kind: 'image', id: 'new-asset', name: 'Picture', width: 64, height: 64, hasAlpha: true,
	mimeType: 'image/png', byteLength: 4, sha256: 'a'.repeat(64), storageKey: `motion-sha256:${'a'.repeat(64)}` };
function layer(id: string, parentId: string | null = null): MotionAeLayer {
	return { id, name: id, kind: 'footage', sourceId: 'picture', parentId, matte: null, startTime: 1, inPoint: 1, outPoint: 2, stretch: 100,
		enabled: true, threeD: false, adjustment: false, blendMode: 'normal', properties: [{ kind: 'group', name: 'Transform', matchName: 'ADBE Transform Group', children: [
			{ kind: 'numeric', name: 'Position', matchName: 'ADBE Position', value: [32, 40], spatial: true, keys: [], expression: null },
			{ kind: 'numeric', name: 'Scale', matchName: 'ADBE Scale', value: [50, 150], spatial: false, keys: [], expression: null },
		] }] };
}
function fixture(): MotionAeExchange {
	return { format: 'org.motionscaper.ae-exchange', version: 1, transferId: 'source-transfer', producer: { application: 'after-effects', version: 'unqualified', bridgeVersion: '0.1.0' },
		source: { name: 'Cafe\u0301.aep', revisionDigest: null }, color: { workingSpace: 'sRGB IEC61966-2.1', linearBlending: true, bitsPerChannel: 32 },
		footage: [{ id: 'picture', name: 'Picture', path: 'media/picture.png', sha256: asset.sha256, byteLength: asset.byteLength, width: 64, height: 64, pixelAspect: 1, frameRate: 1, duration: 0, hasVideo: true, hasAudio: false, still: true }],
		compositions: [{ id: 'comp', name: 'Scene', width: 64, height: 64, pixelAspect: 1, frameRate: 24, duration: 2, displayStartTime: 0, background: [0, 0, 0], layers: [layer('front', 'back'), layer('back')] }], report: [] };
}
function options() { let serial = 0; return { projectId: 'new-project', allocateId: () => `new-${String(++serial)}`, bindings: [{ footageId: 'picture', asset }] }; }
test('AE conversion creates independent Motion identities with layer order, parent links and explicit units intact', () => {
	const source = fixture(), result = convertMotionscaperAeExchange(source, options());
	assert.equal(result.project.id, 'new-project'); assert.equal(result.project.title, 'Café.aep'); assert.equal(result.exchange.source.name, 'Cafe\u0301.aep');
	const comp = result.project.compositions[0]!, front = comp.layers[0]!, back = comp.layers[1]!;
	assert.equal(comp.durationFrames, 48); assert.equal(front.name, 'front'); assert.equal(back.name, 'back'); assert.equal(front.parentId, back.id);
	assert.deepEqual(front.transform.position.value, [32, 40, 0]); assert.deepEqual(front.transform.scale.value, [0.5, 1.5, 1]);
	assert.deepEqual(front.inFrame, { num: 24, den: 1 }); assert.deepEqual(front.startFrame, { num: 0, den: 1 });
	assert.deepEqual(front.sourceStart, { num: -1, den: 1 }); assert.equal(front.kind, 'image');
	assert.notEqual(front.id, source.compositions[0]!.layers[0]!.id); assert.equal(source.compositions[0]!.layers[0]!.startTime, 1);
	assert.equal(result.requiresAcknowledgement, true); assert.ok(result.report.some((entry) => entry.code === 'qualification'));
});
test('AE conversion retains unsupported layers as named nulls and reports missing media without inventing content', () => {
	const source = fixture(), comp = source.compositions[0]!;
	const altered = { ...source, compositions: [{ ...comp, layers: [{ ...layer('shape'), kind: 'shape' as const, sourceId: null, properties: [] }, layer('missing')] }] };
	const result = convertMotionscaperAeExchange(altered, { ...options(), bindings: [] });
	assert.deepEqual(result.project.compositions[0]!.layers.map((entry) => entry.kind), ['null', 'null']);
	assert.ok(result.report.some((entry) => entry.scopeId === 'shape' && entry.code === 'layer-kind' && entry.status === 'unsupported'));
	assert.ok(result.report.some((entry) => entry.scopeId === 'missing' && entry.code === 'missing-media'));
	assert.deepEqual(result.project.assets, []);
});
test('AE conversion refuses forged media bindings and duplicate destination identity', () => {
	assert.throws(() => convertMotionscaperAeExchange(fixture(), { ...options(), bindings: [{ footageId: 'picture', asset: { ...asset, byteLength: 5 } }] }), /media.*binding/iu);
	assert.throws(() => convertMotionscaperAeExchange(fixture(), { ...options(), allocateId: () => 'duplicate' }), /identity/iu);
	assert.throws(() => convertMotionscaperAeExchange(fixture(), { ...options(), bindings: [{ footageId: 'absent', asset }] }), /media.*binding/iu);
});
test('AE conversion refuses animated or sequence footage represented by a single decoded still', () => {
	const source = fixture(); assert.throws(() => convertMotionscaperAeExchange({ ...source, footage: source.footage.map(item => ({ ...item, still: false, duration: 2, frameRate: 24 })) }, options()), /media.*binding/iu);
});
test('AE conversion admits complete retained samples and reports partial sample ranges before property mapping', () => {
	const source = fixture(), comp = source.compositions[0]!, original = layer('sampled');
	const group = original.properties[0]!; if (group.kind !== 'group') throw new Error('Expected group');
	const position = group.children[0]!; if (position.kind !== 'numeric') throw new Error('Expected position');
	const exchange = (frameRate: number): MotionAeExchange => ({ ...source, compositions: [{ ...comp, layers: [{ ...original, properties: [{ ...group, children: [
		{ ...position, samples: { frameRate, firstFrame: 0, values: [[1, 2], [3, 4], [5, 6]] } },
	] }] }] }], report: [{ scopeId: original.id, propertyPath: '0:ADBE Transform Group/0:ADBE Position', status: 'sampled', code: 'frame-sampling', message: 'Explicit AE samples' }] });
	const complete = convertMotionscaperAeExchange(exchange(1), options());
	assert.deepEqual(complete.project.compositions[0]!.layers[0]!.transform.position.value, [1, 2, 0]);
	const partial = convertMotionscaperAeExchange(exchange(24), options());
	assert.deepEqual(partial.project.compositions[0]!.layers[0]!.transform.position.value, [0, 0, 0]);
	assert.ok(partial.report.some((entry) => entry.status === 'unsupported' && /do not cover/u.test(entry.message)));
});

test('AE conversion recognizes the official spaced rotation match name', () => {
	const source = fixture(), comp = source.compositions[0]!, original = layer('rotated');
	const result = convertMotionscaperAeExchange({ ...source, compositions: [{ ...comp, layers: [{ ...original,
		properties: [{ kind: 'group', name: 'Transform', matchName: 'ADBE Transform Group', children: [
			{ kind: 'numeric', name: 'Rotation', matchName: 'ADBE Rotate Z', value: [37], spatial: false, keys: [], expression: null },
		] }],
	}] }] }, options());
	assert.deepEqual(result.project.compositions[0]!.layers[0]!.transform.rotation.value, [0, 0, 37]);
});
