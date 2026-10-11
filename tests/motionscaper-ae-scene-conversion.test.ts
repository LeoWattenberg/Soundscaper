/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { convertMotionAeSceneLayer, exportMotionAeSceneLayer } from '../src/common/editor/motion-ae-scene-conversion.ts';
import { normalizeMotionAeExchange } from '../src/common/editor/motion-ae-exchange.ts';
import type { MotionAeExchange, MotionAeLayer, MotionAeProperty, MotionAeReportEntry } from '../src/common/editor/motion-ae-exchange-types.ts';
import { createMotionLayer } from '../src/motionscaper/editor-project.ts';
import { compileMotionProperty } from '../src/common/editor/motion-property-evaluation.ts';
import { motionScalar, motionVector } from '../src/common/editor/motion-property.ts';

const rate = { num: 24, den: 1 }, options = { scene: { colorSpace: 'srgb' as const } };
function numeric(matchName: string, value: readonly number[]): MotionAeProperty { return { kind: 'numeric', matchName, name: matchName, value, spatial: false, keys: [], expression: null }; }
function group(matchName: string, children: readonly MotionAeProperty[]): MotionAeProperty { return { kind: 'group', matchName, name: matchName, children }; }
function camera(): MotionAeLayer {
	return { id: 'camera', name: 'Reviewed camera', kind: 'camera', sourceId: null, parentId: null, matte: null, startTime: 0, inPoint: 0, outPoint: 1, stretch: 100,
		enabled: true, threeD: true, adjustment: false, blendMode: 'normal', scene: { autoOrient: 'none' }, properties: [
			group('ADBE Transform Group', [numeric('ADBE Position', [32, 24, -100]), numeric('ADBE Orientation', [0, 0, 0]), numeric('ADBE Rotate X', [0]), numeric('ADBE Rotate Y', [0]), numeric('ADBE Rotate Z', [12])]),
			group('ADBE Camera Options Group', [numeric('ADBE Camera Zoom', [100]), numeric('ADBE Camera Depth of Field', [0]), numeric('ADBE Camera Focus Distance', [100]), numeric('ADBE Camera Aperture', [10])]),
		] };
}
function exchange(layer: MotionAeLayer): MotionAeExchange {
	return { format: 'org.motionscaper.ae-exchange', version: 1, transferId: 'transfer', producer: { application: 'after-effects', version: '24.6', bridgeVersion: '0.1.0' },
		source: { name: 'Scene', revisionDigest: null }, color: { workingSpace: '', linearBlending: true, bitsPerChannel: 32 }, footage: [], report: [],
		compositions: [{ id: 'comp', name: 'Scene', width: 64, height: 48, pixelAspect: 1, frameRate: 24, duration: 1, displayStartTime: 0, background: [0, 0, 0], layers: [layer] }] };
}
function replace(layer: MotionAeLayer, matchName: string, property: MotionAeProperty): MotionAeLayer {
	return { ...layer, properties: layer.properties.map(root => root.kind !== 'group' ? root : { ...root, children: root.children.map(child => child.matchName === matchName ? property : child) }) };
}
test('Motion AE scene custody preserves absent legacy metadata and closes camera/light SDK names', () => {
	const layer = camera(), { scene: _scene, ...legacy } = layer;
	assert.equal(Object.hasOwn(normalizeMotionAeExchange(exchange(legacy)).compositions[0]!.layers[0]!, 'scene'), false);
	assert.deepEqual(normalizeMotionAeExchange(exchange(layer)).compositions[0]!.layers[0]!.scene, { autoOrient: 'none' });
	for (const scene of [{ autoOrient: 'guess' }, { autoOrient: 'none', lightType: 'ambient' }, { autoOrient: 'none', arbitrary: true }]) {
		assert.throws(() => normalizeMotionAeExchange(exchange({ ...layer, scene } as unknown as MotionAeLayer)));
	}
});
test('Motion AE one-node camera preserves pixel zoom and spatial placement with explicit inactive DOF and clip-plane report', () => {
	const report: MotionAeReportEntry[] = [], mapped = convertMotionAeSceneLayer(camera(), rate, options, report);
	assert.ok(mapped); assert.equal(mapped.content.kind, 'camera'); if (mapped.content.kind !== 'camera') throw new Error('Expected camera.');
	assert.equal(mapped.content.zoom.value, 100); assert.equal(mapped.content.focusDistance.value, 100); assert.equal(mapped.content.aperture.value, 0);
	assert.deepEqual(mapped.transform.position.value, [32, 24, -100]); assert.deepEqual(mapped.transform.rotation.value, [0, 0, 12]);
	assert.ok(report.some(entry => entry.code === 'scene-renderer-differences' && entry.status === 'unsupported'));
	const layer = { ...createMotionLayer({ id: 'motion-camera', name: 'Camera', durationFrames: 24, content: mapped.content }), is3D: true, transform: mapped.transform };
	const reversed = exportMotionAeSceneLayer(layer, rate, options, report); assert.ok(reversed);
	const imported = convertMotionAeSceneLayer({ ...camera(), scene: reversed.scene, properties: reversed.properties }, rate, options, []); assert.deepEqual(imported?.content, mapped.content); assert.deepEqual(imported?.transform, mapped.transform);
});
test('Motion AE camera refuses missing review, point of interest, parent, DOF, tilted orientation and invalid zoom instead of silently approximating', () => {
	assert.equal(convertMotionAeSceneLayer(camera(), rate, {}, []), null);
	for (const source of [{ ...camera(), scene: undefined }, { ...camera(), scene: { autoOrient: 'point-of-interest' as const } }, { ...camera(), parentId: 'parent' },
		replace(camera(), 'ADBE Camera Depth of Field', numeric('ADBE Camera Depth of Field', [1])), replace(camera(), 'ADBE Orientation', numeric('ADBE Orientation', [0, 90, 0])),
		replace(camera(), 'ADBE Camera Zoom', numeric('ADBE Camera Zoom', [0]))]) {
		const report: MotionAeReportEntry[] = []; assert.equal(convertMotionAeSceneLayer(source, rate, options, report), null); assert.ok(report.some(entry => entry.status === 'unsupported'));
	}
});
test('Motion AE ambient light maps explicit color interpretation and percent intensity', () => {
	const source: MotionAeLayer = { ...camera(), kind: 'light', scene: { autoOrient: 'none', lightType: 'ambient' }, properties: [camera().properties[0]!, group('ADBE Light Options Group', [numeric('ADBE Light Color', [0.5, 0.25, 1, 1]), numeric('ADBE Light Intensity', [200])])] };
	const mapped = convertMotionAeSceneLayer(source, rate, options, []); assert.ok(mapped); assert.equal(mapped.content.kind, 'light'); if (mapped.content.kind !== 'light') throw new Error('Expected light.');
	assert.equal(mapped.content.lightType, 'ambient'); assert.equal(mapped.content.intensity.value, 2); assert.ok(mapped.content.color.value[0] > 0.214 && mapped.content.color.value[0] < 0.215);
	const layer = { ...createMotionLayer({ id: 'ambient', name: 'Ambient', durationFrames: 24, content: mapped.content }), is3D: true, transform: mapped.transform };
	if (layer.kind !== 'light') throw new Error('Expected light.');
	const exported = exportMotionAeSceneLayer(layer, rate, options, []); assert.ok(exported); assert.deepEqual(exported.scene, { autoOrient: 'none', lightType: 'ambient' });
	const again = convertMotionAeSceneLayer({ ...source, properties: exported.properties }, rate, options, []); assert.ok(again); assert.deepEqual(again.content, mapped.content);
	assert.equal(exportMotionAeSceneLayer({ ...layer, lightType: 'point' }, rate, options, []), null);
	assert.equal(exportMotionAeSceneLayer({ ...layer, castsShadows: true }, rate, options, []), null);
});
test('Motion AE scene reverse refuses tilted, scaled, parented, orthographic and finite-aperture cameras', () => {
	const content = { kind: 'camera' as const, projection: 'perspective' as const, zoom: motionScalar(100), near: 0.1, far: 1e7, focusDistance: motionScalar(100), aperture: motionScalar(0) };
	const base = { ...createMotionLayer({ id: 'camera', name: 'Camera', durationFrames: 24, content }), is3D: true };
	for (const layer of [{ ...base, parentId: 'parent' }, { ...base, projection: 'orthographic' as const }, { ...base, aperture: motionScalar(1) },
		{ ...base, transform: { ...base.transform, rotation: motionVector([0, 90, 0]) } }, { ...base, transform: { ...base.transform, scale: motionVector([2, 2, 2]) } }]) assert.equal(exportMotionAeSceneLayer(layer, rate, options, []), null);
});

