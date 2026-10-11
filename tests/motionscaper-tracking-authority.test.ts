/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { trackingProject } from './helpers/motionscaper-tracking-fixture.ts';
import { applyMotionscaperCommands } from '../src/motionscaper/editor-project-commands.ts';
import { createMotionTrackingSettings, createMotionTrackingResult, normalizeMotionTrackingResult } from '../src/common/editor/motion-tracking-contract.ts';
import { createMotionTrackingBinding, createMotionTrackingFreshnessChecker, motionTrackingFreshness, admitMotionTrackingResult, motionTrackingSourceTime } from '../src/common/editor/motion-tracking-authority.ts';
const settings = createMotionTrackingSettings({ mode: 'point', firstFrame: 2, frameCount: 3, points: [[20, 20]] });
function result() { const project = trackingProject(); return createMotionTrackingResult({ id: 'track', binding: createMotionTrackingBinding(project, 'comp', 'source', settings), settings,
	samples: [2, 3, 4].map(frame => ({ frame, status: 'tracked', points: [[20 + frame, 20]], confidence: 1, error: 0 })) }); }
test('Motion tracking binds raw source, settings and origin revision without making persisted results stale after unrelated saves', () => {
	const project = trackingProject(); const tracked = result();
	assert.deepEqual(admitMotionTrackingResult(project, tracked, 'new'), tracked);
	assert.deepEqual(normalizeMotionTrackingResult(JSON.parse(JSON.stringify(tracked)) as unknown), tracked);
	const renamed = applyMotionscaperCommands(project, [{ type: 'project/rename', title: 'Saved title' }]);
	assert.equal(motionTrackingFreshness(renamed, tracked).status, 'fresh');
	assert.throws(() => admitMotionTrackingResult(renamed, tracked, 'new'), /revision/iu);
	assert.deepEqual(admitMotionTrackingResult(renamed, tracked, 'persisted'), tracked);
	const source = project.compositions[0]!.layers.find(layer => layer.id === 'source')!;
	assert.deepEqual(motionTrackingSourceTime(project.compositions[0]!, source, 3), { num: 1, den: 8 });
});
test('Motion tracking marks changed footage and source timing stale and refuses tampered settings or samples', () => {
	const project = trackingProject(); const tracked = result(); const source = project.compositions[0]!.layers.find(layer => layer.id === 'source')!;
	const retimed = applyMotionscaperCommands(project, [{ type: 'layer/replace', compositionId: 'comp', layer: { ...source, sourceStart: { num: 1, den: 24 } } }]);
	assert.equal(motionTrackingFreshness(retimed, tracked).status, 'stale');
	assert.throws(() => admitMotionTrackingResult(retimed, tracked, 'persisted'), /reanalyze/iu);
	const different = { ...project, assets: project.assets.map(asset => ({ ...asset, sha256: 'b'.repeat(64), storageKey: `motion-sha256:${'b'.repeat(64)}` })) };
	assert.equal(motionTrackingFreshness(different, tracked).status, 'stale');
	assert.throws(() => normalizeMotionTrackingResult({ ...tracked, settings: { ...settings, maximumError: 0.25 } }), /settings digest/iu);
	assert.throws(() => normalizeMotionTrackingResult({ ...tracked, samples: tracked.samples.map(sample => ({ ...sample, points: [[30, 30]] })) }), /result digest/iu);
	assert.throws(() => createMotionTrackingBinding(project, 'comp', 'overlay', settings), /footage/iu);
});
test('Motion revision freshness checks pin one immutable source snapshot for multiple analyses', () => {
	const project = trackingProject(); const tracked = result(); const mutable = { ...project, assets: [...project.assets] };
	const check = createMotionTrackingFreshnessChecker(mutable); assert.equal(check(tracked).status, 'fresh');
	mutable.assets = project.assets.map(asset => ({ ...asset, sha256: 'b'.repeat(64), storageKey: `motion-sha256:${'b'.repeat(64)}` }));
	assert.equal(check(tracked).status, 'fresh'); assert.equal(motionTrackingFreshness(mutable, tracked).status, 'stale');
});
