/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createFramescaperCaptureProjectWriteAuthority,
	type FramescaperCaptureProjectLock,
} from '../src/common/editor/controller/framescaper-capture-project-write-authority.ts';

test('capture write admission requires a writable open tab and the active editor lock', () => {
	let tab: Readonly<{ readOnly: boolean; intrinsicReadOnly: boolean }> | null = null;
	let activeProjectId: string | null = 'project-a';
	let activeReadOnly = false;
	let activeLock: FramescaperCaptureProjectLock | null = null;
	const authority = createFramescaperCaptureProjectWriteAuthority({
		getProjectAdmission: () => tab,
		getActiveProjectId: () => activeProjectId,
		getActiveReadOnly: () => activeReadOnly,
		getActiveLock: () => activeLock,
		acquireProjectLock: async () => lock('project-a'),
	});

	assert.throws(() => authority.assertProjectWritable('project-a'), /writable open project/iu);
	tab = { readOnly: true, intrinsicReadOnly: false };
	assert.throws(() => authority.assertProjectWritable('project-a'), /read-only/iu);
	tab = { readOnly: false, intrinsicReadOnly: true };
	assert.throws(() => authority.assertProjectWritable('project-a'), /read-only/iu);
	tab = { readOnly: false, intrinsicReadOnly: false };
	assert.throws(() => authority.assertProjectWritable('project-a'), /write lock/iu);
	activeLock = lock('project-a');
	authority.assertProjectWritable('project-a');
	activeReadOnly = true;
	assert.throws(() => authority.assertProjectWritable('project-a'), /write lock/iu);
	activeReadOnly = false;
	activeProjectId = 'project-b';
	authority.assertProjectWritable('project-a');
});

test('active-project authority borrows the exact editor lock and detects its loss', async () => {
	let lose!: () => void;
	const activeLock = lock('project-a', { lost: new Promise<void>((resolve) => { lose = resolve; }) });
	let currentLock: FramescaperCaptureProjectLock | null = activeLock;
	let acquired = 0;
	const authority = createFramescaperCaptureProjectWriteAuthority({
		getProjectAdmission: () => ({ readOnly: false, intrinsicReadOnly: false }),
		getActiveProjectId: () => 'project-a', getActiveReadOnly: () => false,
		getActiveLock: () => currentLock,
		acquireProjectLock: async () => { acquired += 1; return lock('project-a'); },
	});
	const lease = await authority.acquireProjectWriteAuthority('project-a');
	lease.assertCurrent();
	assert.equal(acquired, 0);
	lose();
	await Promise.resolve();
	assert.throws(() => lease.assertCurrent(), /write authority changed/iu);
	await lease.release();
	assert.equal(activeLock.releases, 0, 'the app still owns its borrowed editor lock');
	currentLock = null;
	assert.throws(() => lease.assertCurrent(), /write authority changed/iu);
});

test('inactive publication owns and releases a fresh lock while detecting asynchronous loss', async () => {
	let lose!: () => void;
	const lost = new Promise<void>((resolve) => { lose = resolve; });
	const acquired = lock('project-a', { lost });
	const authority = createFramescaperCaptureProjectWriteAuthority({
		getProjectAdmission: () => ({ readOnly: false, intrinsicReadOnly: false }),
		getActiveProjectId: () => 'project-b', getActiveReadOnly: () => false,
		getActiveLock: () => lock('project-b'),
		acquireProjectLock: async () => acquired,
	});
	const lease = await authority.acquireProjectWriteAuthority('project-a');
	lease.assertCurrent();
	lose();
	await Promise.resolve();
	assert.throws(() => lease.assertCurrent(), /write authority changed/iu);
	await lease.release();
	assert.equal(acquired.releases, 1);
});

test('a contended fresh lock is released and never returned as publication authority', async () => {
	const acquired = lock('project-a', { readOnly: true });
	const authority = createFramescaperCaptureProjectWriteAuthority({
		getProjectAdmission: () => ({ readOnly: false, intrinsicReadOnly: false }),
		getActiveProjectId: () => 'project-b', getActiveReadOnly: () => false,
		getActiveLock: () => null,
		acquireProjectLock: async () => acquired,
	});
	await assert.rejects(authority.acquireProjectWriteAuthority('project-a'), /write lock/iu);
	assert.equal(acquired.releases, 1);
});

function lock(
	projectId: string,
	options: Readonly<{ readOnly?: boolean; lost?: PromiseLike<unknown> }> = {},
): FramescaperCaptureProjectLock & { releases: number } {
	let releases = 0;
	return {
		projectId, readOnly: options.readOnly === true, lost: options.lost ?? null,
		finished: Promise.resolve(),
		get releases() { return releases; },
		release() { releases += 1; },
	};
}
