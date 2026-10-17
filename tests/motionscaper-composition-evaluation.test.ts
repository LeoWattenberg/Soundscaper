/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createMotionLayer, createMotionscaperProject } from '../src/motionscaper/editor-project.ts';
import { compileMotionscaperProject } from '../src/motionscaper/editor-project-evaluation.ts';
import { motionColor, motionScalar, motionVector, normalizeMotionProperty } from '../src/common/editor/motion-property.ts';
import { compileMotionProperty } from '../src/common/editor/motion-property-evaluation.ts';
import { assertMotionFrameConsumed } from '../src/common/editor/motion-composition-evaluation.ts';

const r = (num: number, den = 1) => ({ num, den });
const empty = () => createMotionscaperProject({ id: 'project', title: 'Motion', compositionId: 'main' });
const layer = (id: string) => createMotionLayer({ id, name: id, durationFrames: 300, content: { kind: 'solid', size: motionVector([100, 100]), color: motionColor([1, 0, 0, 1]) } });
const curve = (a: number, b: number) => ({ anchors: [{ position: r(0), value: a }, { position: r(30), value: b }], segments: [{ kind: 'linear' }] });

test('M03 the same exact frame and transform result follows sequential or arbitrary seeking', () => {
	const project = empty();
	const parent = { ...layer('parent'), enabled: false, transform: { ...layer('parent').transform, position: motionVector([100, 50, 0]), scale: motionVector([2, 2, 1]) } };
	const child = { ...layer('child'), parentId: 'parent', transform: { ...layer('child').transform,
		position: { ...motionVector([10, 0, 0]), curves: [curve(10, 40), null, null] }, opacity: { ...motionScalar(1), curve: curve(1, 0) } } };
	const compiled = compileMotionscaperProject({ ...project, compositions: [{ ...project.compositions[0], layers: [child, parent] }] });
	const middle = compiled.evaluate({ compositionId: 'main', time: r(1, 2) });
	assert.equal(middle.layers.length, 1);
	assert.equal(middle.layers[0]!.state.id, 'child');
	assert.equal(middle.layers[0]!.worldMatrix[12], 150);
	assert.equal(middle.layers[0]!.worldMatrix[13], 50);
	assert.equal(middle.layers[0]!.state.transform.opacity, 0.5);
	assert.deepEqual(middle.frame, r(15));
	assert.deepEqual(middle.samplePosition, r(24000));
	for (const numerator of [29, 0, 12, 25, 5]) compiled.evaluate({ compositionId: 'main', time: r(numerator, 30) });
	assert.deepEqual(compiled.evaluate({ compositionId: 'main', time: r(1, 2) }), middle);
});

test('M03 isolated precompositions retain exact mixed-rate timing and reverse or held source time', () => {
	const project = empty();
	const childComp = { ...project.compositions[0]!, id: 'child', frameRate: r(24), layers: [layer('visual')] };
	const precomp = { ...createMotionLayer({ id: 'nested', name: 'Nested', durationFrames: 300, content: { kind: 'precomp', compositionId: 'child' } }),
		startFrame: r(15), inFrame: r(15), sourceStart: r(3), timeScale: r(-1) };
	const compiled = compileMotionscaperProject({ ...project, compositions: [{ ...project.compositions[0], layers: [precomp] }, childComp] });
	const frame = compiled.evaluate({ compositionId: 'main', time: r(1) });
	assert.deepEqual(frame.layers[0]!.sourceTime, r(5, 2));
	assert.deepEqual(frame.layers[0]!.precomposition!.frame, r(60));
	assert.deepEqual(frame.layers[0]!.precomposition!.samplePosition, r(120000));
	const held = compileMotionscaperProject({ ...project, compositions: [{ ...project.compositions[0], layers: [{ ...precomp, timeScale: r(0) }] }, childComp] });
	assert.deepEqual(held.evaluate({ compositionId: 'main', time: r(2) }).layers[0]!.precomposition!.frame, r(72));
});

test('M03 animated scalar remapping determines source time before nested evaluation', () => {
	const project = empty();
	const child = { ...project.compositions[0]!, id: 'child', frameRate: r(24), layers: [] };
	const precomp = { ...createMotionLayer({ id: 'pre', name: 'Pre', durationFrames: 300, content: { kind: 'precomp', compositionId: 'child' } }), timeRemap: { ...motionScalar(0), curve: curve(2, 4) } };
	const evaluated = compileMotionscaperProject({ ...project, compositions: [{ ...project.compositions[0], layers: [precomp] }, child] }).evaluate({ compositionId: 'main', time: r(1, 2) });
	assert.deepEqual(evaluated.layers[0]!.sourceTime, r(3));
	assert.deepEqual(evaluated.layers[0]!.precomposition!.frame, r(72));
});

