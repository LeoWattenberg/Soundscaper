/* SPDX-License-Identifier: AGPL-3.0-only */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMotionscaperProject, createMotionLayer } from '../src/motionscaper/editor-project.ts';
import { createMotionscaperHistory } from '../src/motionscaper/editor-project-commands.ts';
import { createMotionscaperLayerCommands, type MotionscaperLayerEdit } from '../src/motionscaper/editor-layer-commands.ts';
import { motionScalar } from '../src/common/editor/motion-property.ts';
import { createMotionExpressionRuntime } from '../src/common/editor/motion-expression-runtime.ts';
const base = createMotionscaperProject({ id: 'lifecycle', title: 'Layer lifecycle', compositionId: 'main' });
const layer = (id: string) => createMotionLayer({ id, name: id, durationFrames: 300, content: { kind: 'null' } });
function history() {
	const source = { ...layer('source'), transform: { ...layer('source').transform, opacity: motionScalar(.4) } };
	const dependent = { ...layer('dependent'), parentId: 'source', transform: { ...layer('dependent').transform, opacity: { ...motionScalar(1), expression: { source: 'reference("opacity")', enabled: true, references: [{ id: 'opacity', layerId: 'source', propertyPath: 'transform.opacity' }] } } } };
	return createMotionscaperHistory({ ...base, compositions: [{ ...base.compositions[0]!, layers: [source, dependent] }] });
}
test('layer rename and enabled edits preserve stable expression references and restore the complete authored state in one undo step', () => {
	const h = history(), before = h.snapshot().project;
	const renamed = h.commit(createMotionscaperLayerCommands({ project: before, compositionId: 'main', edit: { type: 'rename', layerId: 'source', name: '  Cafe\u0301  ' } }));
	assert.equal(renamed.compositions[0]!.layers[0]!.name, 'Café');
	assert.deepEqual(renamed.compositions[0]!.layers[1], before.compositions[0]!.layers[1]);
	const sample = createMotionExpressionRuntime(renamed.compositions).createSession();
	assert.equal(sample.sample({ compositionId: 'main', layerId: 'dependent', propertyPath: 'transform.opacity', frame: { num: 0, den: 1 } }), .4);
	const disabled = h.commit(createMotionscaperLayerCommands({ project: renamed, compositionId: 'main', edit: { type: 'set-enabled', layerIds: ['source', 'dependent'], enabled: false } }));
	assert.ok(disabled.compositions[0]!.layers.every(item => !item.enabled)); assert.equal(h.undo(), true);
	assert.deepEqual(h.snapshot().project.compositions, renamed.compositions);
});
test('layer removal requires the complete dependency selection and retains unrelated assets with atomic undo', () => {
	const h = history(), before = h.snapshot();
	assert.throws(() => createMotionscaperLayerCommands({ project: before.project, compositionId: 'main', edit: { type: 'remove', layerIds: ['source'] } }), /dependent|dependenc/iu);
	assert.deepEqual(h.snapshot(), before);
	const removed = h.commit(createMotionscaperLayerCommands({ project: before.project, compositionId: 'main', edit: { type: 'remove', layerIds: ['source', 'dependent'] } }));
	assert.deepEqual(removed.compositions[0]!.layers, []); assert.deepEqual(removed.assets, before.project.assets);
	assert.equal(h.undo(), true); assert.deepEqual(h.snapshot().project.compositions, before.project.compositions);
	for (const edit of [{ type: 'rename', layerId: 'source', name: ' ' }, { type: 'set-enabled', layerIds: ['source', 'source'], enabled: true }, { type: 'set-footage-audio', layerIds: ['source'], enabled: true }] as const) assert.throws(() => createMotionscaperLayerCommands({ project: before.project, compositionId: 'main', edit }));
	assert.throws(() => createMotionscaperLayerCommands({ project: before.project, compositionId: 'main', edit: { type: 'set-enabled', layerIds: ['source'], enabled: 'false' } as unknown as MotionscaperLayerEdit }));
});
test('footage audio edits preserve retained bytes, gain and picture authority and refuse enabling silent footage', () => {
	const sha256 = 'a'.repeat(64), asset = { kind: 'footage', id: 'footage-asset', name: 'Movie', sha256, storageKey: `motion-sha256:${sha256}`, byteLength: 1, mimeType: 'video/mp4', width: 32, height: 32, hasAlpha: false, frameRate: { num: 30, den: 1 }, duration: { num: 10, den: 1 }, hasAudio: true };
	const footage = createMotionLayer({ id: 'footage', name: 'Movie', durationFrames: 300, content: { kind: 'footage', assetId: asset.id, audioEnabled: true, audioGain: motionScalar(.25) } });
	const h = createMotionscaperHistory({ ...base, assets: [asset], compositions: [{ ...base.compositions[0]!, layers: [footage] }] }), before = h.snapshot().project;
	const after = h.commit(createMotionscaperLayerCommands({ project: before, compositionId: 'main', edit: { type: 'set-footage-audio', layerIds: ['footage'], enabled: false } }));
	const muted = after.compositions[0]!.layers[0]!; assert.equal(muted.kind, 'footage'); if (muted.kind !== 'footage') throw new Error('Expected footage.');
	assert.equal(muted.audioEnabled, false); assert.deepEqual(muted.audioGain, motionScalar(.25)); assert.equal(muted.enabled, true);
	assert.deepEqual(after.assets, before.assets); assert.equal(h.undo(), true); assert.deepEqual(h.snapshot().project.compositions, before.compositions);
	assert.throws(() => createMotionscaperLayerCommands({ project: { ...before, assets: [{ ...asset, hasAudio: false }] }, compositionId: 'main', edit: { type: 'set-footage-audio', layerIds: ['footage'], enabled: true } }), /no audio/u);
});
