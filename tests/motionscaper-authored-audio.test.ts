/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { motionCompositionHasAudio } from '../src/common/editor/motion-composition-audio.ts';
import { createMotionLayer, createMotionscaperProject } from '../src/motionscaper/editor-project.ts';
import { motionScalar } from '../src/common/editor/motion-property.ts';
import type { MotionComposition } from '../src/common/editor/motion-composition.ts';

const project = createMotionscaperProject({ id: 'project', title: 'Audio', compositionId: 'main' });
const base = project.compositions[0]!;
const placement = { id: 'short', assetId: 'asset', enabled: true, startFrame: { num: 1, den: 10 }, inFrame: { num: 1, den: 10 }, outFrame: { num: 2, den: 10 }, sourceStart: { num: 0, den: 1 }, timeScale: { num: 1, den: 1 }, gain: motionScalar(1) };
const precomp = createMotionLayer({ id: 'nested', name: 'Nested', durationFrames: 300, content: { kind: 'precomp', compositionId: 'child' } });
const child: MotionComposition = { ...base, id: 'child', audio: [placement] };

test('audio admission follows enabled reachable precompositions and conservatively admits subframe clips', () => {
	assert.equal(motionCompositionHasAudio({ ...project, compositions: [base, child] }, 'main'), false);
	assert.equal(motionCompositionHasAudio({ ...project, compositions: [{ ...base, layers: [precomp] }, child] }, 'main'), true);
	assert.equal(motionCompositionHasAudio({ ...project, compositions: [{ ...base, layers: [{ ...precomp, enabled: false }] }, child] }, 'main'), false);
	assert.equal(motionCompositionHasAudio({ ...project, compositions: [{ ...base, audio: [{ ...placement, enabled: false }] }] }, 'main'), false);
	assert.equal(motionCompositionHasAudio({ ...project, compositions: [{ ...base, audio: [placement] }] }, 'main'), true);
});

test('audio admission requires both footage audio intent and an audio-bearing retained asset', () => {
	const footage = createMotionLayer({ id: 'video', name: 'Video', durationFrames: 300, content: { kind: 'footage', assetId: 'asset', audioEnabled: true, audioGain: motionScalar(1) } });
	assert.ok(footage.kind === 'footage');
	const asset = { id: 'asset', name: 'Video', kind: 'footage' as const, byteLength: 1, sha256: 'a'.repeat(64), storageKey: `motion-sha256:${'a'.repeat(64)}`, mimeType: 'video/mp4', width: 1, height: 1, hasAlpha: false, frameRate: { num: 30, den: 1 }, duration: { num: 10, den: 1 }, hasAudio: true };
	const candidate = { ...project, assets: [asset], compositions: [{ ...base, layers: [footage] }] };
	assert.equal(motionCompositionHasAudio(candidate, 'main'), true);
	assert.equal(motionCompositionHasAudio({ ...candidate, assets: [{ ...asset, hasAudio: false }] }, 'main'), false);
	assert.equal(motionCompositionHasAudio({ ...candidate, compositions: [{ ...base, layers: [{ ...footage, enabled: false }] }] }, 'main'), false);
	assert.equal(motionCompositionHasAudio({ ...candidate, compositions: [{ ...base, layers: [{ ...footage, audioEnabled: false }] }] }, 'main'), false);
});
