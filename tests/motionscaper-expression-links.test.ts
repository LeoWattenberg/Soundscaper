/* SPDX-License-Identifier: AGPL-3.0-only */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMotionShapeOperator } from '../src/common/editor/motion-authoring-operators.ts';
import { motionLayerProperties } from '../src/common/editor/motion-project-graph.ts';
import { motionScalar, motionPropertyOfKind } from '../src/common/editor/motion-property.ts';
import { createMotionLayer, createMotionscaperProject } from '../src/motionscaper/editor-project.ts';
import { createMotionscaperHistory } from '../src/motionscaper/editor-project-commands.ts';
import { createMotionscaperOperatorCommands } from '../src/motionscaper/editor-operator-commands.ts';
import { normalizeMotionscaperProject } from '../src/motionscaper/editor-project-validation.ts';
function project() {
	const base = createMotionscaperProject({ id: 'p', title: 'Links', compositionId: 'main' });
	const path = motionPropertyOfKind({ kind: 'path', value: { closed: false, vertices: [{ point: [0, 0], inTangent: [0, 0], outTangent: [0, 0] }, { point: [10, 10], inTangent: [0, 0], outTangent: [0, 0] }] }, keyframes: [], segments: [], expression: null }, 'path');
	const shape = createMotionLayer({ id: 'shape', name: 'Shape', durationFrames: 300, content: { kind: 'shapes', shapes: [{ id: 'path', path, fill: null, stroke: null }], operators: [createMotionShapeOperator({ id: 'first.part', kind: 'trim-paths' }), createMotionShapeOperator({ id: 'second', kind: 'trim-paths' })] } });
	const owner = createMotionLayer({ id: 'owner', name: 'Owner', durationFrames: 300, content: { kind: 'null' } });
	return normalizeMotionscaperProject({ ...base, compositions: [{ ...base.compositions[0]!, layers: [shape, { ...owner, transform: { ...owner.transform, opacity: { ...motionScalar(1), expression: { source: 'reference("trim")', enabled: false, references: [{ id: 'trim', layerId: 'shape', propertyPath: 'operators.0.end' }] } } } }] }] });
}

test('M08 ordered property addresses expose canonical authored identities while retaining legacy indexed custody', () => {
	const source = project(); const shape = source.compositions[0]!.layers[0]!;
	assert.equal(motionLayerProperties(shape).find(({ path }) => path === 'operators.0.end')?.stablePath, 'operators.@first%2Epart.end');
	assert.equal(source.compositions[0]!.layers[1]!.transform.opacity.expression!.references[0]!.propertyPath, 'operators.0.end');
});

test('M08 reordering operators retains the referenced authored ID and undo retains the original snapshot', () => {
	const before = project(); const h = createMotionscaperHistory(before);
	const commands = createMotionscaperOperatorCommands({ project: before, compositionId: 'main', layerId: 'shape', target: 'shape', edit: { type: 'reorder', ids: ['second', 'first.part'] } });
	const after = h.commit(commands); const reference = after.compositions[0]!.layers[1]!.transform.opacity.expression!.references[0]!;
	assert.equal(reference.propertyPath, 'operators.@first%2Epart.end');
	const target = motionLayerProperties(after.compositions[0]!.layers[0]!).find(({ stablePath }) => stablePath === reference.propertyPath)!;
	assert.equal(target.path, 'operators.1.end'); assert.equal(h.undo(), true); assert.deepEqual(h.snapshot().project.compositions, before.compositions);
});

test('M08 removal refuses a surviving indexed reference instead of retargeting it to the next operator', () => {
	const before = project(); const h = createMotionscaperHistory(before);
	assert.throws(() => createMotionscaperOperatorCommands({ project: before, compositionId: 'main', layerId: 'shape', target: 'shape', edit: { type: 'remove', id: 'first.part' } }), /reference.*missing/iu);
	assert.deepEqual(h.snapshot().project, before);
});

