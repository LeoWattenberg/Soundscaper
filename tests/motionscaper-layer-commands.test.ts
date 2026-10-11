/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createMotionscaperLayerCommands } from '../src/motionscaper/editor-layer-commands.ts';
import { createMotionscaperHistory } from '../src/motionscaper/editor-project-commands.ts';
import { createMotionLayer, createMotionscaperProject } from '../src/motionscaper/editor-project.ts';
import { compileMotionscaperProject } from '../src/motionscaper/editor-project-evaluation.ts';
import { motionColor, motionScalar, motionVector } from '../src/common/editor/motion-property.ts';
const r = (num: number, den = 1) => ({ num, den });
const base = createMotionscaperProject({ id: 'authoring', title: 'Authoring', compositionId: 'main' });
const layer = (id: string) => createMotionLayer({ id, name: id, durationFrames: 300, content: { kind: 'solid', color: motionColor([1, 0, 0, 1]), size: motionVector([20, 20]) } });
const animated = { ...layer('animated'), transform: { ...layer('animated').transform, position: { ...motionVector([0, 0, 0]), curves: [{ anchors: [{ position: r(0), value: 0 }, { position: r(300), value: 300 }], segments: [{ kind: 'linear' as const }] }, null, null] } } };
function history(layers: unknown[]) { return createMotionscaperHistory({ ...base, compositions: [{ ...base.compositions[0], layers }] }); }

test('M06 layer duplication remaps selected parent and expression identities without copying media bytes or changing originals', () => {
	const child = { ...layer('child'), parentId: 'animated', transform: { ...layer('child').transform, opacity: { ...motionScalar(1), expression: { source: 'reference("parent")', enabled: false, references: [{ id: 'parent', layerId: 'animated', propertyPath: 'transform.opacity' }] } } } };
	const h = history([child, animated]); const before = h.snapshot().project;
	const commands = createMotionscaperLayerCommands({ project: before, compositionId: 'main', edit: { type: 'duplicate', copies: [{ layerId: 'animated', newLayerId: 'parent-copy' }, { layerId: 'child', newLayerId: 'child-copy' }] } });
	const result = h.commit(commands); const layers = result.compositions[0]!.layers;
	assert.deepEqual(layers.map(({ id }) => id), ['child-copy', 'parent-copy', 'child', 'animated']);
	assert.equal(layers[0]!.parentId, 'parent-copy'); assert.equal(layers[0]!.transform.opacity.expression!.references[0]!.layerId, 'parent-copy');
	assert.deepEqual(layers[1]!.transform, before.compositions[0]!.layers[1]!.transform);
	assert.deepEqual(layers.slice(2), before.compositions[0]!.layers); assert.equal(result.revision, before.revision + 1);
});

test('M06 moving, trimming and splitting retain complete local animation authority with one undo step', () => {
	const h = history([animated]); const original = h.snapshot().project;
	h.commit(createMotionscaperLayerCommands({ project: original, compositionId: 'main', edit: { type: 'move', layerIds: ['animated'], deltaFrames: r(30) } }));
	const moved = h.snapshot().project;
	const before = compileMotionscaperProject(original).evaluate({ compositionId: 'main', time: r(2) });
	const after = compileMotionscaperProject(moved).evaluate({ compositionId: 'main', time: r(3) }); assert.deepEqual(after.layers[0]!.worldMatrix, before.layers[0]!.worldMatrix);
	h.commit(createMotionscaperLayerCommands({ project: moved, compositionId: 'main', edit: { type: 'split', layerId: 'animated', atFrame: r(150), newLayerId: 'right' } }));
	const split = h.snapshot().project; assert.deepEqual(split.compositions[0]!.layers[0]!.transform, split.compositions[0]!.layers[1]!.transform);
	assert.equal(h.undo(), true); assert.deepEqual(h.snapshot().project.compositions, moved.compositions); assert.equal(h.redo(), true);
});

test('M06 inserting an identity null between a shared animated parent and selected children preserves every world transform', () => {
	const parent = { ...animated, id: 'parent' }; const first = { ...layer('first'), parentId: 'parent' }; const second = { ...layer('second'), parentId: 'parent' };
	const h = history([first, second, parent]); const before = h.snapshot().project;
	const grouped = h.commit(createMotionscaperLayerCommands({ project: before, compositionId: 'main', edit: { type: 'add-null', newLayerId: 'group', name: 'Group', layerIds: ['first', 'second'] } }));
	assert.equal(grouped.compositions[0]!.layers[0]!.kind, 'null'); assert.equal(grouped.compositions[0]!.layers[0]!.parentId, 'parent');
	for (const time of [r(0), r(1), r(9)]) {
		const prior = compileMotionscaperProject(before).evaluate({ compositionId: 'main', time }); const current = compileMotionscaperProject(grouped).evaluate({ compositionId: 'main', time });
		for (const id of ['first', 'second']) assert.deepEqual(current.layers.find(({ state }) => state.id === id)!.worldMatrix, prior.layers.find(({ state }) => state.id === id)!.worldMatrix);
	}
});

test('M06 precomposition creation moves a closed contiguous selection at its original local time and supports atomic undo', () => {
	const child = { ...layer('child'), parentId: 'animated' }; const h = history([child, animated, layer('backdrop')]); const before = h.snapshot().project;
	const grouped = h.commit(createMotionscaperLayerCommands({ project: before, compositionId: 'main', edit: { type: 'precompose', layerIds: ['child', 'animated'], newCompositionId: 'nested', newLayerId: 'precomp', name: 'Nested' } }));
	assert.equal(grouped.compositions.length, 2); assert.deepEqual(grouped.compositions[1]!.layers, before.compositions[0]!.layers.slice(0, 2));
	assert.deepEqual(grouped.compositions[0]!.layers.map(({ id }) => id), ['precomp', 'backdrop']);
	const nested = compileMotionscaperProject(grouped).evaluate({ compositionId: 'main', time: r(3) }).layers[0]!.precomposition!;
	const original = compileMotionscaperProject(before).evaluate({ compositionId: 'main', time: r(3) });
	assert.deepEqual(nested.layers[0]!.worldMatrix, original.layers[0]!.worldMatrix); assert.equal(h.undo(), true); assert.deepEqual(h.snapshot().project.compositions, before.compositions);
});

test('M06 relationship-changing operations reject cycles, open nesting dependencies and noncontiguous isolation before publication', () => {
	const h = history([layer('first'), layer('middle'), { ...layer('last'), parentId: 'first' }]); const before = h.snapshot();
	assert.throws(() => createMotionscaperLayerCommands({ project: before.project, compositionId: 'main', edit: { type: 'parent', layerIds: ['first'], parentId: 'last' } }), /cycle/iu);
	assert.throws(() => createMotionscaperLayerCommands({ project: before.project, compositionId: 'main', edit: { type: 'precompose', layerIds: ['first'], newCompositionId: 'nested', newLayerId: 'precomp', name: 'Nested' } }), /depend/iu);
	assert.throws(() => createMotionscaperLayerCommands({ project: before.project, compositionId: 'main', edit: { type: 'precompose', layerIds: ['first', 'last'], newCompositionId: 'nested', newLayerId: 'precomp', name: 'Nested' } }), /contiguous/iu);
	assert.deepEqual(h.snapshot(), before);
});
