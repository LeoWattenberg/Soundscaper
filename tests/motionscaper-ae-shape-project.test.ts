/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { motionAeShapeProjectFixture as fixture } from './helpers/motionscaper-ae-shape-fixture.ts';
import { prepareMotionscaperAeExport } from '../src/motionscaper/editor-ae-export-conversion.ts';
import { convertMotionscaperAeExchange } from '../src/motionscaper/editor-ae-conversion.ts';
test('Motion AE project shape transfer preserves independently editable ordered fill/stroke paths with valid report identity', () => {
	const source = fixture(), exported = prepareMotionscaperAeExport(source), layer = exported.exchange.compositions[0]!.layers[0]!;
	assert.equal(layer.kind, 'shape'); assert.equal(layer.enabled, true); assert.equal(layer.sourceId, null);
	assert.ok(exported.exchange.report.some(entry => entry.scopeId === layer.id && entry.code === 'shape-mapping' && entry.status === 'editable'));
	let serial = 0;
	const imported = convertMotionscaperAeExchange(exported.exchange, { projectId: 'independent', allocateId: () => `shape-${String(++serial)}`, bindings: [] });
	const mapped = imported.project.compositions[0]!.layers[0]!; assert.equal(mapped.kind, 'shapes'); if (mapped.kind !== 'shapes') throw new Error('Expected shapes.');
	assert.equal(mapped.shapes.length, 2); assert.deepEqual(mapped.shapes[0]!.fill?.kind, 'color'); assert.equal(mapped.shapes[0]!.stroke, null);
	assert.equal(mapped.shapes[1]!.fill, null); assert.equal(mapped.shapes[1]!.stroke?.lineCap, 'round'); assert.equal(mapped.shapes[1]!.stroke?.lineJoin, 'bevel');
	assert.notEqual(mapped.shapes[0]!.id, mapped.shapes[1]!.id); assert.notEqual(mapped.id, source.compositions[0]!.layers[0]!.id);
	assert.deepEqual(mapped.shapes[0]!.path.value, mapped.shapes[1]!.path.value); assert.equal(imported.project.assets.length, 0);
});
test('Motion AE project shape export refuses unpainted geometry instead of silently changing paint', () => {
	const project = fixture(), comp = project.compositions[0]!, layer = comp.layers[0]!; if (layer.kind !== 'shapes') throw new Error('Expected shapes.');
	const exported = prepareMotionscaperAeExport({ ...project, compositions: [{ ...comp, layers: [{ ...layer, shapes: layer.shapes.map(shape => ({ ...shape, fill: null, stroke: null })) }] }] });
	assert.equal(exported.exchange.compositions[0]!.layers[0]!.kind, 'null');
	assert.ok(exported.exchange.report.some(entry => entry.code === 'shape-mapping' && entry.status === 'unsupported'));
});