test('M08 stable and indexed aliases participate in one property dependency graph', () => {
	const before = project(); const shape = before.compositions[0]!.layers[0]!; if (shape.kind !== 'shapes') throw new Error('Expected shape');
	const first = shape.operators![0]!; if (first.kind !== 'trim-paths') throw new Error('Expected trim');
	const expression = { source: 'reference("self")', enabled: true, references: [{ id: 'self', layerId: 'shape', propertyPath: 'operators.@first%2Epart.end' }] };
	assert.throws(() => normalizeMotionscaperProject({ ...before, compositions: [{ ...before.compositions[0]!, layers: [{ ...shape, operators: [{ ...first, end: { ...first.end, expression } }, shape.operators![1]!] }, before.compositions[0]!.layers[1]!] }] }), /cycle/iu);
});

test('M08 references owned by reordered operators follow both stable owner and target identities', () => {
	const before = project(); const shape = before.compositions[0]!.layers[0]!; if (shape.kind !== 'shapes') throw new Error('Expected shape');
	const first = shape.operators![0]!; if (first.kind !== 'trim-paths') throw new Error('Expected trim');
	const expression = { source: 'reference("other")', enabled: false, references: [{ id: 'other', layerId: 'shape', propertyPath: 'operators.1.end' }] };
	const source = normalizeMotionscaperProject({ ...before, compositions: [{ ...before.compositions[0]!, layers: [{ ...shape, operators: [{ ...first, end: { ...first.end, expression } }, shape.operators![1]!] }, before.compositions[0]!.layers[1]!] }] });
	const history = createMotionscaperHistory(source); const after = history.commit(createMotionscaperOperatorCommands({ project: source, compositionId: 'main', layerId: 'shape', target: 'shape', edit: { type: 'reorder', ids: ['second', 'first.part'] } }));
	const target = after.compositions[0]!.layers[0]!; if (target.kind !== 'shapes') throw new Error('Expected shape'); const moved = target.operators![1]!; if (moved.kind !== 'trim-paths') throw new Error('Expected trim');
	assert.equal(moved.end.expression!.references[0]!.propertyPath, 'operators.@second.end');
	const renamed = history.commit([{ type: 'layer/replace', compositionId: 'main', layer: { ...target, name: 'Renamed shape' } }]);
	assert.equal(renamed.compositions[0]!.layers[1]!.transform.opacity.expression!.references[0]!.layerId, 'shape');
});

test('M08 standalone gain references keep ordered visual targets stable through history edits', () => {
	const before = project(); const sha256 = 'a'.repeat(64);
	const asset = { kind: 'audio', id: 'sound', name: 'Sound', sha256, storageKey: `motion-sha256:${sha256}`, byteLength: 1, mimeType: 'audio/wav', sampleRate: 48000, channels: 1, duration: { num: 10, den: 1 } };
	const placement = { id: 'voice', assetId: 'sound', enabled: true, startFrame: { num: 0, den: 1 }, inFrame: { num: 0, den: 1 }, outFrame: { num: 300, den: 1 }, sourceStart: { num: 0, den: 1 }, timeScale: { num: 1, den: 1 }, gain: { ...motionScalar(1), expression: { source: 'reference("trim")', enabled: true, references: [{ id: 'trim', layerId: 'shape', propertyPath: 'operators.0.end' }] } } };
	const source = normalizeMotionscaperProject({ ...before, assets: [asset], compositions: [{ ...before.compositions[0]!, audio: [placement] }] });
	const history = createMotionscaperHistory(source); const after = history.commit(createMotionscaperOperatorCommands({ project: source, compositionId: 'main', layerId: 'shape', target: 'shape', edit: { type: 'reorder', ids: ['second', 'first.part'] } }));
	assert.equal(after.compositions[0]!.audio[0]!.gain.expression!.references[0]!.propertyPath, 'operators.@first%2Epart.end');
	assert.equal(history.undo(), true); assert.equal(history.snapshot().project.compositions[0]!.audio[0]!.gain.expression!.references[0]!.propertyPath, 'operators.0.end');
});
