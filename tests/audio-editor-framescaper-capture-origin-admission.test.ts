/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createFramescaperCaptureAdminInterlock } from '../src/common/editor/controller/framescaper-capture-admin-interlock.ts';
import {
	createFramescaperCaptureStartAdmissionCoordinator,
} from '../src/common/editor/controller/framescaper-capture-start-admission.ts';

const SHA_A = 'ab'.repeat(32);
const SHA_B = 'cd'.repeat(32);

test('start admission synchronously freezes and protects the clicked origin until release', async () => {
	const events: string[] = [];
	const interlock = createFramescaperCaptureAdminInterlock();
	let current = origin('project-a', 4, SHA_A, 'sequence-a', 500_000);
	const coordinator = createFramescaperCaptureStartAdmissionCoordinator({
		captureOrigin: () => current,
		beginCaptureAdmission: (projectId) => interlock.beginCaptureAdmission(projectId),
		prepareCaptureStart() { events.push('prepare'); },
		onChange() { events.push('change'); },
	});

	const lease = coordinator.begin();
	assert.deepEqual(coordinator.snapshot, {
		generation: 1,
		origin: {
			schemaFamily: 'framescaper', schemaVersion: 1,
			projectId: 'project-a', baseRevision: 4, baseSha256: SHA_A,
			sequenceId: 'sequence-a', playheadMicroseconds: 500_000,
		},
	});
	assert.throws(
		() => interlock.beginAdminOperation({ kind: 'delete', projectId: 'project-a' }),
		/active capture authority/iu,
	);
	assert.throws(() => coordinator.begin(), /active capture authority/iu);

	await lease.prepare();
	current = origin('project-b', 9, SHA_B, 'sequence-b', 750_000);
	assert.deepEqual(coordinator.captureOrigin(), origin(
		'project-a', 4, SHA_A, 'sequence-a', 500_000,
	), 'project switches after admission retain the clicked origin');
	assert.equal(lease.release(), true);
	assert.equal(lease.release(), false);
	assert.deepEqual(coordinator.captureOrigin(), current);
	assert.equal(coordinator.snapshot, null);
	assert.deepEqual(events, ['prepare', 'change', 'change']);
	interlock.beginAdminOperation({ kind: 'delete', projectId: 'project-a' }).release();
});

test('background admission permits a project switch during preparation while retaining its origin', async () => {
	let releasePreparation!: () => void;
	const preparation = new Promise<void>((resolve) => { releasePreparation = resolve; });
	const interlock = createFramescaperCaptureAdminInterlock();
	let current = origin('project-a', 4, SHA_A, 'sequence-a', 500_000);
	const coordinator = createFramescaperCaptureStartAdmissionCoordinator({
		captureOrigin: () => current,
		beginCaptureAdmission: (projectId) => interlock.beginCaptureAdmission(projectId),
		prepareCaptureStart: () => preparation,
	});
	const lease = coordinator.begin('background');
	const pending = lease.prepare();
	current = origin('project-b', 9, SHA_B, 'sequence-b', 750_000);
	releasePreparation();
	await pending;
	assert.deepEqual(coordinator.captureOrigin(), origin(
		'project-a', 4, SHA_A, 'sequence-a', 500_000,
	));
	assert.equal(lease.release(), true);
});

test('preparation rejects an origin mutation during the project flush and remains explicitly releasable', async () => {
	let releasePreparation!: () => void;
	const preparation = new Promise<void>((resolve) => { releasePreparation = resolve; });
	const interlock = createFramescaperCaptureAdminInterlock();
	let current = origin('project-a', 4, SHA_A, 'sequence-a', 500_000);
	const coordinator = createFramescaperCaptureStartAdmissionCoordinator({
		captureOrigin: () => current,
		beginCaptureAdmission: (projectId) => interlock.beginCaptureAdmission(projectId),
		prepareCaptureStart: () => preparation,
	});
	const lease = coordinator.begin();
	const pending = lease.prepare();
	current = origin('project-a', 5, SHA_B, 'sequence-a', 500_000);
	releasePreparation();
	await assert.rejects(pending, /origin changed during start admission/iu);
	assert.deepEqual(coordinator.captureOrigin(), origin(
		'project-a', 4, SHA_A, 'sequence-a', 500_000,
	));
	assert.equal(lease.release(), true);
	assert.deepEqual(coordinator.captureOrigin(), current);
});

test('disposal invalidates an admission waiting on preparation without leaking its interlock', async () => {
	let releasePreparation!: () => void;
	const preparation = new Promise<void>((resolve) => { releasePreparation = resolve; });
	const interlock = createFramescaperCaptureAdminInterlock();
	const coordinator = createFramescaperCaptureStartAdmissionCoordinator({
		captureOrigin: () => origin('project-a', 4, SHA_A, 'sequence-a', 500_000),
		beginCaptureAdmission: (projectId) => interlock.beginCaptureAdmission(projectId),
		prepareCaptureStart: () => preparation,
	});
	const lease = coordinator.begin();
	const pending = lease.prepare();
	coordinator.dispose();
	releasePreparation();
	await assert.rejects(pending, /disposed during start admission/iu);
	assert.equal(lease.release(), true);
	assert.throws(() => coordinator.begin(), /disposed/iu);
	interlock.beginAdminOperation({ kind: 'close', projectId: 'project-a' }).release();
});

function origin(
	projectId: string,
	baseRevision: number,
	baseSha256: string,
	sequenceId: string,
	playheadMicroseconds: number,
) {
	return Object.freeze({
		projectFence: Object.freeze({
			schemaFamily: 'framescaper' as const, schemaVersion: 1 as const,
			projectId, baseRevision, baseSha256,
		}),
		origin: Object.freeze({ sequenceId, playheadMicroseconds, destination: 'both' as const }),
	});
}
