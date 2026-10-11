/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { shapeHostFixture, shapeHostProfile } from './helpers/motionscaper-ae-shape-host-fixture.ts';
import { prepareMotionAeHostImport } from '../src/common/editor/motion-ae-host-import-plan.ts';
import { prepareMotionscaperAeExport } from '../src/motionscaper/editor-ae-export-conversion.ts';
import { motionAeShapeProjectFixture } from './helpers/motionscaper-ae-shape-fixture.ts';
import type { MotionAeProperty } from '../src/common/editor/motion-ae-exchange-types.ts';
const exchange = () => prepareMotionscaperAeExport(motionAeShapeProjectFixture()).exchange;
test('Motion AE host plan admits ordered editable paint copies and requires complete named shape semantics before mutation', () => {
	const source = exchange(), plan = prepareMotionAeHostImport(JSON.stringify(source)), layer = plan.compositions[0]!.layers[0]!;
	assert.equal(layer.kind, 'shape'); assert.equal(layer.sourceId, null); assert.equal(layer.shapes!.length, 2);
	assert.equal(layer.shapes![0]!.paint.kind, 'stroke'); assert.equal(layer.shapes![1]!.paint.kind, 'fill');
	assert.equal(layer.shapes![0]!.paint.lineCap, 'round'); assert.deepEqual(layer.shapes![0]!.path.value.vertices[0], [8, 8]);
	const mutate = (properties: readonly MotionAeProperty[]): string => JSON.stringify({ ...source, compositions: [{ ...source.compositions[0]!, layers: [{ ...source.compositions[0]!.layers[0]!, properties }] }] });
	const roots = source.compositions[0]!.layers[0]!.properties;
	const transform = (value: MotionAeProperty): MotionAeProperty => value.kind === 'group' ? { ...value, vectorStyle: undefined, children: value.children.map(transform) } : value;
	assert.throws(() => prepareMotionAeHostImport(mutate(roots.map(transform))), /shape|vector/iu);
	const overBudget = roots.map(root => root.matchName === 'ADBE Root Vectors Group' && root.kind === 'group' ? { ...root, children: Array(1025).fill(root.children[0]) } : root);
	assert.throws(() => prepareMotionAeHostImport(mutate(overBudget)), /budget/iu);
});

test('Motion AE shape plan retains hold/linear paths and refuses expressions, nonlinear easing and malformed geometry', () => {
	const source = exchange(), original = source.compositions[0]!.layers[0]!;
	const altered = (change: (property: MotionAeProperty) => MotionAeProperty) => {
		const walk = (property: MotionAeProperty): MotionAeProperty => property.kind === 'group' ? { ...property, children: property.children.map(walk) } : change(property);
		return JSON.stringify({ ...source, compositions: [{ ...source.compositions[0]!, layers: [{ ...original, properties: original.properties.map(walk) }] }] });
	};
	const keys = (property: MotionAeProperty): MotionAeProperty => property.kind !== 'shape' ? property : { ...property, keys: [0, 0.5].map(time => ({ time, value: property.value, inInterpolation: 'hold', outInterpolation: 'linear', inEase: [{ speed: 0, influence: 30 }], outEase: [{ speed: 0, influence: 30 }], inSpatialTangent: null, outSpatialTangent: null, roving: false })) };
	const plan = prepareMotionAeHostImport(altered(keys)); assert.equal(plan.compositions[0]!.layers[0]!.shapes![0]!.path.keys[1]!.time, 0.5);
	for (const change of [
		(property: MotionAeProperty): MotionAeProperty => property.kind !== 'shape' ? property : { ...property, expression: { enabled: true, source: 'value', disposition: 'translated' } },
		(property: MotionAeProperty): MotionAeProperty => { const keyed = keys(property); return keyed.kind !== 'shape' ? keyed : { ...keyed, keys: keyed.keys.map(key => ({ ...key, inInterpolation: 'bezier' })) }; },
		(property: MotionAeProperty): MotionAeProperty => property.kind !== 'shape' ? property : { ...property, value: { ...property.value, vertices: [[1, 2]] } },
	]) assert.throws(() => prepareMotionAeHostImport(altered(change)), /path|shape/iu);
});

