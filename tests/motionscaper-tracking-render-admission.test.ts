/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { trackingProject } from './helpers/motionscaper-tracking-fixture.ts';
import { createMotionTrackingSettings, createMotionTrackingResult } from '../src/common/editor/motion-tracking-contract.ts';
import { createMotionTrackingBinding } from '../src/common/editor/motion-tracking-authority.ts';
import { createMotionscaperTrackingCommands } from '../src/motionscaper/editor-tracking-commands.ts';
import { applyMotionscaperCommands } from '../src/motionscaper/editor-project-commands.ts';
import { compileMotionscaperProject } from '../src/motionscaper/editor-project-evaluation.ts';
import { createMotionPreviewRenderSession } from '../src/common/editor/controller/composition/motion-preview-render-session.ts';
import { renderMotionscaperDelivery } from '../src/motionscaper/editor-render-delivery.ts';
import { motionVector } from '../src/common/editor/motion-property.ts';

test('stale tracking application refuses compilation, preview and export before runtime, assets or output are acquired', async () => {
	const base = trackingProject(); const settings = createMotionTrackingSettings({ mode: 'point', firstFrame: 0, frameCount: 2, points: [[20, 20]] });
	const result = createMotionTrackingResult({ id: 'track', binding: createMotionTrackingBinding(base, 'comp', 'source', settings), settings,
		samples: [0, 1].map((frame) => ({ frame, status: 'tracked', points: [[20 + frame, 20]], confidence: 1, error: 0 })) });
	const tracked = applyMotionscaperCommands(base, createMotionscaperTrackingCommands(base, { type: 'accept', compositionId: 'comp', result }));
	const applied = applyMotionscaperCommands(tracked, createMotionscaperTrackingCommands(tracked, { type: 'apply-point', compositionId: 'comp', analysisId: 'track', targetLayerId: 'overlay', replaceAnimation: false }));
	const target = applied.compositions[0]!.layers.find((layer) => layer.id === 'overlay')!;
	const stale = applyMotionscaperCommands(applied, [{ type: 'layer/replace', compositionId: 'comp', layer: { ...target, transform: { ...target.transform, position: motionVector([90, 0, 0]) } } }]);
	assert.throws(() => compileMotionscaperProject(stale), /reapply|detach/u);
	let acquired = 0; const signal = new AbortController().signal;
	const preview = createMotionPreviewRenderSession({ backend: 'host-cpu', maximumAssetBytes: 1024, maximumWorkingBytes: 1024,
		async loadRuntime() { acquired++; throw new Error('Must not acquire runtime.'); } });
	await assert.rejects(async () => preview.setProject(stale, async () => { acquired++; throw new Error('Must not load assets.'); }, signal), /reapply|detach/u); preview.dispose();
	await assert.rejects(renderMotionscaperDelivery({ project: stale, compositionId: 'comp', firstFrame: 0, endFrame: 1, format: 'png', signal, onProgress() {},
		store: { async readAsset() { acquired++; throw new Error('Must not load assets.'); } } }), /reapply|detach/u);
	assert.equal(acquired, 0);
	const detached = applyMotionscaperCommands(stale, createMotionscaperTrackingCommands(stale, { type: 'detach', compositionId: 'comp', targetLayerId: 'overlay', kind: 'point' }));
	assert.ok(compileMotionscaperProject(detached));
});
