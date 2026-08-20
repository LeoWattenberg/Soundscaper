/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	FramescaperCaptureOriginProtectedError,
	createFramescaperCaptureOriginGuard,
	type FramescaperCaptureOriginBinding,
	type FramescaperCaptureOriginReleaseOutcome,
} from '../src/common/editor/controller/framescaper-capture-origin-guard.ts';

const ORIGIN_A = Object.freeze({
	projectId: 'project-a',
	baseRevision: 7,
	baseSha256: 'ab'.repeat(32),
	sequenceId: 'sequence-a',
	playheadMicroseconds: 2_500_000,
}) satisfies FramescaperCaptureOriginBinding;

const ORIGIN_B = Object.freeze({
	projectId: 'project-b',
	baseRevision: 12,
	baseSha256: 'cd'.repeat(32),
	sequenceId: 'sequence-b',
	playheadMicroseconds: 750_000,
}) satisfies FramescaperCaptureOriginBinding;

test('capture origin binding freezes exact project and timeline publication authority', () => {
	const guard = createFramescaperCaptureOriginGuard();
	assert.deepEqual(guard.snapshot(), {
		active: false,
		generation: null,
		origin: null,
		activeProjectId: null,
		activeProjectIsOrigin: false,
		editBlocked: false,
		closeBlocked: false,
		deleteBlocked: false,
		handoffBlocked: false,
	});

	const authority = guard.bind(ORIGIN_A);
	const snapshot = guard.snapshot('project-a');
	assert.deepEqual(authority, {
		kind: 'framescaper-capture-origin-authority',
		generation: 1,
	});
	assert.deepEqual(snapshot, {
		active: true,
		generation: 1,
		origin: ORIGIN_A,
		activeProjectId: 'project-a',
		activeProjectIsOrigin: true,
		editBlocked: true,
		closeBlocked: true,
		deleteBlocked: true,
		handoffBlocked: true,
	});
	assert.equal(Object.isFrozen(authority), true);
	assert.equal(Object.isFrozen(snapshot), true);
	assert.equal(Object.isFrozen(snapshot.origin), true);
	assert.throws(() => guard.bind(ORIGIN_B), /already protects project-a/u);
});

test('switching away leaves other projects fully editable while the origin stays protected', () => {
	const guard = createFramescaperCaptureOriginGuard();
	guard.bind(ORIGIN_A);

	assert.equal(guard.isOriginProject('project-a'), true);
	assert.equal(guard.isOriginProject('project-b'), false);
	assert.deepEqual(guard.snapshot('project-b'), {
		active: true,
		generation: 1,
		origin: ORIGIN_A,
		activeProjectId: 'project-b',
		activeProjectIsOrigin: false,
		editBlocked: false,
		closeBlocked: false,
		deleteBlocked: false,
		handoffBlocked: false,
	});
	assert.doesNotThrow(() => guard.assertEditAllowed('project-b'));
	assert.doesNotThrow(() => guard.assertCloseAllowed('project-b'));
	assert.doesNotThrow(() => guard.assertDeleteAllowed('project-b'));
	assert.doesNotThrow(() => guard.assertHandoffAllowed('project-b'));
});

test('every destructive origin operation fails with a closed actionable error', () => {
	const guard = createFramescaperCaptureOriginGuard();
	guard.bind(ORIGIN_A);
	const operations = [
		['edit', () => guard.assertEditAllowed('project-a')],
		['close', () => guard.assertCloseAllowed('project-a')],
		['delete', () => guard.assertDeleteAllowed('project-a')],
		['handoff', () => guard.assertHandoffAllowed('project-a')],
	] as const;

	for (const [action, operation] of operations) {
		assert.throws(operation, (error: unknown) => {
			assert.ok(error instanceof FramescaperCaptureOriginProtectedError);
			assert.equal(error.code, 'FRAMESCAPER_CAPTURE_ORIGIN_PROTECTED');
			assert.equal(error.action, action);
			assert.equal(error.projectId, 'project-a');
			assert.equal(error.generation, 1);
			return true;
		});
	}
});

test('only stop or discard releases a fence and stale authority cannot release a newer fence', () => {
	const guard = createFramescaperCaptureOriginGuard();
	const stale = guard.bind(ORIGIN_A);
	assert.throws(
		() => guard.release(stale, 'failed' as FramescaperCaptureOriginReleaseOutcome),
		/stop or discard/u,
	);
	assert.equal(guard.isOriginProject('project-a'), true);
	assert.equal(guard.release(stale, 'stopped'), true);
	assert.equal(guard.release(stale, 'stopped'), false, 'settled authority is idempotently stale');

	const current = guard.bind(ORIGIN_B);
	assert.equal(current.generation, 2);
	assert.equal(guard.release(stale, 'discarded'), false);
	assert.equal(guard.isOriginProject('project-b'), true);
	assert.equal(guard.snapshot('project-b').generation, 2);
	assert.equal(guard.release(current, 'discarded'), true);
	assert.equal(guard.snapshot('project-b').active, false);
});

test('origin inputs and active-project projections reject ambiguous identity values', () => {
	const guard = createFramescaperCaptureOriginGuard();
	assert.throws(() => guard.bind({ ...ORIGIN_A, baseRevision: -1 }), /base revision/u);
	assert.throws(() => guard.bind({ ...ORIGIN_A, baseSha256: 'ABC' }), /SHA-256/u);
	assert.throws(() => guard.bind({ ...ORIGIN_A, sequenceId: ' sequence-a' }), /sequenceId/u);
	assert.throws(
		() => guard.bind({ ...ORIGIN_A, extra: true } as FramescaperCaptureOriginBinding),
		/closed shape/u,
	);
	assert.throws(() => guard.snapshot(' project-a'), /active projectId/u);
});
