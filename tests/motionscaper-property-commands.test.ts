/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createMotionscaperPropertyCommands } from '../src/motionscaper/editor-property-commands.ts';
import { createMotionLayer, createMotionscaperProject } from '../src/motionscaper/editor-project.ts';
import { createMotionscaperHistory } from '../src/motionscaper/editor-project-commands.ts';
import { motionColor, motionVector } from '../src/common/editor/motion-property.ts';
import { copyMotionKeyframes } from '../src/common/editor/motion-keyframe-edit.ts';
const r = (num: number, den = 1) => ({ num, den });
function history() {
	const base = createMotionscaperProject({ id: 'properties', title: 'Properties', compositionId: 'main' });
	const layer = createMotionLayer({ id: 'shape', name: 'Shape', durationFrames: 300, content: { kind: 'solid', color: motionColor([1, 0, 0, 1]), size: motionVector([20, 20]) } });
	return createMotionscaperHistory({ ...base, compositions: [{ ...base.compositions[0], layers: [layer] }] });
}

test('M06 property-addressed commands edit one field through one undoable transaction and reject arbitrary paths', () => {
	const h = history(); const initial = h.snapshot().project;
	h.commit(createMotionscaperPropertyCommands({ project: initial, compositionId: 'main', layerId: 'shape', propertyPath: 'transform.position', edit: { type: 'set-key', position: r(12), value: [10, 20, 0] } }));
	const changed = h.snapshot().project.compositions[0]!.layers[0]!;
	assert.equal(changed.transform.position.curves[0]!.anchors.length, 1); assert.deepEqual(changed.transform.scale, initial.compositions[0]!.layers[0]!.transform.scale);
	assert.throws(() => createMotionscaperPropertyCommands({ project: h.snapshot().project, compositionId: 'main', layerId: 'shape', propertyPath: '__proto__.polluted', edit: { type: 'set-base', value: 1 } }), /missing/iu);
	assert.equal(h.undo(), true); assert.deepEqual(h.snapshot().project.compositions, initial.compositions);
});

test('M06 property paste converts clipboard frame coordinates once using the destination composition rate', () => {
	const h = history(); h.commit(createMotionscaperPropertyCommands({ project: h.snapshot().project, compositionId: 'main', layerId: 'shape', propertyPath: 'transform.opacity', edit: { type: 'set-key', position: r(15), value: 0.5 } }));
	const source = h.snapshot().project.compositions[0]!.layers[0]!.transform.opacity;
	const clipboard = copyMotionKeyframes(source, [r(15)], r(24));
	h.commit(createMotionscaperPropertyCommands({ project: h.snapshot().project, compositionId: 'main', layerId: 'shape', propertyPath: 'transform.opacity', edit: { type: 'paste-keys', clipboard, atFrame: r(30), mode: 'merge' } }));
	assert.deepEqual(h.snapshot().project.compositions[0]!.layers[0]!.transform.opacity.curve!.anchors.map(({ position }) => position), [r(15), r(30)]);
});
