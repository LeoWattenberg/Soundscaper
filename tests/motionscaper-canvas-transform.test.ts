/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { beginMotionscaperCanvasTransform, motionscaperCanvasScene, hitMotionscaperCanvas } from '../src/motionscaper/editor-canvas-transform.ts';
import { createMotionscaperProject, createMotionLayer } from '../src/motionscaper/editor-project.ts';
import { applyMotionscaperCommands, createMotionscaperHistory } from '../src/motionscaper/editor-project-commands.ts';
import { motionColor, motionVector } from '../src/common/editor/motion-property.ts';
import { editMotionKeyframes } from '../src/common/editor/motion-keyframe-edit.ts';
import { compileMotionscaperProject } from '../src/motionscaper/editor-project-evaluation.ts';
const r = (num: number, den = 1) => ({ num, den });
function scene() {
	const project = createMotionscaperProject({ id: 'canvas', title: 'Canvas', compositionId: 'main', width: 200, height: 200 });
	const parent = createMotionLayer({ id: 'parent', name: 'Parent', durationFrames: 300, content: { kind: 'null' } });
	const solid = createMotionLayer({ id: 'solid', name: 'Solid', durationFrames: 300, content: { kind: 'solid', size: motionVector([20, 10]), color: motionColor([1, 0, 0, 1]) } });
	return { ...project, compositions: [{ ...project.compositions[0]!, layers: [{ ...solid, parentId: parent.id, transform: { ...solid.transform, position: motionVector([5, 7, 0]) } },
		{ ...parent, transform: { ...parent.transform, position: motionVector([100, 50, 0]), rotation: motionVector([0, 0, 90]), scale: motionVector([2, 3, 1]) } }] }] };
}
const options = { compositionId: 'main', layerId: 'solid', frame: r(0) };
const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} differs from ${b}`);

test('canvas movement converts composition delta through evaluated parent transforms and is one undoable edit', () => {
	const project = scene(); const before = motionscaperCanvasScene({ project, compositionId: 'main', frame: r(0) });
	const anchor = before.layers.find(layer => layer.layerId === 'solid')!.anchor;
	const gesture = beginMotionscaperCanvasTransform({ project, ...options, mode: 'move', start: anchor });
	const target = [anchor[0] + 12, anchor[1] + 10] as const; const preview = gesture.preview(target);
	const transformed = preview.project.compositions[0]!.layers[0]!.transform.position.value; close(transformed[0], 10); close(transformed[1], 3);
	assert.equal(project.compositions[0]!.layers[0]!.transform.position.value[0], 5);
	const history = createMotionscaperHistory(project); history.commit(gesture.commit(history.snapshot().project, target));
	const after = motionscaperCanvasScene({ project: history.snapshot().project, compositionId: 'main', frame: r(0) }).layers[0]!.anchor;
	close(after[0], target[0]); close(after[1], target[1]); assert.equal(history.undo(), true); assert.deepEqual(history.snapshot().project.compositions, createMotionscaperHistory(project).snapshot().project.compositions);
});

test('scale and rotation handles edit local axes around the authored anchor under a nonuniform parent', () => {
	const project = scene(); const geometry = motionscaperCanvasScene({ project, compositionId: 'main', frame: r(0) }).layers[0]!;
	const scale = beginMotionscaperCanvasTransform({ project, ...options, mode: 'scale', start: geometry.corners[2] });
	const target = [geometry.anchor[0] + (geometry.corners[2][0] - geometry.anchor[0]) * 0.5, geometry.anchor[1] + (geometry.corners[2][1] - geometry.anchor[1]) * 2] as const;
	const scaled = scale.preview(target).project.compositions[0]!.layers[0]!; close(scaled.transform.scale.value[0], 2); close(scaled.transform.scale.value[1], 0.5);
	const start = [geometry.anchor[0], geometry.anchor[1] + 20] as const; const end = [geometry.anchor[0] - 30, geometry.anchor[1]] as const;
	const rotate = beginMotionscaperCanvasTransform({ project, ...options, mode: 'rotate', start });
	close(rotate.preview(end).project.compositions[0]!.layers[0]!.transform.rotation.value[2], 90);
});

test('canvas selection uses evaluated source bounds and ordered layers with exact parent inversion', () => {
	const project = scene(); const geometry = motionscaperCanvasScene({ project, compositionId: 'main', frame: r(0) });
	assert.equal(hitMotionscaperCanvas(geometry, [64, 80]), 'solid'); assert.equal(hitMotionscaperCanvas(geometry, [5, 5]), null);
	const frame = compileMotionscaperProject(project).evaluate({ compositionId: 'main', time: r(0) });
	close(geometry.layers[0]!.corners[0][0], frame.layers[0]!.worldMatrix[12]); close(geometry.layers[0]!.corners[0][1], frame.layers[0]!.worldMatrix[13]);
});

test('canvas refuses keyed, expression-controlled, 3D and singular transforms without overwriting them', () => {
	const project = scene(); const original = project.compositions[0]!.layers[0]!;
	const edits = [
		{ ...original, transform: { ...original.transform, position: editMotionKeyframes(original.transform.position, { type: 'set-key', position: r(0), value: [5, 7, 0] }) } },
		{ ...original, transform: { ...original.transform, position: { ...original.transform.position, expression: { source: 'value', enabled: true, references: [] } } } },
		{ ...original, is3D: true }, { ...original, transform: { ...original.transform, scale: motionVector([0, 1, 1]) } },
	];
	for (const layer of edits) assert.throws(() => beginMotionscaperCanvasTransform({ project: { ...project, compositions: [{ ...project.compositions[0], layers: [layer, project.compositions[0]!.layers[1]] }] }, ...options, mode: 'move', start: [0, 0] }));
});

test('canvas publication rejects a stale project and nonfinite pointer input', () => {
	const project = scene(); const gesture = beginMotionscaperCanvasTransform({ project, ...options, mode: 'move', start: [0, 0] });
	const changed = applyMotionscaperCommands(project, [{ type: 'project/rename', title: 'Changed during drag' }]);
	assert.throws(() => gesture.commit(changed, [10, 10]), /changed/); assert.throws(() => gesture.preview([Infinity, 10]), /finite/);
});

test('canvas preserves animated parent curves and uses their evaluated transform at the selected rational frame', () => {
	const project = scene(); const composition = project.compositions[0]!, parent = composition.layers[1]!;
	let position = editMotionKeyframes(parent.transform.position, { type: 'set-key', position: r(0), value: [100, 50, 0] });
	position = editMotionKeyframes(position, { type: 'set-key', position: r(10), value: [200, 150, 0] });
	const animated = { ...project, compositions: [{ ...composition, layers: [composition.layers[0]!, { ...parent, transform: { ...parent.transform, position } }] }] };
	const frame = r(5, 2), geometry = motionscaperCanvasScene({ project: animated, compositionId: 'main', frame }).layers[0]!;
	const gesture = beginMotionscaperCanvasTransform({ project: animated, ...options, frame, mode: 'move', start: geometry.anchor });
	const moved = gesture.preview([geometry.anchor[0] + 12, geometry.anchor[1] + 10]).project;
	assert.deepEqual(moved.compositions[0]!.layers[1]!.transform.position, position);
	close(moved.compositions[0]!.layers[0]!.transform.position.value[0], 10); close(moved.compositions[0]!.layers[0]!.transform.position.value[1], 3);
});

test('canvas admission rejects unsupported modes and frames outside the authored composition', () => {
	const project = scene();
	assert.throws(() => beginMotionscaperCanvasTransform({ project, ...options, mode: 'skew' as 'move', start: [0, 0] }), /supported/);
	for (const frame of [r(-1), r(300)]) assert.throws(() => motionscaperCanvasScene({ project, compositionId: 'main', frame }), /frame/);
});
