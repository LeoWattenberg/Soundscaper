/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { trackingProject } from './helpers/motionscaper-tracking-fixture.ts';
import { createMotionSurface } from '../src/common/editor/motion-surface.ts';
import { createMotionTrackingSettings } from '../src/common/editor/motion-tracking-contract.ts';
import { analyzeMotionTracking, type MotionTrackingFrameProvider } from '../src/common/editor/motion-tracking-analysis.ts';
function surface(frame: number) {
	const surface = createMotionSurface(64, 64);
	for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
		const sx = x - frame; const sy = y - frame;
		const value = sx >= 12 && sy >= 12 && sx < 48 && sy < 48 && (Math.floor(sx / 7) + Math.floor(sy / 7)) % 2 === 0 ? 1 : 0;
		surface.pixels.set([value, value, value, 1], (y * 64 + x) * 4);
	}
	return surface;
}
test('Motion point, planar and stabilization analysis reuse bounded tracking primitives on pinned source frames', async () => {
	for (const mode of ['point', 'planar', 'stabilize'] as const) {
		let active = 0; let maximum = 0; let reads = 0;
		const provider: MotionTrackingFrameProvider = { async read(request) { active++; maximum = Math.max(maximum, active); reads++; await Promise.resolve(); active--; return { assetSha256: request.asset.sha256, sourceTime: request.sourceTime, surface: surface(request.frame) }; } };
		const settings = { ...createMotionTrackingSettings({ mode, firstFrame: 0, frameCount: 3, points: mode === 'point' ? [[14, 14]] : [[10, 10], [51, 10], [51, 51], [10, 51]] }), pyramidLevels: 1, quality: 0.01, minimumDistance: 3 };
		const result = await analyzeMotionTracking({ id: mode, project: trackingProject(), compositionId: 'comp', layerId: 'source', settings, provider });
		assert.equal(maximum, 1); assert.equal(reads, 3); assert.equal(result.samples.length, 3);
		const final = result.samples[2]!; assert.equal(final.status, 'tracked');
		final.points.forEach((point, index) => { assert.ok(Math.abs(point[0] - settings.points[index]![0] - 2) < 0.4, `${mode} x ${point[0]}`); assert.ok(Math.abs(point[1] - settings.points[index]![1] - 2) < 0.4, `${mode} y ${point[1]}`); });
	}
});
test('Motion analysis rejects stale decoder custody and cancellation publishes no partial result', async () => {
	const settings = createMotionTrackingSettings({ mode: 'point', firstFrame: 0, frameCount: 3, points: [[14, 14]] });
	const base = { id: 'point', project: trackingProject(), compositionId: 'comp', layerId: 'source', settings };
	await assert.rejects(analyzeMotionTracking({ ...base, provider: { async read(request) { return { assetSha256: 'b'.repeat(64), sourceTime: request.sourceTime, surface: surface(0) }; } } }), /pinned|custody/iu);
	const controller = new AbortController(); let reads = 0;
	await assert.rejects(analyzeMotionTracking({ ...base, signal: controller.signal, provider: { async read(request) { reads++; controller.abort(new Error('cancel tracking')); return { assetSha256: request.asset.sha256, sourceTime: request.sourceTime, surface: surface(0) }; } } }), /cancel tracking/u);
	assert.equal(reads, 1);
});
test('Motion analysis records explicit loss on textureless frames instead of fabricating movement', async () => {
	const settings = createMotionTrackingSettings({ mode: 'point', firstFrame: 0, frameCount: 3, points: [[14, 14]] });
	const result = await analyzeMotionTracking({ id: 'point', project: trackingProject(), compositionId: 'comp', layerId: 'source', settings,
		provider: { async read(request) { return { assetSha256: request.asset.sha256, sourceTime: request.sourceTime, surface: createMotionSurface(64, 64) }; } } });
	assert.equal(result.samples[1]?.status, 'lost'); assert.equal(result.samples[2]?.status, 'lost');
});