test('Motion AE camera hold-linear zoom keys retain frame timing and refuse overshoot or sampled authority', () => {
	const base = numeric('ADBE Camera Zoom', [100]); if (base.kind !== 'numeric') throw new Error('Expected numeric.');
	const keyed: MotionAeProperty = { ...base, keys: [0, 1, 2].map((time, index) => ({ time, value: [100 + index * 100], inInterpolation: 'linear', outInterpolation: index === 0 ? 'hold' : 'linear', inEase: [{ speed: 0, influence: 33 }], outEase: [{ speed: 0, influence: 33 }], inSpatialTangent: null, outSpatialTangent: null, roving: false })) };
	const mapped = convertMotionAeSceneLayer(replace(camera(), 'ADBE Camera Zoom', keyed), rate, options, []); assert.equal(mapped?.content.kind, 'camera'); if (mapped?.content.kind !== 'camera') throw new Error('Expected camera.');
	assert.equal(compileMotionProperty(mapped.content.zoom)({ num: 12, den: 1 }), 100); assert.equal(compileMotionProperty(mapped.content.zoom)({ num: 36, den: 1 }), 250);
	assert.equal(convertMotionAeSceneLayer(replace(camera(), 'ADBE Camera Zoom', { ...base, samples: { frameRate: 24, firstFrame: 0, values: [[100], [200]] } }), rate, options, []), null);
	const invalid = { ...keyed, keys: keyed.keys.map((key, index) => index === 1 ? { ...key, value: [-1] } : key) };
	assert.equal(convertMotionAeSceneLayer(replace(camera(), 'ADBE Camera Zoom', invalid), rate, options, []), null);
});
