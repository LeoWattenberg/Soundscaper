/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { motionAeSceneProjectFixture as fixture } from './helpers/motionscaper-ae-scene-fixture.ts';
import { prepareMotionscaperAeExport } from '../src/motionscaper/editor-ae-export-conversion.ts';
import { convertMotionscaperAeExchange } from '../src/motionscaper/editor-ae-conversion.ts';
import { prepareMotionscaperAeImport } from '../src/motionscaper/editor-ae-import.ts';
const options = { scene: { colorSpace: 'linear-rec709-d65' as const } };

test('Motion AE project scene conversion keeps reviewed native layer kinds, order, names and independent identities', () => {
	const source = fixture(), exported = prepareMotionscaperAeExport(source, options), layers = exported.exchange.compositions[0]!.layers;
	assert.deepEqual(layers.map(layer => layer.kind), ['camera', 'light']); assert.ok(layers.every(layer => layer.enabled && layer.threeD));
	let serial = 0; const imported = convertMotionscaperAeExchange(exported.exchange, { projectId: 'copy', allocateId: () => `scene-${String(++serial)}`, bindings: [], ...options });
	const result = imported.project.compositions[0]!.layers; assert.deepEqual(result.map(layer => layer.kind), ['camera', 'light']); assert.ok(result.every(layer => layer.is3D));
	assert.deepEqual(result[0]!.transform.position.value, [32, 24, -100]); assert.notEqual(result[0]!.id, source.compositions[0]!.layers[0]!.id);
	assert.deepEqual(result.map(layer => layer.name), ['One-node camera', 'Ambient light']); assert.ok(imported.report.some(entry => entry.code === 'scene-renderer-differences'));
});
test('Motion AE project scene mapping stays opt-in and import controller forwards the reviewed color policy', async () => {
	const source = fixture(), ordinary = prepareMotionscaperAeExport(source); assert.ok(ordinary.exchange.compositions[0]!.layers.every(layer => layer.kind === 'null' && !layer.enabled));
	const reviewed = prepareMotionscaperAeExport(source, options); let serial = 0;
	const unreviewed = convertMotionscaperAeExchange(reviewed.exchange, { projectId: 'unreviewed', allocateId: () => `unreviewed-${String(++serial)}`, bindings: [] });
	assert.ok(unreviewed.project.compositions[0]!.layers.every(layer => layer.kind === 'null'));
	const imported = await prepareMotionscaperAeImport(new Blob([JSON.stringify(reviewed.exchange)]), [], options);
	assert.deepEqual(imported.project.compositions[0]!.layers.map(layer => layer.kind), ['camera', 'light']);
	assert.deepEqual(imported.project.interchangeCustody?.exchange.compositions[0]!.layers[0]!.scene, { autoOrient: 'none' });
});
