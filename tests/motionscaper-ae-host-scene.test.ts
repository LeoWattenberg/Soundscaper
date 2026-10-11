/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import type { MotionAeProperty } from '../src/common/editor/motion-ae-exchange-types.ts';
import { prepareMotionAeHostImport } from '../src/common/editor/motion-ae-host-import-plan.ts';
import { prepareMotionscaperAeExport } from '../src/motionscaper/editor-ae-export-conversion.ts';
import { motionAeSceneProjectFixture } from './helpers/motionscaper-ae-scene-fixture.ts';
import { shapeHostFixture } from './helpers/motionscaper-ae-shape-host-fixture.ts';
function exchange() { return prepareMotionscaperAeExport(motionAeSceneProjectFixture(), { scene: { colorSpace: 'linear-rec709-d65' } }).exchange; }
async function script(): Promise<string> {
	const root = new URL('../src/motionscaper/ae-bridge/', import.meta.url), entry = await readFile(new URL('Motionscaper-Import.jsx.txt', root), 'utf8'), parts: string[] = [];
	for (const line of entry.split('\n')) { const include = /^#include "([A-Za-z0-9.-]+)"$/u.exec(line); if (include) parts.push(await readFile(new URL(include[1]!, root), 'utf8')); else if (!line.startsWith('#target ')) parts.push(line); } return parts.join('\n');
}
test('Motion AE host scene plan independently admits native camera and ambient SDK operations before mutation', () => {
	const source = exchange(), plan = prepareMotionAeHostImport(JSON.stringify(source)), layers = plan.compositions[0]!.layers;
	assert.deepEqual(layers.map(layer => layer.scene?.kind), ['camera', 'ambient']);
	for (const scene of [undefined, { autoOrient: 'point-of-interest' }, { autoOrient: 'none', arbitrary: true }, { autoOrient: 'none', lightType: 'point' }]) {
		const forged = { ...source, compositions: source.compositions.map(comp => ({ ...comp, layers: comp.layers.map((layer, index) => index ? layer : { ...layer, scene }) })) };
		assert.throws(() => prepareMotionAeHostImport(JSON.stringify(forged)), /scene|camera|metadata/iu);
	}
});
test('Motion AE generated importer creates native scene layers and verifies values without writing AV-only properties', async () => {
	const fixture = shapeHostFixture(JSON.stringify(exchange())); vm.runInNewContext(await script(), fixture.sandbox, { timeout: 2000 });
	assert.match(fixture.alerts.at(-1)!, /Exchange imported/u);
	const comp = fixture.items.find((item): item is InstanceType<typeof fixture.Composition> => item instanceof fixture.Composition)!;
	assert.deepEqual(comp.authored.map(layer => layer.kind), ['camera', 'ambient']); assert.ok(comp.authored.every(layer => layer.autoOrient === 'none'));
	assert.equal(comp.authored[0]!.property('ADBE Camera Options Group').property('ADBE Camera Zoom')!.value, 100);
	assert.equal(comp.authored[1]!.property('ADBE Light Options Group').property('ADBE Light Intensity')!.value, 75);
	assert.ok(comp.authored.every(layer => layer.threeDLayer === false && layer.audioEnabled === true));
	const failed = shapeHostFixture(JSON.stringify(exchange())); failed.sceneFailure.mode = 'clamp'; vm.runInNewContext(await script(), failed.sandbox, { timeout: 2000 });
	assert.deepEqual(failed.items, [failed.existing]); assert.match(failed.alerts.at(-1)!, /changed|clamp|value/iu);
});

test('Motion AE scene keys are applied and verified, while forged DOF or orientation fails before any owned objects exist', async () => {
	const compiled = await script(), source = exchange();
	const keyed = (property: MotionAeProperty): MotionAeProperty => property.kind === 'group' ? { ...property, children: property.children.map(keyed) } : property.kind === 'numeric' && property.matchName === 'ADBE Camera Zoom' ? { ...property, keys: [0, 0.5].map((time, index) => ({ time, value: [100 + index * 50], inInterpolation: 'linear', outInterpolation: 'linear', inEase: [{ speed: 0, influence: 33 }], outEase: [{ speed: 0, influence: 33 }], inSpatialTangent: null, outSpatialTangent: null, roving: false })) } : property;
	const fixture = shapeHostFixture(JSON.stringify({ ...source, compositions: source.compositions.map(comp => ({ ...comp, layers: comp.layers.map(layer => ({ ...layer, properties: layer.properties.map(keyed) })) })) }));
	vm.runInNewContext(compiled, fixture.sandbox, { timeout: 2000 }); assert.match(fixture.alerts.at(-1)!, /Exchange imported/u);
	const comp = fixture.items.find((item): item is InstanceType<typeof fixture.Composition> => item instanceof fixture.Composition)!;
	assert.deepEqual(Array.from(comp.authored[0]!.property('ADBE Camera Options Group').property('ADBE Camera Zoom')!.keys.values()), [100, 150]);
	for (const target of ['ADBE Camera Depth of Field', 'ADBE Rotate X']) {
		const change = (property: MotionAeProperty): MotionAeProperty => property.kind === 'group' ? { ...property, children: property.children.map(change) } : property.kind === 'numeric' && property.matchName === target ? { ...property, value: [1] } : property;
		const failed = shapeHostFixture(JSON.stringify({ ...source, compositions: source.compositions.map(comp => ({ ...comp, layers: comp.layers.map(layer => ({ ...layer, properties: layer.properties.map(change) })) })) }));
		vm.runInNewContext(compiled, failed.sandbox, { timeout: 2000 }); assert.deepEqual(failed.calls, []); assert.deepEqual(failed.items, [failed.existing]);
	}
});
