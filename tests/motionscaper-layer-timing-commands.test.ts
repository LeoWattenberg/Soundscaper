/* SPDX-License-Identifier: AGPL-3.0-only */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMotionLayer, createMotionscaperProject } from '../src/motionscaper/editor-project.ts';
import { createMotionscaperHistory } from '../src/motionscaper/editor-project-commands.ts';
import { createMotionscaperLayerTimingCommands } from '../src/motionscaper/editor-layer-timing-commands.ts';
import { createMotionscaperPropertyCommands } from '../src/motionscaper/editor-property-commands.ts';
import { compileMotionscaperProject } from '../src/motionscaper/editor-project-evaluation.ts';
import { motionScalar } from '../src/common/editor/motion-property.ts';
const r = (num: number, den = 1) => ({ num, den });
function project() {
	const base = createMotionscaperProject({ id: 'p', title: 'Timing', compositionId: 'main' });
	const nested = { ...base.compositions[0]!, id: 'nested' };
	const layer = { ...createMotionLayer({ id: 'precomp', name: 'Precomp', durationFrames: 300, content: { kind: 'precomp', compositionId: 'nested' } }), sourceStart: r(8), timeScale: r(-1, 2), startFrame: r(30), inFrame: r(45) };
	return { ...base, compositions: [{ ...base.compositions[0]!, layers: [layer] }, nested] };
}

test('M06 enabling time remap preserves reverse source timing and other authored animation with one undo step', () => {
	const before = project(); const history = createMotionscaperHistory(before);
	const after = history.commit(createMotionscaperLayerTimingCommands({ project: before, compositionId: 'main', layerId: 'precomp', edit: { type: 'enable-remap' } }));
	const remap = after.compositions[0]!.layers[0]!.timeRemap!;
	assert.deepEqual(remap.curve!.anchors, [{ position: r(0), value: 8 }, { position: r(270), value: 3.5 }]);
	for (const time of [r(3, 2), r(2), r(5), r(9)]) assert.deepEqual(compileMotionscaperProject(after).evaluate({ compositionId: 'main', time }).layers[0]!.sourceTime, compileMotionscaperProject(before).evaluate({ compositionId: 'main', time }).layers[0]!.sourceTime);
	assert.deepEqual(after.compositions[0]!.layers[0]!.transform, before.compositions[0]!.layers[0]!.transform);
	assert.equal(history.undo(), true); assert.equal(history.snapshot().project.compositions[0]!.layers[0]!.timeRemap, null);
});

test('M06 source edits retain authored remap and clearing it explicitly returns to exact affine source authority', () => {
	const before = project(); const history = createMotionscaperHistory(before);
	history.commit(createMotionscaperLayerTimingCommands({ project: before, compositionId: 'main', layerId: 'precomp', edit: { type: 'enable-remap' } }));
	history.commit(createMotionscaperPropertyCommands({ project: history.snapshot().project, compositionId: 'main', layerId: 'precomp', propertyPath: 'timeRemap', edit: { type: 'replace-property', property: motionScalar(2) } }));
	const after = history.commit(createMotionscaperLayerTimingCommands({ project: history.snapshot().project, compositionId: 'main', layerId: 'precomp', edit: { type: 'source', sourceStart: r(1, 3), timeScale: r(2, 3) } }));
	assert.deepEqual(after.compositions[0]!.layers[0]!.timeRemap, motionScalar(2));
	const cleared = history.commit(createMotionscaperLayerTimingCommands({ project: after, compositionId: 'main', layerId: 'precomp', edit: { type: 'clear-remap' } }));
	assert.equal(cleared.compositions[0]!.layers[0]!.timeRemap, null); assert.deepEqual(compileMotionscaperProject(cleared).evaluate({ compositionId: 'main', time: r(2) }).layers[0]!.sourceTime, r(1));
	assert.equal(history.undo(), true); assert.deepEqual(history.snapshot().project.compositions[0]!.layers[0]!.timeRemap, motionScalar(2));
});

test('M06 time-remap admission refuses non-source layers and negative local keyed ranges before publication', () => {
	const base = project(); const original = base.compositions[0]!.layers[0]!;
	const negative = { ...base, compositions: [{ ...base.compositions[0]!, layers: [{ ...original, startFrame: r(60) }] }, base.compositions[1]!] };
	assert.throws(() => createMotionscaperLayerTimingCommands({ project: negative, compositionId: 'main', layerId: 'precomp', edit: { type: 'enable-remap' } }), /local|start/iu);
	const plain = { ...base, compositions: [{ ...base.compositions[0]!, layers: [createMotionLayer({ id: 'null', name: 'Null', durationFrames: 300, content: { kind: 'null' } })] }] };
	assert.throws(() => createMotionscaperLayerTimingCommands({ project: plain, compositionId: 'main', layerId: 'null', edit: { type: 'enable-remap' } }), /footage|precomp/iu);
});
