/* SPDX-License-Identifier: AGPL-3.0-only */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMotionscaperCompositingCommands, createMotionAuthoredEffect, createMotionAuthoredMask } from '../src/motionscaper/editor-compositing-commands.ts';
import { createMotionscaperProject, createMotionLayer } from '../src/motionscaper/editor-project.ts';
import { applyMotionscaperCommands, createMotionscaperHistory } from '../src/motionscaper/editor-project-commands.ts';
import { motionColor, motionScalar, motionVector } from '../src/common/editor/motion-property.ts';
import { motionRectanglePath } from '../src/common/editor/motion-shape-primitives.ts';
import { motionExpressionReference } from '../src/common/editor/motion-expression-links.ts';
const base = createMotionscaperProject({ id: 'p', title: 'Composite', compositionId: 'c', width: 40, height: 30 });
const solid = (id: string) => createMotionLayer({ id, name: id, durationFrames: 300, content: { kind: 'solid', size: motionVector([40, 30]), color: motionColor([1, 0, 0, 1]) } });
const project = { ...base, compositions: [{ ...base.compositions[0]!, layers: [solid('front'), solid('back')] }] };
test('M07 ordered mask and effect edits retain animation and are one undoable transaction', () => {
	const mask = createMotionAuthoredMask('mask', motionRectanglePath({ x: 0, y: 0, width: 20, height: 30 }));
	const history = createMotionscaperHistory(project);
	const masked = history.commit(createMotionscaperCompositingCommands({ project, compositionId: 'c', layerId: 'front', edit: { type: 'mask', change: { type: 'add', value: mask, index: 0 } } }));
	assert.equal(masked.compositions[0]!.layers[0]!.masks[0]!.id, 'mask');
	const effect = createMotionAuthoredEffect({ id: 'blur', type: 'gaussian-blur', width: 40, height: 30 });
	const commands = createMotionscaperCompositingCommands({ project: masked, compositionId: 'c', layerId: 'front', edit: { type: 'effect', change: { type: 'add', value: effect, index: 0 } } });
	const effected = history.commit(commands); assert.equal(effected.compositions[0]!.layers[0]!.effects[0]!.parameters[0]!.value.value, 4);
	assert.equal(history.undo(), true); assert.deepEqual(history.snapshot().project.compositions, masked.compositions);
	assert.throws(() => createMotionAuthoredEffect({ id: 'bad', type: 'foreign-plugin', width: 40, height: 30 }), /unsupported/iu);
	assert.throws(() => createMotionscaperCompositingCommands({ project: effected, compositionId: 'c', layerId: 'front', edit: { type: 'effect', change: { type: 'replace', value: { ...effect, parameters: [{ id: 'sigma', value: motionScalar(999) }] } } } }), /range|sigma|maximum/iu);
});
test('M07 matte cycles and missing sources refuse before publication; adjustment targets every pixel layer below', () => {
	const matte = applyMotionscaperCommands(project, createMotionscaperCompositingCommands({ project, compositionId: 'c', layerId: 'front', edit: { type: 'composite', blendMode: 'screen', matte: { layerId: 'back', mode: 'luma-inverted' } } }));
	assert.throws(() => createMotionscaperCompositingCommands({ project: matte, compositionId: 'c', layerId: 'back', edit: { type: 'composite', blendMode: 'normal', matte: { layerId: 'front', mode: 'alpha' } } }), /cycle/iu);
	assert.throws(() => createMotionscaperCompositingCommands({ project, compositionId: 'c', layerId: 'front', edit: { type: 'composite', blendMode: 'normal', matte: { layerId: 'missing', mode: 'alpha' } } }), /missing/iu);
	const adjusted = applyMotionscaperCommands(matte, createMotionscaperCompositingCommands({ project: matte, compositionId: 'c', edit: { type: 'add-adjustment', id: 'adjust', name: 'Adjustment' } }));
	const layer = adjusted.compositions[0]!.layers[0]!; assert.equal(layer.kind, 'adjustment');
	if (layer.kind !== 'adjustment') throw new Error(); assert.deepEqual(layer.targetLayerIds, ['front']); assert.equal(layer.effects.length, 0);
});
test('M07 effect order stabilizes references and removal refuses dangling links', () => {
	const effects = ['first', 'second'].map((id) => createMotionAuthoredEffect({ id, type: 'gaussian-blur', width: 40, height: 30 }));
	const layer = { ...solid('front'), effects };
	const linked = { ...project, compositions: [{ ...project.compositions[0]!, layers: [{ ...layer, transform: { ...layer.transform, opacity: { ...motionScalar(1), expression: { source: 'value', enabled: false, references: [motionExpressionReference(layer, 'radius', 'effects.0.parameters.0.value')] } } } }, solid('back')] }] };
	const reordered = applyMotionscaperCommands(linked, createMotionscaperCompositingCommands({ project: linked, compositionId: 'c', layerId: 'front', edit: { type: 'effect', change: { type: 'reorder', ids: ['second', 'first'] } } }));
	assert.match(reordered.compositions[0]!.layers[0]!.transform.opacity.expression!.references[0]!.propertyPath, /@first/u);
	assert.throws(() => createMotionscaperCompositingCommands({ project: linked, compositionId: 'c', layerId: 'front', edit: { type: 'effect', change: { type: 'remove', id: 'first' } } }), /reference|missing/iu);
	const pin = createMotionAuthoredEffect({ id: 'pin', type: 'corner-pin', width: 40, height: 30 }); assert.deepEqual(pin.parameters[2]!.value.value, [40, 30]);
});
test('M07 mask edits retain their complete animated path and property authority', async () => {
	const { editMotionKeyframes } = await import('../src/common/editor/motion-keyframe-edit.ts');
	const original = createMotionAuthoredMask('animated', motionRectanglePath({ x: 0, y: 0, width: 20, height: 30 }));
	const path = editMotionKeyframes(original.path, { type: 'set-key', position: { num: 0, den: 1 }, value: original.path.value });
	if (path.kind !== 'path') throw new Error();
	const mask = { ...original, path };
	const masked = applyMotionscaperCommands(project, createMotionscaperCompositingCommands({ project, compositionId: 'c', layerId: 'front', edit: { type: 'mask', change: { type: 'add', value: mask, index: 0 } } }));
	const changed = applyMotionscaperCommands(masked, createMotionscaperCompositingCommands({ project: masked, compositionId: 'c', layerId: 'front', edit: { type: 'mask', change: { type: 'replace', value: { ...mask, inverted: true, operation: 'difference', feather: { ...mask.feather, value: [4, 8] } } } } }));
	assert.deepEqual(changed.compositions[0]!.layers[0]!.masks[0]!.path, path);
	assert.throws(() => createMotionscaperCompositingCommands({ project: masked, compositionId: 'c', layerId: 'front', edit: { type: 'mask', change: { type: 'replace', value: { ...mask, feather: motionVector([129, 0]) } } } }), /feather/iu);
});
