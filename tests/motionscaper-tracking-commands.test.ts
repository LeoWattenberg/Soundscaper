/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { trackingProject } from './helpers/motionscaper-tracking-fixture.ts';
import { createMotionTrackingSettings, createMotionTrackingResult } from '../src/common/editor/motion-tracking-contract.ts';
import { createMotionTrackingBinding } from '../src/common/editor/motion-tracking-authority.ts';
import { createMotionscaperTrackingCommands } from '../src/motionscaper/editor-tracking-commands.ts';
import { motionTrackingReadiness } from '../src/common/editor/motion-tracking-admission.ts';
import { applyMotionscaperCommands, createMotionscaperHistory } from '../src/motionscaper/editor-project-commands.ts';
import { normalizeMotionscaperProject } from '../src/common/editor/motion-project-validation.ts';
import { motionVector, motionColor } from '../src/common/editor/motion-property.ts';
import { createMotionLayer } from '../src/motionscaper/editor-project.ts';
import { evaluateInterpolationCurve } from '../src/common/editor/interpolation-curve.ts';
import { exportMotionscaperArchive, importMotionscaperArchive } from '../src/motionscaper/editor-scape.ts';
function analyzed(mode: 'point' | 'planar' | 'stabilize' = 'point', project = trackingProject()) {
	const settings = createMotionTrackingSettings({ mode, firstFrame: 2, frameCount: 3,
		points: mode === 'point' ? [[20, 20]] : [[10, 10], [40, 10], [40, 40], [10, 40]] });
	const result = createMotionTrackingResult({ id: 'track', binding: createMotionTrackingBinding(project, 'comp', 'source', settings), settings,
		samples: [2, 3, 4].map((frame, index) => ({ frame, status: 'tracked', points: settings.points.map(([x, y]) => [x + index, y + index]), confidence: 1, error: 0 })) });
	return applyMotionscaperCommands(project, createMotionscaperTrackingCommands(project, { type: 'accept', compositionId: 'comp', result }));
}
test('Motion tracking persists through normalization/history and manual corrections make applications stale until reapplied', () => {
	const initial = trackingProject(); assert.equal(Object.hasOwn(initial.compositions[0]!, 'tracking'), false);
	const tracked = analyzed(); const commands = createMotionscaperTrackingCommands(tracked, { type: 'apply-point', compositionId: 'comp', analysisId: 'track', targetLayerId: 'overlay', replaceAnimation: false });
	const applied = applyMotionscaperCommands(tracked, commands); assert.equal(motionTrackingReadiness(applied).length, 0);
	const position = applied.compositions[0]!.layers.find(layer => layer.id === 'overlay')!.transform.position;
	assert.equal(evaluateInterpolationCurve(position.curves[0]!, 4), 2);
	const reopened = normalizeMotionscaperProject(JSON.parse(JSON.stringify(applied)) as unknown); assert.deepEqual(reopened, applied);
	const corrected = applyMotionscaperCommands(applied, createMotionscaperTrackingCommands(applied, { type: 'correct', compositionId: 'comp', analysisId: 'track', frame: 3, points: [[25, 26]] }));
	assert.match(motionTrackingReadiness(corrected)[0]!.message, /reapply/iu);
	const reapplied = applyMotionscaperCommands(corrected, createMotionscaperTrackingCommands(corrected, { type: 'apply-point', compositionId: 'comp', analysisId: 'track', targetLayerId: 'overlay', replaceAnimation: false }));
	assert.equal(motionTrackingReadiness(reapplied).length, 0);
	const history = createMotionscaperHistory(applied); history.commit(createMotionscaperTrackingCommands(applied, { type: 'correct', compositionId: 'comp', analysisId: 'track', frame: 3, points: [[25, 26]] }));
	assert.equal(history.undo(), true); assert.deepEqual(history.snapshot().project.compositions[0]!.tracking, applied.compositions[0]!.tracking);
});
test('Motion applied tracking ignores names, diagnoses edited geometry and can detach intentionally edited curves', () => {
	const tracked = analyzed(); const applied = applyMotionscaperCommands(tracked, createMotionscaperTrackingCommands(tracked, { type: 'apply-point', compositionId: 'comp', analysisId: 'track', targetLayerId: 'overlay', replaceAnimation: false }));
	const target = applied.compositions[0]!.layers.find(layer => layer.id === 'overlay')!;
	const renamed = applyMotionscaperCommands(applied, [{ type: 'layer/replace', compositionId: 'comp', layer: { ...target, name: 'Renamed' } }]); assert.equal(motionTrackingReadiness(renamed).length, 0);
	const edited = applyMotionscaperCommands(applied, [{ type: 'layer/replace', compositionId: 'comp', layer: { ...target, transform: { ...target.transform, position: motionVector([90, 80, 0]) } } }]);
	assert.match(motionTrackingReadiness(edited)[0]!.message, /detach|reapply/iu);
	const detached = applyMotionscaperCommands(edited, createMotionscaperTrackingCommands(edited, { type: 'detach', compositionId: 'comp', targetLayerId: 'overlay', kind: 'point' }));
	assert.equal(motionTrackingReadiness(detached).length, 0); assert.deepEqual(detached.compositions[0]!.layers.find(layer => layer.id === 'overlay')!.transform.position.value, [90, 80, 0]);
});
test('Motion stabilization reuses inverse similarity and corner pin requires explicit renderer capability', () => {
	const tracked = analyzed('stabilize'); const applied = applyMotionscaperCommands(tracked, createMotionscaperTrackingCommands(tracked, { type: 'apply-stabilization', compositionId: 'comp', analysisId: 'track', targetLayerId: 'source', strength: 1, replaceAnimation: false }));
	assert.equal(motionTrackingReadiness(applied).length, 0); const transform = applied.compositions[0]!.layers.find(layer => layer.id === 'source')!.transform;
	assert.ok(Math.abs(evaluateInterpolationCurve(transform.position.curves[0]!, 4) + 2) < 1e-8);
	const planar = applyMotionscaperCommands(analyzed('planar'), [{ type: 'layer/replace', compositionId: 'comp', layer: createMotionLayer({ id: 'overlay', name: 'Card', durationFrames: 24,
		content: { kind: 'solid', color: motionColor([1, 0, 0, 1]), size: motionVector([30, 30]) } }) }]);
	const request = { type: 'apply-corner-pin' as const, compositionId: 'comp', analysisId: 'track', targetLayerId: 'overlay', effectId: 'pin', replaceAnimation: false };
	assert.throws(() => createMotionscaperTrackingCommands(planar, request), /corner.pin.*unavailable/iu);
	const pinned = applyMotionscaperCommands(planar, createMotionscaperTrackingCommands(planar, request, { cornerPin: true }));
	assert.equal(pinned.compositions[0]!.layers.find(layer => layer.id === 'overlay')!.effects[0]!.type, 'corner-pin');
	assert.equal(motionTrackingReadiness(pinned).length, 0);
});
test('Motion point application projects source pixels through static 2D geometry and refuses parenting', () => {
	const tracked = analyzed(); const source = tracked.compositions[0]!.layers.find(layer => layer.id === 'source')!;
	const scaled = applyMotionscaperCommands(tracked, [{ type: 'layer/replace', compositionId: 'comp', layer: { ...source, transform: { ...source.transform, scale: motionVector([2, 3, 1]), position: motionVector([10, 20, 0]) } } }]);
	const applied = applyMotionscaperCommands(scaled, createMotionscaperTrackingCommands(scaled, { type: 'apply-point', compositionId: 'comp', analysisId: 'track', targetLayerId: 'overlay', replaceAnimation: false }));
	const position = applied.compositions[0]!.layers.find(layer => layer.id === 'overlay')!.transform.position;
	assert.equal(evaluateInterpolationCurve(position.curves[0]!, 4), 4); assert.equal(evaluateInterpolationCurve(position.curves[1]!, 4), 6);
	const parented = applyMotionscaperCommands(tracked, [{ type: 'layer/replace', compositionId: 'comp', layer: { ...source, parentId: 'overlay' } }]);
	assert.throws(() => createMotionscaperTrackingCommands(parented, { type: 'apply-point', compositionId: 'comp', analysisId: 'track', targetLayerId: 'overlay', replaceAnimation: false }), /unparented/iu);
});
test('Motion lost samples cannot apply until explicitly corrected and removed analyses keep applied intent stale', () => {
	const project = trackingProject(); const settings = createMotionTrackingSettings({ mode: 'point', firstFrame: 0, frameCount: 2, points: [[20, 20]] });
	const result = createMotionTrackingResult({ id: 'track', binding: createMotionTrackingBinding(project, 'comp', 'source', settings), settings,
		samples: [{ frame: 0, status: 'manual', points: [[20, 20]], confidence: 1, error: 0 }, { frame: 1, status: 'lost', reason: 'occlusion' }] });
	const stored = applyMotionscaperCommands(project, createMotionscaperTrackingCommands(project, { type: 'accept', compositionId: 'comp', result }));
	const request = { type: 'apply-point' as const, compositionId: 'comp', analysisId: 'track', targetLayerId: 'overlay', replaceAnimation: false };
	assert.throws(() => createMotionscaperTrackingCommands(stored, request), /lost frames/iu);
	const corrected = applyMotionscaperCommands(stored, createMotionscaperTrackingCommands(stored, { type: 'correct', compositionId: 'comp', analysisId: 'track', frame: 1, points: [[21, 21]] }));
	const applied = applyMotionscaperCommands(corrected, createMotionscaperTrackingCommands(corrected, request));
	const removed = applyMotionscaperCommands(applied, createMotionscaperTrackingCommands(applied, { type: 'remove', compositionId: 'comp', analysisId: 'track' }));
	assert.match(motionTrackingReadiness(removed)[0]!.message, /missing/iu);
});
test('Motion tracking and its applied authority round trip through an authenticated portable archive', async () => {
	const bytes = new Uint8Array(10).fill(1); const digest = createHash('sha256').update(bytes).digest('hex'); const base = trackingProject();
	const tracked = analyzed('point', { ...base, assets: base.assets.map(asset => ({ ...asset, sha256: digest, storageKey: `motion-sha256:${digest}` })) });
	const applied = applyMotionscaperCommands(tracked, createMotionscaperTrackingCommands(tracked, { type: 'apply-point', compositionId: 'comp', analysisId: 'track', targetLayerId: 'overlay', replaceAnimation: false }));
	const archive = await exportMotionscaperArchive(applied, () => new Blob([bytes])); assert.ok(archive instanceof Blob);
	let committed = false; const chunks: Uint8Array[] = [];
	const reopened = await importMotionscaperArchive(archive, () => ({ async writeAssetChunk(_asset, bytes) { chunks.push(bytes.slice()); }, async finishAsset() {}, async commit() { committed = true; }, async rollback() { throw new Error('Unexpected rollback'); } }));
	assert.equal(reopened.kind, 'current'); assert.equal(committed, true); assert.deepEqual(Buffer.concat(chunks), Buffer.from(bytes));
	if (reopened.kind === 'current') { assert.deepEqual(reopened.project, applied); assert.equal(motionTrackingReadiness(reopened.project).length, 0); }
});
test('Motion self-applied point tracking reuses its original geometry when corrected', () => {
	const tracked = analyzed(); const request = { type: 'apply-point' as const, compositionId: 'comp', analysisId: 'track', targetLayerId: 'source', replaceAnimation: false };
	const applied = applyMotionscaperCommands(tracked, createMotionscaperTrackingCommands(tracked, request));
	const corrected = applyMotionscaperCommands(applied, createMotionscaperTrackingCommands(applied, { type: 'correct', compositionId: 'comp', analysisId: 'track', frame: 4, points: [[24, 25]] }));
	const reapplied = applyMotionscaperCommands(corrected, createMotionscaperTrackingCommands(corrected, request));
	const position = reapplied.compositions[0]!.layers.find(layer => layer.id === 'source')!.transform.position;
	assert.equal(evaluateInterpolationCurve(position.curves[0]!, 4), 4); assert.equal(evaluateInterpolationCurve(position.curves[1]!, 4), 5);
	assert.equal(motionTrackingReadiness(reapplied).length, 0);
});
test('Motion deleted corner-pin effects require explicit replacement or detachment', () => {
	const tracked = analyzed('planar'); const request = { type: 'apply-corner-pin' as const, compositionId: 'comp', analysisId: 'track', targetLayerId: 'source', effectId: 'pin', replaceAnimation: false };
	const pinned = applyMotionscaperCommands(tracked, createMotionscaperTrackingCommands(tracked, request, { cornerPin: true }));
	const source = pinned.compositions[0]!.layers.find(layer => layer.id === 'source')!;
	const edited = applyMotionscaperCommands(pinned, [{ type: 'layer/replace', compositionId: 'comp', layer: { ...source, effects: [] } }]);
	assert.throws(() => createMotionscaperTrackingCommands(edited, request, { cornerPin: true }), /detach|replace/iu);
	const replaced = applyMotionscaperCommands(edited, createMotionscaperTrackingCommands(edited, { ...request, replaceAnimation: true }, { cornerPin: true }));
	assert.equal(motionTrackingReadiness(replaced).length, 0);
});
test('Motion stabilization conjugates rotation, scale and translation through the original source anchor', () => {
	const base = trackingProject(); const source = base.compositions[0]!.layers.find(layer => layer.id === 'source')!;
	const project = applyMotionscaperCommands(base, [{ type: 'layer/replace', compositionId: 'comp', layer: { ...source, transform: { ...source.transform,
		anchor: motionVector([8, 9, 0]), position: motionVector([13, 20, 0]), scale: motionVector([2, 2, 1]), rotation: motionVector([0, 0, 30]) } } }]);
	const settings = createMotionTrackingSettings({ mode: 'stabilize', firstFrame: 0, frameCount: 2, points: [[10, 10], [40, 10], [40, 40], [10, 40]] });
	const angle = Math.PI / 12; const moved = settings.points.map(([x, y]) => [1.1 * (Math.cos(angle) * x - Math.sin(angle) * y) + 3, 1.1 * (Math.sin(angle) * x + Math.cos(angle) * y) - 2] as const);
	const result = createMotionTrackingResult({ id: 'track', binding: createMotionTrackingBinding(project, 'comp', 'source', settings), settings,
		samples: [settings.points, moved].map((points, frame) => ({ frame, points, status: 'tracked', confidence: 1, error: 0 })) });
	const stored = applyMotionscaperCommands(project, createMotionscaperTrackingCommands(project, { type: 'accept', compositionId: 'comp', result }));
	const applied = applyMotionscaperCommands(stored, createMotionscaperTrackingCommands(stored, { type: 'apply-stabilization', compositionId: 'comp', analysisId: 'track', targetLayerId: 'source', strength: 1, replaceAnimation: false }));
	const transform = applied.compositions[0]!.layers.find(layer => layer.id === 'source')!.transform;
	const px = evaluateInterpolationCurve(transform.position.curves[0]!, 1); const py = evaluateInterpolationCurve(transform.position.curves[1]!, 1);
	const scale = evaluateInterpolationCurve(transform.scale.curves[0]!, 1); const rotation = evaluateInterpolationCurve(transform.rotation.curves[2]!, 1) * Math.PI / 180;
	for (let index = 0; index < 4; index++) {
		const [x, y] = moved[index]!; const [rx, ry] = settings.points[index]!; const originalAngle = Math.PI / 6;
		const actual = [px + scale * (Math.cos(rotation) * (x - 8) - Math.sin(rotation) * (y - 9)), py + scale * (Math.sin(rotation) * (x - 8) + Math.cos(rotation) * (y - 9))];
		const expected = [13 + 2 * (Math.cos(originalAngle) * (rx - 8) - Math.sin(originalAngle) * (ry - 9)), 20 + 2 * (Math.sin(originalAngle) * (rx - 8) + Math.cos(originalAngle) * (ry - 9))];
		assert.ok(Math.hypot(actual[0]! - expected[0]!, actual[1]! - expected[1]!) < 1e-8);
	}
});
