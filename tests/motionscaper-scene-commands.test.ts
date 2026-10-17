/* SPDX-License-Identifier: AGPL-3.0-only */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMotionscaperProject, createMotionLayer } from '../src/motionscaper/editor-project.ts';
import { createMotionscaperHistory } from '../src/motionscaper/editor-project-commands.ts';
import { createMotionscaperSceneCommands } from '../src/motionscaper/editor-scene-commands.ts';
import { motionColor, motionScalar, motionVector } from '../src/common/editor/motion-property.ts';
const base = createMotionscaperProject({ id: 'p', title: 'Scene', compositionId: 'main' });
function fixture() {
	const layer = createMotionLayer({ id: 'solid', name: 'Solid', durationFrames: 300, content: { kind: 'solid', color: motionColor([1, 0, 0, 1]), size: motionVector([20, 20]) } });
	return { ...base, compositions: [{ ...base.compositions[0]!, layers: [{ ...layer, transform: { ...layer.transform, position: { ...motionVector([0, 0, 0]), expression: { source: 'value', enabled: false, references: [] } } } }] }] };
}
test('M09 scene transform and material authoring retains animation and undoes atomically', () => {
	const project = fixture(), history = createMotionscaperHistory(project);
	const edit = (change: Parameters<typeof createMotionscaperSceneCommands>[0]['edit']) => history.commit(createMotionscaperSceneCommands({ project: history.snapshot().project, compositionId: 'main', layerId: 'solid', edit: change }));
	const changed = edit({ type: 'transform', is3D: true, position: [10, 20, 30], rotation: [15, 30, 45], scale: [1, 2, 3], anchor: [5, 6, 7] });
	assert.deepEqual(changed.compositions[0]!.layers[0]!.transform.position.expression, project.compositions[0]!.layers[0]!.transform.position.expression);
	assert.deepEqual(changed.compositions[0]!.layers[0]!.transform.rotation.value, [15, 30, 45]); assert.equal(changed.compositions[0]!.layers[0]!.is3D, true);
	const material = edit({ type: 'material', acceptsLights: true, castsShadows: true, receivesShadows: true, ambient: 0.2, diffuse: 0.8, specular: 0.4, shininess: 64 });
	assert.equal(material.compositions[0]!.layers[0]!.material.shininess.value, 64); assert.equal(history.undo(), true); assert.deepEqual(history.snapshot().project.compositions[0]!.layers[0]!.material, changed.compositions[0]!.layers[0]!.material);
});
test('M09 scene camera and lights have centered initial geometry and editable bounded optics', () => {
	const history = createMotionscaperHistory(base);
	const edit = (change: Parameters<typeof createMotionscaperSceneCommands>[0]['edit'], layerId?: string) => history.commit(createMotionscaperSceneCommands({ project: history.snapshot().project, compositionId: 'main', layerId, edit: change }));
	const added = edit({ type: 'add-camera', id: 'camera', name: 'Camera' }); const camera = added.compositions[0]!.layers[0]!; if (camera.kind !== 'camera') throw new Error('Camera required');
	assert.equal(camera.transform.position.value[0], base.compositions[0]!.width / 2); assert.equal(camera.transform.position.value[2], -camera.zoom.value); assert.equal(camera.focusDistance.value, camera.zoom.value);
	const changed = edit({ type: 'camera', projection: 'orthographic', zoom: 500, near: 1, far: 10000, focusDistance: 400, aperture: 10 }, 'camera'); const optics = changed.compositions[0]!.layers[0]!; if (optics.kind !== 'camera') throw new Error('Camera required'); assert.equal(optics.aperture.value, 10);
	edit({ type: 'add-light', id: 'light', name: 'Spot', lightType: 'spot' }); const lit = edit({ type: 'light', lightType: 'point', color: [0.5, 0.25, 1, 1], intensity: 2, coneAngle: 60, coneFeather: 0.2, castsShadows: true }, 'light'); const light = lit.compositions[0]!.layers[0]!; if (light.kind !== 'light') throw new Error('Light required'); assert.equal(light.lightType, 'point'); assert.equal(light.castsShadows, true);
	assert.throws(() => edit({ type: 'camera', near: 100, far: 50 }, 'camera'), /far/iu); assert.throws(() => edit({ type: 'camera', aperture: -1 }, 'camera'), /aperture/iu);
	assert.throws(() => edit({ type: 'light', coneAngle: 181 }, 'light'), /cone/iu); assert.throws(() => edit({ type: 'material', diffuse: -1 }, 'light'), /material/iu);
});
test('M09 scene edits refuse unsupported 3D adjustments and preserve authored scalar animation', () => {
	const camera = createMotionLayer({ id: 'camera', name: 'Camera', durationFrames: 300, content: { kind: 'camera', projection: 'perspective', zoom: { ...motionScalar(100), curve: { anchors: [{ position: { num: 0, den: 1 }, value: 100 }, { position: { num: 10, den: 1 }, value: 200 }], segments: [{ kind: 'linear' }] } }, near: 1, far: 1000, focusDistance: motionScalar(100), aperture: motionScalar(0) } });
	const adjustment = createMotionLayer({ id: 'adjustment', name: 'Adjustment', durationFrames: 300, content: { kind: 'adjustment', targetLayerIds: [] } });
	const project = { ...base, compositions: [{ ...base.compositions[0]!, layers: [camera, adjustment] }] }; const history = createMotionscaperHistory(project);
	const next = history.commit(createMotionscaperSceneCommands({ project, compositionId: 'main', layerId: 'camera', edit: { type: 'camera', zoom: 300 } }));
	if (camera.kind !== 'camera' || next.compositions[0]!.layers[0]!.kind !== 'camera') throw new Error('Camera required'); assert.deepEqual(next.compositions[0]!.layers[0]!.zoom.curve, camera.zoom.curve);
	assert.throws(() => createMotionscaperSceneCommands({ project, compositionId: 'main', layerId: 'adjustment', edit: { type: 'transform', is3D: true } }), /adjustment/iu);
});
