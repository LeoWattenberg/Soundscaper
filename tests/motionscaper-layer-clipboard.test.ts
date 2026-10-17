/* SPDX-License-Identifier: AGPL-3.0-only */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMotionLayer, createMotionscaperProject } from '../src/motionscaper/editor-project.ts';
import { createMotionscaperHistory } from '../src/motionscaper/editor-project-commands.ts';
import { copyMotionscaperLayers, pasteMotionscaperLayers } from '../src/motionscaper/editor-layer-clipboard.ts';
import { compileMotionscaperProject } from '../src/motionscaper/editor-project-evaluation.ts';
import { motionScalar, motionVector } from '../src/common/editor/motion-property.ts';
import { createMotionTrackingSettings, createMotionTrackingResult } from '../src/common/editor/motion-tracking-contract.ts';
import { createMotionTrackingBinding } from '../src/common/editor/motion-tracking-authority.ts';
import { trackingProject } from './helpers/motionscaper-tracking-fixture.ts';
const r = (num: number, den = 1) => ({ num, den });
const layer = (id: string) => createMotionLayer({ id, name: id, durationFrames: 300, content: { kind: 'null' } });
const source = createMotionscaperProject({ id: 'source', title: 'Source', compositionId: 'main' });
const asset = { id: 'picture', name: 'Picture', kind: 'image' as const, sha256: 'a'.repeat(64), byteLength: 4, storageKey: `motion-sha256:${'a'.repeat(64)}`, mimeType: 'image/png', width: 2, height: 2, hasAlpha: true };
const createId = (kind: string, sourceId: string) => `pasted-${kind}-${sourceId}`;

test('M06 portable layer clipboard closes selected dependencies and nested assets without unrelated project authority', () => {
	const child = { ...layer('child'), parentId: 'parent' };
	const nested = { ...source.compositions[0]!, id: 'nested', layers: [createMotionLayer({ id: 'image', name: 'Image', durationFrames: 300, content: { kind: 'image', assetId: asset.id } })] };
	const precomp = createMotionLayer({ id: 'precomp', name: 'Precomp', durationFrames: 300, content: { kind: 'precomp', compositionId: 'nested' } });
	const project = { ...source, assets: [asset, { ...asset, id: 'unused', sha256: 'b'.repeat(64), storageKey: `motion-sha256:${'b'.repeat(64)}` }], compositions: [{ ...source.compositions[0]!, layers: [child, layer('parent'), precomp, layer('unused')] }, nested] };
	assert.throws(() => copyMotionscaperLayers({ project, compositionId: 'main', layerIds: ['child', 'precomp'] }), /depend/iu);
	const clipboard = copyMotionscaperLayers({ project, compositionId: 'main', layerIds: ['child', 'precomp'], includeDependencies: true });
	assert.deepEqual(clipboard.project.compositions[0]!.layers.map(({ id }) => id), ['child', 'parent', 'precomp']);
	assert.equal(clipboard.project.compositions.length, 2); assert.deepEqual(clipboard.project.assets, [asset]); assert.equal(Object.isFrozen(clipboard.project), true);
	const destination = createMotionscaperProject({ id: 'destination', title: 'Destination', compositionId: 'dest' });
	const plan = pasteMotionscaperLayers({ project: destination, compositionId: 'dest', clipboard, index: 0, createId });
	assert.deepEqual(plan.requiredAssets, [{ ...asset, id: createId('asset', asset.id) }]);
	const history = createMotionscaperHistory(destination); const pasted = history.commit(plan.commands);
	assert.equal(pasted.compositions[0]!.layers[0]!.parentId, createId('layer', 'parent'));
	const pastedPrecomp = pasted.compositions[0]!.layers[2]!; assert.equal(pastedPrecomp.kind, 'precomp'); if (pastedPrecomp.kind !== 'precomp') throw new Error('Expected precomp');
	assert.equal(pastedPrecomp.compositionId, createId('composition', 'nested'));
	assert.deepEqual(pasted.compositions[1]!.layers[0]!.kind, 'image'); assert.equal(history.undo(), true); assert.deepEqual(history.snapshot().project.compositions, destination.compositions);
});

