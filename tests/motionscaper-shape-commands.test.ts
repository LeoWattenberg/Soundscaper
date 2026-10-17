/* SPDX-License-Identifier: AGPL-3.0-only */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMotionscaperShapeCommands } from '../src/motionscaper/editor-shape-commands.ts';
import { createMotionscaperProject, createMotionLayer } from '../src/motionscaper/editor-project.ts';
import { createMotionscaperHistory, applyMotionscaperCommands } from '../src/motionscaper/editor-project-commands.ts';
import { motionRectanglePath } from '../src/common/editor/motion-shape-primitives.ts';
import { motionColor, motionScalar } from '../src/common/editor/motion-property.ts';
import { motionExpressionReference } from '../src/common/editor/motion-expression-links.ts';
const shape = { id: 'first', path: motionRectanglePath({ x: 0, y: 0, width: 20, height: 20 }), fill: motionColor([1, 0, 0, 1]), stroke: null };
const layer = createMotionLayer({ id: 'shapes', name: 'Shapes', durationFrames: 300, content: { kind: 'shapes', shapes: [shape] } });
const base = createMotionscaperProject({ id: 'p', title: 'Shapes', compositionId: 'c' });
const project = { ...base, compositions: [{ ...base.compositions[0]!, layers: [layer] }] };
test('M06 shape collection edits preserve authored paths and appearances in one undoable transaction', () => {
	const history = createMotionscaperHistory(project);
	const edited = history.commit(createMotionscaperShapeCommands({ project, compositionId: 'c', layerId: 'shapes', edit: { type: 'duplicate', id: 'first', newId: 'second' } }));
	const next = edited.compositions[0]!.layers[0]!; assert.equal(next.kind, 'shapes'); if (next.kind !== 'shapes') throw new Error();
	assert.deepEqual(next.shapes[1], { ...shape, id: 'second' }); assert.equal(edited.revision, 1);
	const reordered = applyMotionscaperCommands(edited, createMotionscaperShapeCommands({ project: edited, compositionId: 'c', layerId: 'shapes', edit: { type: 'reorder', ids: ['second', 'first'] } }));
	assert.equal(reordered.compositions[0]!.layers[0]!.kind === 'shapes' && reordered.compositions[0]!.layers[0]!.shapes[0]!.id, 'second');
	assert.equal(history.undo(), true); assert.deepEqual(history.snapshot().project.compositions, project.compositions);
	assert.throws(() => createMotionscaperShapeCommands({ project, compositionId: 'c', layerId: 'shapes', edit: { type: 'remove', id: 'first' } }), /shape|at least/iu);
	assert.throws(() => createMotionscaperShapeCommands({ project, compositionId: 'c', layerId: 'shapes', edit: { type: 'duplicate', id: 'first', newId: 'first' } }), /duplicate/iu);
});
test('M06 removing a referenced shape refuses atomically rather than rebinding its successor', () => {
	const two = applyMotionscaperCommands(project, createMotionscaperShapeCommands({ project, compositionId: 'c', layerId: 'shapes', edit: { type: 'add', value: { ...shape, id: 'second' }, index: 1 } }));
	const target = two.compositions[0]!.layers[0]!;
	const linked = { ...two, compositions: [{ ...two.compositions[0]!, layers: [{ ...target, transform: { ...target.transform, opacity: { ...motionScalar(1), expression: { source: 'value', enabled: false, references: [motionExpressionReference(target, 'fill', 'shapes.0.fill')] } } } }] }] };
	assert.throws(() => createMotionscaperShapeCommands({ project: linked, compositionId: 'c', layerId: 'shapes', edit: { type: 'remove', id: 'first' } }), /reference|missing/iu);
	const commands = createMotionscaperShapeCommands({ project: linked, compositionId: 'c', layerId: 'shapes', edit: { type: 'reorder', ids: ['second', 'first'] } });
	const changed = applyMotionscaperCommands(linked, commands); assert.equal(changed.compositions[0]!.layers[0]!.transform.opacity.expression!.references[0]!.propertyPath, 'shapes.@first.fill');
});
