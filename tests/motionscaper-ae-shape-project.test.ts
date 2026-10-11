/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createMotionLayer, createMotionscaperProject } from '../src/motionscaper/editor-project.ts';
import { motionColor, motionPropertyOfKind, motionScalar } from '../src/common/editor/motion-property.ts';
import { prepareMotionscaperAeExport } from '../src/motionscaper/editor-ae-export-conversion.ts';
import { convertMotionscaperAeExchange } from '../src/motionscaper/editor-ae-conversion.ts';
function fixture() {
	const project = createMotionscaperProject({ id: 'shape-project', compositionId: 'shape-comp', title: 'Editable shapes', width: 64, height: 64, frameRate: { num: 24, den: 1 }, durationFrames: 24 });
	const path = motionPropertyOfKind({ kind: 'path', value: { closed: true, vertices: [[8, 8], [56, 8], [32, 56]].map(point => ({ point, inTangent: [0, 0], outTangent: [0, 0] })) }, keyframes: [], segments: [], expression: null }, 'path');
	const layer = createMotionLayer({ id: 'original-layer', name: 'Editable triangle', durationFrames: 24, content: { kind: 'shapes', shapes: [{ id: 'triangle', path, fill: motionColor([0.8, 0.2, 0.1, 0.5]),
		stroke: { color: motionColor([0.1, 0.2, 0.8, 1]), width: motionScalar(4), lineCap: 'round', lineJoin: 'bevel' } }] } });
	return { ...project, compositions: [{ ...project.compositions[0]!, layers: [layer] }] };
}
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