test('M03 scalar, vector, color and compatible path properties evaluate their authored curves', () => {
	const scalar = compileMotionProperty({ ...motionScalar(0), curve: curve(0, 10) });
	assert.equal(scalar(r(15)), 5);
	const vector = compileMotionProperty({ ...motionVector([0, 4]), curves: [curve(0, 10), null] });
	assert.deepEqual(vector(r(15)), [5, 4]);
	const color = compileMotionProperty({ ...motionColor([0, 0, 0, 1]), curves: [curve(0, 1), null, null, null] });
	assert.deepEqual(color(r(15)), [0.5, 0, 0, 1]);
	const path = (x: number) => ({ closed: false, vertices: [{ point: [x, 0], inTangent: [0, 0], outTangent: [0, 0] }, { point: [x, 10], inTangent: [0, 0], outTangent: [0, 0] }] });
	const morph = compileMotionProperty(normalizeMotionProperty({ kind: 'path', value: path(0), expression: null,
		keyframes: [{ position: r(0), value: path(0) }, { position: r(30), value: path(20) }], segments: ['linear'] }));
	assert.deepEqual(morph(r(15)), path(10));
});

test('M03 renderer consumption must account for ordered effects and every authored operation', () => {
	const project = empty();
	const first = { ...layer('visual'), effects: [{ id: 'blur', type: 'gaussian-blur', enabled: true, parameters: [{ id: 'radius', value: motionScalar(2) }] },
		{ id: 'glow', type: 'glow', enabled: true, parameters: [] }] };
	const frame = compileMotionscaperProject({ ...project, compositions: [{ ...project.compositions[0], layers: [first] }] }).evaluate({ compositionId: 'main', time: r(0) });
	assert.deepEqual(frame.layers[0]!.operations.filter((operation) => operation.kind === 'effect').map((operation) => operation.sourceId), ['blur', 'glow']);
	assert.throws(() => assertMotionFrameConsumed(frame, []), /omitted/iu);
	assert.doesNotThrow(() => assertMotionFrameConsumed(frame, frame.requiredOperationIds));
	assert.throws(() => assertMotionFrameConsumed(frame, [...frame.requiredOperationIds, 'unrequested']), /unrequested/iu);
});

test('M03 unfinished expressions fail explicitly without mutating their saved source', () => {
	const project = empty();
	const visual = layer('visual');
	const opacity = { ...motionScalar(1), expression: { source: 'wiggle(', enabled: true, references: [] } };
	const compiled = compileMotionscaperProject({ ...project, compositions: [{ ...project.compositions[0], layers: [{ ...visual, transform: { ...visual.transform, opacity } }] }] });
	assert.throws(() => compiled.evaluate({ compositionId: 'main', time: r(0) }), /motion expression/iu);
	assert.equal(opacity.expression.source, 'wiggle(');
});

test('M03 outside a composition range is transparent and media availability is explicit', () => {
	const project = empty();
	const asset = { kind: 'footage', id: 'video', name: 'Video', sha256: 'a'.repeat(64), storageKey: `motion-sha256:${'a'.repeat(64)}`, byteLength: 1,
		mimeType: 'video/mp4', width: 100, height: 100, hasAlpha: false, hasAudio: false, frameRate: r(24), duration: r(1) };
	const video = createMotionLayer({ id: 'video', name: 'Video', durationFrames: 300, content: { kind: 'footage', assetId: 'video', audioEnabled: true, audioGain: motionScalar(1) } });
	const compiled = compileMotionscaperProject({ ...project, assets: [asset], compositions: [{ ...project.compositions[0], background: [1, 1, 1, 1], layers: [video] }] });
	const frame = compiled.evaluate({ compositionId: 'main', time: r(2) });
	assert.equal(frame.layers[0]!.sourceAvailable, false);
	assert.deepEqual(frame.audio, []);
	assert.deepEqual(compiled.evaluate({ compositionId: 'main', time: r(-1) }).background, [0, 0, 0, 0]);
	assert.deepEqual(compiled.evaluate({ compositionId: 'main', time: r(10) }).layers, []);
});

test('M03 audio placement and fractional frame rates retain exact synchronization', () => {
	const project = empty();
	const asset = { kind: 'audio', id: 'audio', name: 'Audio', sha256: 'a'.repeat(64), storageKey: `motion-sha256:${'a'.repeat(64)}`, byteLength: 1,
		mimeType: 'audio/wav', sampleRate: 44100, channels: 2, duration: r(20) };
	const audio = { id: 'soundtrack', assetId: 'audio', startFrame: r(0), inFrame: r(0), outFrame: r(300), sourceStart: r(2), timeScale: r(1), enabled: true, gain: motionScalar(0.5) };
	const compiled = compileMotionscaperProject({ ...project, assets: [asset], compositions: [{ ...project.compositions[0], frameRate: r(30000, 1001), audio: [audio] }] });
	const frame = compiled.evaluate({ compositionId: 'main', time: r(1001, 60000) });
	assert.deepEqual(frame.frame, r(1, 2));
	assert.deepEqual(frame.samplePosition, r(4004, 5));
	assert.deepEqual(frame.audio[0]!.sourceTime, r(121001, 60000));
	assert.equal(frame.audio[0]!.gain, 0.5);
});