test('M06 cross-rate layer paste preserves animation seconds and exact Bezier handle positions', () => {
	const animated = { ...layer('animated'), startFrame: r(30), inFrame: r(30), transform: { ...layer('animated').transform, position: { ...motionVector([0, 0, 0]), curves: [{ anchors: [{ position: r(0), value: 0 }, { position: r(30), value: 100 }], segments: [{ kind: 'bezier', control1: { position: r(10), value: 20 }, control2: { position: r(20), value: 70 } }] }, null, null] } } };
	const project = { ...source, compositions: [{ ...source.compositions[0]!, layers: [animated] }] };
	const clipboard = copyMotionscaperLayers({ project, compositionId: 'main', layerIds: ['animated'] });
	const destination = createMotionscaperProject({ id: 'destination', title: 'Destination', compositionId: 'dest', frameRate: r(24) });
	const h = createMotionscaperHistory(destination); const pasted = h.commit(pasteMotionscaperLayers({ project: destination, compositionId: 'dest', clipboard, index: 0, atFrame: r(48), createId }).commands);
	const current = pasted.compositions[0]!.layers[0]!; assert.deepEqual(current.startFrame, r(48));
	assert.deepEqual(current.transform.position.curves[0]!.anchors[1]!.position, r(24));
	assert.deepEqual(current.transform.position.curves[0]!.segments[0], { kind: 'bezier', control1: { position: r(8), value: 20 }, control2: { position: r(16), value: 70 } });
	const prior = compileMotionscaperProject(project).evaluate({ compositionId: 'main', time: r(3, 2) });
	const after = compileMotionscaperProject(pasted).evaluate({ compositionId: 'dest', time: r(5, 2) });
	assert.deepEqual(after.layers[0]!.worldMatrix, prior.layers[0]!.worldMatrix);
});

test('M06 paste reuses matching retained asset descriptors but preserves distinct metadata for equal digest bytes', () => {
	const project = { ...source, assets: [asset], compositions: [{ ...source.compositions[0]!, layers: [createMotionLayer({ id: 'image', name: 'Image', durationFrames: 300, content: { kind: 'image', assetId: asset.id } })] }] };
	const clipboard = copyMotionscaperLayers({ project, compositionId: 'main', layerIds: ['image'] });
	const destination = { ...createMotionscaperProject({ id: 'destination', title: 'Destination', compositionId: 'dest' }), assets: [{ ...asset, id: 'retained', name: 'Other name' }] };
	const plan = pasteMotionscaperLayers({ project: destination, compositionId: 'dest', clipboard, index: 0, createId });
	assert.deepEqual(plan.requiredAssets, []); assert.equal(plan.commands.some(({ type }) => type === 'asset/add'), false);
	const pasted = createMotionscaperHistory(destination).commit(plan.commands).compositions[0]!.layers[0]!; assert.equal(pasted.kind === 'image' && pasted.assetId, 'retained');
	const changedMetadata = { ...destination, assets: [{ ...destination.assets[0]!, width: 4 }] };
	const changed = pasteMotionscaperLayers({ project: changedMetadata, compositionId: 'dest', clipboard, index: 0, createId });
	assert.equal(changed.commands.filter(({ type }) => type === 'asset/add').length, 1); assert.deepEqual(changed.requiredAssets, []);
});

test('M06 clipboard paste rejects malformed payloads, excess closure and identity collisions before one history publication', () => {
	const project = { ...source, compositions: [{ ...source.compositions[0]!, layers: [layer('one')] }] };
	const clipboard = copyMotionscaperLayers({ project, compositionId: 'main', layerIds: ['one'] }); const h = createMotionscaperHistory(project); const before = h.snapshot();
	const paste = (value: unknown, id = 'fresh') => pasteMotionscaperLayers({ project, compositionId: 'main', clipboard: value, index: 0, createId: () => id });
	assert.throws(() => paste({ ...clipboard, filePath: '/private/source' }), /unknown|unsupported|field/iu);
	assert.throws(() => paste({ ...clipboard, project: { ...clipboard.project, assets: [asset] } }), /closure/iu);
	assert.throws(() => paste(clipboard, 'one'), /duplicate|identity/iu); assert.deepEqual(h.snapshot(), before);
});