test('Motion AE readable importer applies profile-only shape styles to new owned groups and preserves source on refusal', async () => {
	const source = exchange(), scriptRoot = new URL('../src/motionscaper/ae-bridge/', import.meta.url), entry = await readFile(new URL('Motionscaper-Import.jsx.txt', scriptRoot), 'utf8'), parts: string[] = [];
	for (const line of entry.split('\n')) { const include = /^#include "([A-Za-z0-9.-]+)"$/u.exec(line); if (include) parts.push(await readFile(new URL(include[1]!, scriptRoot), 'utf8')); else if (!line.startsWith('#target ')) parts.push(line); }
	const script = parts.join('\n'), run = (f: ReturnType<typeof shapeHostFixture>) => vm.runInNewContext(script, f.sandbox, { timeout: 2000 });
	const f = shapeHostFixture(JSON.stringify(source)); run(f); assert.match(f.alerts.at(-1)!, /Exchange imported/u);
	const comp = f.items.find((item): item is InstanceType<typeof f.Composition> => item instanceof f.Composition)!; assert.ok(comp);
	assert.equal(comp.authored[0]!.audioEnabled, false); const groups = comp.authored[0]!.root.children; assert.equal(groups.length, 2);
	assert.equal(groups[0]!.property('ADBE Vector Blend Mode')!.value, 81); const content = groups[0]!.property('ADBE Vectors Group')!;
	assert.equal(content.children[0]!.property('ADBE Vector Shape Direction')!.value, 121);
	assert.equal(content.children[1]!.matchName, 'ADBE Vector Graphic - Stroke'); assert.equal(content.children[1]!.property('ADBE Vector Stroke Line Cap')!.value, 102); assert.equal(content.children[1]!.property('ADBE Vector Stroke Line Join')!.value, 113);
	assert.equal(f.items[0], f.existing); assert.equal(f.files.get('/package/motionae.json'), JSON.stringify(source));
	for (const profile of [null, { ...shapeHostProfile, host: { ...shapeHostProfile.host, buildNumber: 6 } }]) { const refused = shapeHostFixture(JSON.stringify(source), profile); run(refused); assert.deepEqual(refused.calls, []); assert.deepEqual(refused.items, [refused.existing]); }
	const clamped = shapeHostFixture(JSON.stringify(source), shapeHostProfile, true); run(clamped); assert.match(clamped.alerts.at(-1)!, /rejected a reviewed shape-style/u); assert.deepEqual(clamped.items, [clamped.existing]); assert.equal(clamped.calls.at(-1), 'end');
});

test('Motion AE host shape admission allows neutral modern wave controls and refuses their active values', () => {
	const source = exchange(), layer = source.compositions[0]!.layers[0]!;
	const candidate = (amount: number) => {
		const walk = (property: MotionAeProperty): MotionAeProperty => property.kind !== 'group' ? property : { ...property, children: [...property.children.map(walk), ...(property.matchName === 'ADBE Vector Graphic - Stroke' ? [
			{ kind: 'group' as const, name: 'Wave', matchName: 'ADBE Vector Stroke Wave', children: [{ kind: 'numeric' as const, name: 'Amount', matchName: 'ADBE Vector Taper Wave Amount', value: [amount], keys: [], expression: null, spatial: false }] },
		] : [])] };
		return JSON.stringify({ ...source, compositions: [{ ...source.compositions[0]!, layers: [{ ...layer, properties: layer.properties.map(walk) }] }] });
	};
	assert.equal(prepareMotionAeHostImport(candidate(0)).compositions[0]!.layers[0]!.shapes!.length, 2);
	assert.throws(() => prepareMotionAeHostImport(candidate(5)), /neutral/iu);
});
