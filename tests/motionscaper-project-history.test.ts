/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createMotionLayer, createMotionscaperProject } from '../src/motionscaper/editor-project.ts';
import { applyMotionscaperCommands, createMotionscaperHistory } from '../src/motionscaper/editor-project-commands.ts';
import { compileMotionscaperProject } from '../src/motionscaper/editor-project-evaluation.ts';
import { motionScalar, motionVector, motionColor } from '../src/common/editor/motion-property.ts';

const r = (num: number, den = 1) => ({ num, den });
const fresh = () => createMotionscaperProject({ id: 'project', title: 'Motion', compositionId: 'main' });
const visual = () => createMotionLayer({ id: 'shape', name: 'Shape', durationFrames: 300,
	content: { kind: 'solid', size: motionVector([100, 100]), color: motionColor([1, 0, 0, 1]) } });

test('M02 command transactions are atomic and history revisions remain monotonic through undo/redo', () => {
	const history = createMotionscaperHistory(fresh());
	history.commit([{ type: 'layer/add', compositionId: 'main', layer: visual(), index: 0 }]);
	assert.equal(history.snapshot().project.revision, 1);
	assert.equal(history.snapshot().project.compositions[0]!.layers.length, 1);
	const before = history.snapshot();
	assert.throws(() => history.commit([{ type: 'project/rename', title: 'Must roll back' }, { type: 'layer/add', compositionId: 'main', layer: visual(), index: 0 }]), /duplicate/iu);
	assert.deepEqual(history.snapshot(), before);
	assert.equal(history.undo(), true);
	assert.equal(history.snapshot().project.revision, 2);
	assert.equal(history.snapshot().project.compositions[0]!.layers.length, 0);
	assert.equal(history.redo(), true);
	assert.equal(history.snapshot().project.revision, 3);
	assert.equal(history.snapshot().project.compositions[0]!.layers.length, 1);
	assert.equal(history.redo(), false);
});

test('M03 trimming and splitting preserve the complete authored keyframe authority', () => {
	const original = visual();
	const animated = { ...original, transform: { ...original.transform, opacity: { ...motionScalar(1), curve: {
		anchors: [{ position: r(0), value: 0 }, { position: r(300), value: 1 }], segments: [{ kind: 'linear' }] } } } };
	const project = applyMotionscaperCommands(fresh(), [{ type: 'layer/add', compositionId: 'main', layer: animated, index: 0 }]);
	const split = applyMotionscaperCommands(project, [{ type: 'layer/split', compositionId: 'main', layerId: 'shape', atFrame: r(150), newLayerId: 'right' }]);
	const left = split.compositions[0]!.layers[0]!;
	const right = split.compositions[0]!.layers[1]!;
	assert.deepEqual(left.transform.opacity, right.transform.opacity);
	assert.deepEqual(left.startFrame, right.startFrame);
	assert.deepEqual(left.outFrame, right.inFrame);
	for (const time of [r(1), r(5), r(9)]) {
		const originalFrame = compileMotionscaperProject(project).evaluate({ compositionId: 'main', time });
		const splitFrame = compileMotionscaperProject(split).evaluate({ compositionId: 'main', time });
		assert.equal(splitFrame.layers[0]!.state.transform.opacity, originalFrame.layers[0]!.state.transform.opacity);
	}
	const trimmed = applyMotionscaperCommands(split, [{ type: 'layer/trim', compositionId: 'main', layerId: 'right', inFrame: r(200), outFrame: r(290) }]);
	assert.deepEqual(trimmed.compositions[0]!.layers[1]!.transform.opacity, right.transform.opacity);
	assert.throws(() => applyMotionscaperCommands(project, [{ type: 'layer/split', compositionId: 'main', layerId: 'shape', atFrame: r(0), newLayerId: 'right' }]), /inside/iu);
});

test('M02 history retains deleted assets until their last undo/redo snapshot is released', () => {
	const history = createMotionscaperHistory(fresh(), { maximumEntries: 1 });
	const asset = { id: 'image', name: 'Image', kind: 'image', sha256: 'a'.repeat(64), storageKey: `motion-sha256:${'a'.repeat(64)}`, byteLength: 1,
		mimeType: 'image/png', width: 100, height: 100, hasAlpha: true };
	history.commit([{ type: 'asset/add', asset }]);
	history.commit([{ type: 'asset/remove', assetId: 'image' }]);
	assert.deepEqual(history.retainedAssetDigests(), ['a'.repeat(64)]);
	history.commit([{ type: 'project/rename', title: 'A later revision' }]);
	assert.deepEqual(history.retainedAssetDigests(), []);
	assert.equal(history.undo(), true);
	history.commit([{ type: 'project/rename', title: 'New branch' }]);
	assert.equal(history.snapshot().canRedo, false);
});

test('M02 a batch may remove a parent and unlink its child without exposing an invalid intermediate project', () => {
	const first = { ...visual(), id: 'parent' };
	const second = { ...visual(), parentId: 'parent' };
	const project = applyMotionscaperCommands(fresh(), [{ type: 'layer/add', compositionId: 'main', layer: first, index: 0 }, { type: 'layer/add', compositionId: 'main', layer: second, index: 1 }]);
	assert.throws(() => applyMotionscaperCommands(project, [{ type: 'layer/remove', compositionId: 'main', layerId: 'parent' }]), /parent/iu);
	const result = applyMotionscaperCommands(project, [{ type: 'layer/remove', compositionId: 'main', layerId: 'parent' }, { type: 'layer/replace', compositionId: 'main', layer: { ...second, parentId: null } }]);
	assert.equal(result.compositions[0]!.layers.length, 1);
	assert.equal(result.compositions[0]!.layers[0]!.parentId, null);
});
