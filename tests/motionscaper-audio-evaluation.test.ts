/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createMotionSceneEvaluator } from '../src/common/editor/motion-composition-evaluation.ts';
import { normalizeMotionscaperProject } from '../src/common/editor/motion-project-validation.ts';
import { createMotionLayer, createMotionscaperProject } from '../src/motionscaper/editor-project.ts';
import { motionScalar } from '../src/common/editor/motion-property.ts';
const r = (num: number, den = 1) => ({ num, den });
const base = createMotionscaperProject({ id: 'audio', title: 'Audio', compositionId: 'main' });
const sha256 = 'a'.repeat(64);
const asset = { kind: 'audio', id: 'sound', name: 'Sound', sha256, storageKey: `motion-sha256:${sha256}`, byteLength: 1, mimeType: 'audio/wav', sampleRate: 48000, channels: 1, duration: r(10) };
const placement = { id: 'placement', assetId: 'sound', startFrame: r(0), inFrame: r(0), outFrame: r(300), sourceStart: r(0), timeScale: r(2), enabled: true, gain: motionScalar(0.25) };

test('M05 audio-only evaluation shares exact nested source mapping and composes reverse playback rates', () => {
	const nested = { ...createMotionLayer({ id: 'nested', name: 'Nested', durationFrames: 300, content: { kind: 'precomp', compositionId: 'child' } }), sourceStart: r(3), timeScale: r(-1) };
	const project = normalizeMotionscaperProject({ ...base, assets: [asset], compositions: [{ ...base.compositions[0], layers: [nested] }, { ...base.compositions[0], id: 'child', audio: [placement] }] });
	const evaluator = createMotionSceneEvaluator(project); const request = { compositionId: 'main', time: r(1, 2) };
	const audio = evaluator.evaluateAudio(request);
	assert.deepEqual(audio, [{ occurrenceId: 'main/nested/placement', assetId: 'sound', sourceTime: r(5), gain: 0.25, playbackRate: r(-2) }]);
	assert.deepEqual(audio[0]!.sourceTime, evaluator.evaluate(request).layers[0]!.precomposition!.audio[0]!.sourceTime);
	assert.deepEqual(evaluator.evaluateAudio({ compositionId: 'main', time: r(-1) }), []);
});

test('M05 audio occurrence budgets reject repeated precomposition growth before provider work', () => {
	const layers = Array.from({ length: 4 }, (_, index) => createMotionLayer({ id: `nested${index}`, name: 'Nested', durationFrames: 300, content: { kind: 'precomp', compositionId: 'child' } }));
	const project = normalizeMotionscaperProject({ ...base, assets: [asset], compositions: [{ ...base.compositions[0], layers }, { ...base.compositions[0], id: 'child', audio: [placement] }] });
	assert.throws(() => createMotionSceneEvaluator(project).evaluateAudio({ compositionId: 'main', time: r(0) }, 4), /budget/iu);
});
