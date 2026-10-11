/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import type { MotionAeExchange, MotionAeProperty } from '../src/common/editor/motion-ae-exchange-types.ts';
import { prepareMotionAeHostImport } from '../src/common/editor/motion-ae-host-import-plan.ts';
import { shapeHostFixture } from './helpers/motionscaper-ae-shape-host-fixture.ts';
function manifest(source = '(value+(time*2))', disposition = 'translated', dimensions = 1) {
	return JSON.stringify({ format: 'org.motionscaper.ae-exchange', version: 1, transferId: 'scalar', color: { workingSpace: '', linearBlending: true, bitsPerChannel: 32 }, report: [], footage: [],
		compositions: [{ id: 'comp', name: 'Scalar', width: 64, height: 64, pixelAspect: 1, frameRate: 24, duration: 1, displayStartTime: 0, background: [0, 0, 0], layers: [
			{ id: 'layer', name: 'Scalar layer', kind: 'null', sourceId: null, parentId: null, matte: null, startTime: 0, inPoint: 0.25, outPoint: 1, stretch: 100, enabled: true, threeD: false, adjustment: false, blendMode: 'normal', properties: [
				{ kind: 'group', name: 'Transform', matchName: 'ADBE Transform Group', children: [{ kind: 'numeric', name: 'Opacity', matchName: 'ADBE Opacity', value: Array<number>(dimensions).fill(20), spatial: false, keys: [], expression: { enabled: true, source, disposition } }] },
			] },
		] }] });
}
test('Motion AE host admits only validated translated scalar source before mutation and keeps unsupported expressions inert', () => {
	const plan = prepareMotionAeHostImport(manifest()); assert.equal(plan.compositions[0]!.layers[0]!.properties[0]!.expression, '(value+(time*2))');
	assert.equal(prepareMotionAeHostImport(manifest('app.project.close()', 'unsupported')).compositions[0]!.layers[0]!.properties[0]!.expression, null);
	for (const source of ['app.project.close()', 'Math.random()', '(value=2)', 'value+time', 'thisLayer.opacity', '[value]']) assert.throws(() => prepareMotionAeHostImport(manifest(source)), /scalar|sampling/iu);
	assert.throws(() => prepareMotionAeHostImport(manifest('value', 'translated', 2)), /scalar/iu);
});
async function script(): Promise<string> {
	const root = new URL('../src/motionscaper/ae-bridge/', import.meta.url), entry = await readFile(new URL('Motionscaper-Import.jsx.txt', root), 'utf8'), parts: string[] = [];
	for (const line of entry.split('\n')) { const include = /^#include "([A-Za-z0-9.-]+)"$/u.exec(line); if (include) parts.push(await readFile(new URL(include[1]!, root), 'utf8')); else if (!line.startsWith('#target ')) parts.push(line); } return parts.join('\n');
}
test('Motion AE generated scalar application happens after authored values and rolls back host evaluation errors', async () => {
	const compiled = await script(), fixture = shapeHostFixture(manifest()); vm.runInNewContext(compiled, fixture.sandbox, { timeout: 2000 });
	assert.match(fixture.alerts.at(-1)!, /Exchange imported/u); const comp = fixture.items.find((item): item is InstanceType<typeof fixture.Composition> => item instanceof fixture.Composition)!;
	const opacity = comp.authored[0]!.transform.property('ADBE Opacity')!; assert.equal(opacity.expression, '(value+(time*2))'); assert.equal(opacity.expressionEnabled, true);
	assert.deepEqual(opacity.expressionEvents, ['value', 'expression', 'enabled', 'probe:0.25:false']);
	const keyed = JSON.parse(manifest()) as MotionAeExchange;
	const keyProperty = (property: MotionAeProperty): MotionAeProperty => property.kind === 'group' ? { ...property, children: property.children.map(keyProperty) } : property.kind !== 'numeric' ? property : { ...property, keys: [0.25, 0.5].map(time => ({ time, value: [20], inInterpolation: 'linear', outInterpolation: 'linear', inEase: [{ speed: 0, influence: 30 }], outEase: [{ speed: 0, influence: 30 }], inSpatialTangent: null, outSpatialTangent: null, roving: false })) };
	const animated = shapeHostFixture(JSON.stringify({ ...keyed, compositions: keyed.compositions.map(comp => ({ ...comp, layers: comp.layers.map(layer => ({ ...layer, properties: layer.properties.map(keyProperty) })) })) }));
	vm.runInNewContext(compiled, animated.sandbox, { timeout: 2000 }); assert.match(animated.alerts.at(-1)!, /Exchange imported/u);
	const animatedComp = animated.items.find((item): item is InstanceType<typeof animated.Composition> => item instanceof animated.Composition)!;
	const target = animatedComp.authored[0]!.transform.property('ADBE Opacity')!; assert.equal(target.interpolation.length, 2); assert.deepEqual(target.expressionEvents, ['key', 'key', 'expression', 'enabled', 'probe:0.25:false']);
	for (const mode of ['host-error', 'nonfinite'] as const) {
		const failed = shapeHostFixture(manifest()); failed.expressionFailure.mode = mode; vm.runInNewContext(compiled, failed.sandbox, { timeout: 2000 });
		assert.deepEqual(failed.items, [failed.existing]); assert.match(failed.alerts.at(-1)!, /expression/iu); assert.equal(failed.calls.at(-1), 'end');
	}
	const forged = shapeHostFixture(manifest('app.project.close()')); vm.runInNewContext(compiled, forged.sandbox, { timeout: 2000 }); assert.deepEqual(forged.calls, []);
});