const sound = { id: 'sound', name: 'Sound', kind: 'audio' as const, sha256: 'c'.repeat(64), byteLength: 4, storageKey: `motion-sha256:${'c'.repeat(64)}`, mimeType: 'audio/wav', sampleRate: 48000, channels: 1, duration: r(10) };
const audioExpression = { source: 'audioAmplitude("sound", time) + ("sound" == "sound" ? 0 : 1)', enabled: false, references: [] };
test('M08 clipboard retains expression-only audio assets and remaps only intrinsic asset literals in layers and nested audio', () => {
	const animated = { ...layer('animated'), transform: { ...layer('animated').transform, opacity: { ...motionScalar(1), expression: audioExpression } } };
	const nested = { ...source.compositions[0]!, id: 'nested', layers: [animated], audio: [{ id: 'placement', assetId: sound.id, startFrame: r(0), inFrame: r(0), outFrame: r(300), sourceStart: r(0), timeScale: r(1), enabled: true, gain: { ...motionScalar(1), expression: audioExpression } }] };
	const precomp = createMotionLayer({ id: 'precomp', name: 'Precomp', durationFrames: 300, content: { kind: 'precomp', compositionId: 'nested' } });
	const project = { ...source, assets: [sound], compositions: [{ ...source.compositions[0]!, layers: [animated, precomp] }, nested] };
	const clipboard = copyMotionscaperLayers({ project, compositionId: 'main', layerIds: ['animated', 'precomp'] });
	assert.deepEqual(clipboard.project.assets, [sound]);
	assert.deepEqual(copyMotionscaperLayers({ project, compositionId: 'main', layerIds: ['animated'] }).project.assets, [sound]);
	const destination = createMotionscaperProject({ id: 'destination', title: 'Destination', compositionId: 'dest' });
	const plan = pasteMotionscaperLayers({ project: destination, compositionId: 'dest', clipboard, index: 0, createId });
	assert.equal(plan.requiredAssets[0]!.sha256, sound.sha256);
	const pasted = createMotionscaperHistory(destination).commit(plan.commands);
	const expected = 'audioAmplitude("pasted-asset-sound", time) + ("sound" == "sound" ? 0 : 1)';
	assert.equal(pasted.compositions[0]!.layers[0]!.transform.opacity.expression!.source, expected);
	assert.equal(pasted.compositions[1]!.layers[0]!.transform.opacity.expression!.source, expected);
	assert.equal(pasted.compositions[1]!.audio[0]!.gain.expression!.source, expected);
});
test('M08 clipboard refuses unresolved audio source dependencies while malformed non-audio source remains editable', () => {
	const fixture = (text: string, assets = [sound]) => ({ ...source, assets, compositions: [{ ...source.compositions[0]!, layers: [{ ...layer('one'), transform: { ...layer('one').transform, opacity: { ...motionScalar(1), expression: { ...audioExpression, source: text } } } }] }] });
	const copy = (project: unknown) => copyMotionscaperLayers({ project, compositionId: 'main', layerIds: ['one'] });
	assert.throws(() => copy(fixture('audioAmplitude("sound") +')), /expression|audio|syntax/iu);
	assert.throws(() => copy(fixture('audioAmplitude("sound")', [])), /asset|missing/iu);
	assert.equal(copy(fixture('value +', [])).project.compositions[0]!.layers[0]!.transform.opacity.expression!.source, 'value +');
});
test('M07 clipboard refuses tracking custody across composition or project identity changes', () => {
	const project = trackingProject(); const settings = createMotionTrackingSettings({ mode: 'point', firstFrame: 0, frameCount: 1, points: [[20, 20]] });
	const result = createMotionTrackingResult({ id: 'track', binding: createMotionTrackingBinding(project, 'comp', 'source', settings), settings, samples: [{ frame: 0, status: 'tracked', points: [[20, 20]], confidence: 1, error: 0 }] });
	const tracked = { ...project, compositions: [{ ...project.compositions[0]!, tracking: [result] }] };
	assert.throws(() => copyMotionscaperLayers({ project: tracked, compositionId: 'comp', layerIds: ['source'] }), /tracking.*clipboard|clipboard.*tracking/iu);
	assert.throws(() => pasteMotionscaperLayers({ project: source, compositionId: 'main', clipboard: { schemaVersion: 1, project: tracked }, index: 0, createId }), /tracking.*clipboard|clipboard.*tracking/iu);
});
