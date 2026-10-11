/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { renderMotionAeHostComposition, type MotionAeRenderHost } from '../src/common/editor/motion-ae-host-render.ts';
const composition = { id: 'comp-1', name: 'Whole composition', width: 64, height: 64, pixelAspect: 1, frameRate: 2, duration: 1 };
function fixture(options: { queued?: number; cancelled?: boolean; renderFailure?: boolean; cleanupFailure?: boolean; frameCount?: number; alpha?: boolean } = {}) {
	const operations: string[] = [];
	const host: MotionAeRenderHost = { queueLength: options.queued ?? 0, rendering: false, checkCancelled: () => {},
		begin: () => {
			operations.push('begin'); return {
				templates: ['User PNG RGBA'], chooseTemplate: () => options.cancelled ? null : 'User PNG RGBA',
				configure: (template, duration) => { operations.push(`${template}:${String(duration)}`); },
				render: () => { operations.push('render'); if (options.renderFailure) throw new Error('native render stopped'); },
				frames: () => Array.from({ length: options.frameCount ?? 2 }, (_, i) => ({ index: 10 + i, byteLength: 120, width: 64, height: 64, bitDepth: 8, alphaChannels: options.alpha ?? true })),
				retain: (frame, id) => { operations.push(`retain:${String(frame.index)}`); return { path: `media/${id}.png`, byteLength: frame.byteLength }; },
				removeQueueItem: () => { operations.push('remove'); if (options.cleanupFailure) throw new Error('queue cleanup failed'); },
			};
		},
	}; return { host, operations };
}
test('AE fallback renders one whole composition with user-selected template and retains every ordered frame', () => {
	const { host, operations } = fixture(); const result = renderMotionAeHostComposition(composition, host);
	assert.deepEqual(operations, ['begin', 'User PNG RGBA:1', 'render', 'retain:10', 'retain:11', 'remove']);
	assert.equal(result.footage.length, 2); assert.deepEqual(result.report.map((entry) => entry.propertyPath), ['frame/0', 'frame/1']);
	assert.ok(result.report.every((entry) => entry.status === 'rendered' && entry.mediaId));
	assert.match(result.report[0]!.message, /unqualified/iu);
});
test('AE fallback refuses existing queue work and excessive frame/surface budgets before mutation', () => {
	const busy = fixture({ queued: 1 }); assert.throws(() => renderMotionAeHostComposition(composition, busy.host), /empty render queue/iu); assert.equal(busy.operations.length, 0);
	const bounded = fixture(); assert.throws(() => renderMotionAeHostComposition({ ...composition, duration: 2000 }, bounded.host), /budget/u); assert.equal(bounded.operations.length, 0);
	assert.throws(() => renderMotionAeHostComposition({ ...composition, width: 16384, height: 16384 }, bounded.host), /budget/u);
});
test('AE fallback preserves cancellation, partial output refusal and primary plus queue cleanup failures', () => {
	const cancelled = fixture({ cancelled: true }); assert.throws(() => renderMotionAeHostComposition(composition, cancelled.host), /cancelled/u); assert.deepEqual(cancelled.operations, ['begin', 'remove']);
	assert.throws(() => renderMotionAeHostComposition(composition, fixture({ frameCount: 1 }).host), /complete.*frame/iu);
	assert.throws(() => renderMotionAeHostComposition(composition, fixture({ alpha: false }).host), /alpha/iu);
	assert.throws(() => renderMotionAeHostComposition(composition, fixture({ renderFailure: true, cleanupFailure: true }).host), /native render stopped.*queue cleanup failed/u);
});
