/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createProjectLockService,
	type ProjectLockServiceRuntime,
} from '../src/common/editor/controller/project-lock-service.ts';
import { PROJECT_BIN_LINKED_VIDEO_RELINK_TASK } from '../src/common/editor/controller/project-bin-linked-video-relink-service.ts';
import type { ProjectLifecycleLock } from '../src/common/editor/controller/project-lifecycle-types.ts';

function deferred<Value>() {
	let resolve: (value: Value | PromiseLike<Value>) => void = () => undefined;
	let reject: (error: unknown) => void = () => undefined;
	const promise = new Promise<Value>((complete, fail) => {
		resolve = complete;
		reject = fail;
	});
	return { promise, reject, resolve };
}

interface TestLock extends ProjectLifecycleLock {
	releases: number;
}

function createLock(
	projectId: string,
	options: Partial<ProjectLifecycleLock> = {},
): TestLock {
	return {
		projectId,
		readOnly: false,
		method: 'test',
		releases: 0,
		release() { this.releases += 1; },
		...options,
	};
}

function createFixture(initialLock: TestLock | null = null) {
	let projectId: string | null = 'project-a';
	let metadata = {};
	let acquisition: (projectId: string, force: boolean) => Promise<ProjectLifecycleLock> = async (id) => createLock(id);
	let timerSequence = 0;
	const timers = new Map<number, () => void>();
	const publications = deferred<void>();
	const updates: Array<Readonly<Record<string, unknown>>> = [];
	const statuses: Array<readonly [string, string]> = [];
	const errors: unknown[] = [];
	const cancelledTasks: string[] = [];
	const state = {
		disposed: false,
		readOnly: Boolean(initialLock?.readOnly),
		projectLock: initialLock as ProjectLifecycleLock | null,
		projectLockRetryTimer: 0,
	};
	const runtime: ProjectLockServiceRuntime = {
		state,
		cancelTask: (name) => { cancelledTasks.push(name); },
		getProjectId: () => projectId,
		getProjectMetadata: () => metadata,
		acquireProjectLock: (id, options) => acquisition(id, Boolean(options?.force)),
		setProjectReadOnly: (id, update) => { updates.push({ projectId: id, ...update }); },
		publishProjectState: () => { publications.resolve(); },
		setStatus: (message, status) => { statuses.push([message, status]); },
		handleError: (error) => { errors.push(error); },
		copy: {
			ready: 'Ready',
			projectOpenOtherTab: 'Open elsewhere',
			projectReadOnly: 'Read-only',
		},
		currentTimeMs: () => 1_000,
		retryMaximumMs: 5_000,
		scheduleTimer: (callback) => {
			const id = ++timerSequence;
			timers.set(id, callback);
			return id;
		},
		clearTimer: (id) => { timers.delete(id); },
	};
	return {
		cancelledTasks,
		errors,
		publications,
		service: createProjectLockService(runtime),
		state,
		statuses,
		timers,
		updates,
		setAcquisition(value: typeof acquisition) { acquisition = value; },
		setMetadata(value: typeof metadata) { metadata = value; },
		setProjectId(value: string | null) { projectId = value; },
	};
}

test('an available queued lock promotes the same project without polling', async () => {
	const available = deferred<ProjectLifecycleLock | null>();
	const lock = createLock('project-a', { readOnly: true, available: available.promise });
	const fixture = createFixture(lock);
	fixture.service.scheduleProjectLockRecovery('project-a', lock);

	lock.readOnly = false;
	available.resolve(lock);
	await fixture.publications.promise;

	assert.equal(fixture.state.projectLock, lock);
	assert.equal(fixture.state.readOnly, false);
	assert.equal(fixture.timers.size, 0);
	assert.deepEqual(fixture.updates, [{
		projectId: 'project-a',
		readOnly: false,
		reason: null,
		lockMethod: 'test',
	}]);
	assert.deepEqual(fixture.statuses, [['Ready', 'success']]);
});

test('late recovery acquisition is released after the active project changes', async () => {
	const previous = createLock('project-a', { readOnly: true });
	const next = createLock('project-a');
	const acquisition = deferred<ProjectLifecycleLock>();
	const fixture = createFixture(previous);
	fixture.setAcquisition(() => acquisition.promise);

	const recovery = fixture.service.recoverProjectLock('project-a', previous);
	fixture.setProjectId('project-b');
	acquisition.resolve(next);
	await recovery;

	assert.equal(next.releases, 1);
	assert.equal(previous.releases, 0);
	assert.equal(fixture.state.projectLock, previous);
	assert.equal(fixture.updates.length, 0);
	assert.equal(fixture.statuses.length, 0);
});

test('a forced claim discards its result if disposal wins the acquisition race', async () => {
	const previous = createLock('project-a', { readOnly: true });
	const next = createLock('project-a');
	const acquisition = deferred<ProjectLifecycleLock>();
	const fixture = createFixture(previous);
	fixture.setAcquisition((_projectId, force) => {
		assert.equal(force, true);
		return acquisition.promise;
	});

	const claim = fixture.service.claimProjectLock();
	await Promise.resolve();
	fixture.state.disposed = true;
	acquisition.resolve(next);

	assert.equal(await claim, false);
	assert.equal(previous.releases, 1);
	assert.equal(next.releases, 1);
	assert.equal(fixture.state.projectLock, null);
	assert.equal(fixture.updates.length, 0);
});

test('a successful forced claim publishes writable session ownership', async () => {
	const previous = createLock('project-a', { readOnly: true });
	const next = createLock('project-a');
	const fixture = createFixture(previous);
	fixture.setAcquisition(async (_projectId, force) => {
		assert.equal(force, true);
		return next;
	});

	assert.equal(await fixture.service.claimProjectLock(), true);
	assert.equal(previous.releases, 1);
	assert.equal(fixture.state.projectLock, next);
	assert.equal(fixture.state.readOnly, false);
	assert.deepEqual(fixture.updates.at(-1), {
		projectId: 'project-a', readOnly: false, reason: null, lockMethod: 'test',
	});
	assert.deepEqual(fixture.statuses.at(-1), ['Ready', 'success']);
});

test('recovery keeps a competing lock read-only and schedules another attempt', async () => {
	const previous = createLock('project-a', { readOnly: true });
	const next = createLock('project-a', { readOnly: true, retryAt: 1_100 });
	const fixture = createFixture(previous);

	await fixture.service.recoverProjectLock('project-a', previous, next);

	assert.equal(previous.releases, 1);
	assert.equal(fixture.state.projectLock, next);
	assert.equal(fixture.state.readOnly, true);
	assert.equal(fixture.timers.size, 1);
	assert.deepEqual(fixture.updates.at(-1), {
		projectId: 'project-a', readOnly: true, reason: 'project-lock', lockMethod: 'test',
	});
	assert.deepEqual(fixture.statuses.at(-1), ['Open elsewhere', 'error']);
});

test('lock loss reacquires ownership and preserves intrinsic read-only metadata', async () => {
	const lost = deferred<void>();
	const previous = createLock('project-a', { lost: lost.promise });
	const next = createLock('project-a');
	const acquisition = deferred<ProjectLifecycleLock>();
	const fixture = createFixture(previous);
	fixture.setMetadata({ intrinsicReadOnly: true, intrinsicReadOnlyReason: 'Imported read-only' });
	fixture.setAcquisition(() => acquisition.promise);
	fixture.service.watchProjectLockLoss('project-a', previous);

	lost.resolve();
	await Promise.resolve();
	assert.deepEqual(fixture.cancelledTasks, [PROJECT_BIN_LINKED_VIDEO_RELINK_TASK]);
	acquisition.resolve(next);
	await fixture.publications.promise;

	assert.equal(previous.releases, 1);
	assert.equal(fixture.state.projectLock, next);
	assert.equal(fixture.state.readOnly, true);
	assert.deepEqual(fixture.statuses.at(-1), ['Imported read-only', 'error']);
});

test('a forced claim that remains contested stays read-only', async () => {
	const previous = createLock('project-a', { readOnly: true });
	const next = createLock('project-a', { readOnly: true, retryAt: 2_000 });
	const fixture = createFixture(previous);
	fixture.setAcquisition(async () => next);

	assert.equal(await fixture.service.claimProjectLock(), false);
	assert.equal(fixture.state.projectLock, next);
	assert.equal(fixture.state.readOnly, true);
	assert.deepEqual(fixture.statuses.at(-1), ['Open elsewhere', 'error']);
});

test('an unavailable queued handoff falls back to timed recovery', async () => {
	const available = deferred<ProjectLifecycleLock | null>();
	const lock = createLock('project-a', { readOnly: true, available: available.promise });
	const fixture = createFixture(lock);
	fixture.service.scheduleProjectLockRecovery('project-a', lock);

	available.resolve(null);
	await Promise.resolve();
	await Promise.resolve();

	assert.equal(lock.available, null);
	assert.equal(lock.retryAt, 2_000);
	assert.equal(fixture.timers.size, 1);
});

test('timed recovery reports acquisition failures and remains scheduled', async () => {
	const expected = new Error('lock backend failed');
	const lock = createLock('project-a', { readOnly: true, retryAt: 1_000 });
	const fixture = createFixture(lock);
	fixture.setAcquisition(async () => { throw expected; });
	fixture.service.scheduleProjectLockRecovery('project-a', lock);
	const callback = [...fixture.timers.values()][0];
	assert.ok(callback);

	callback();
	await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));

	assert.deepEqual(fixture.errors, [expected]);
	assert.notEqual(fixture.state.projectLockRetryTimer, 0);
	assert.equal(fixture.timers.has(fixture.state.projectLockRetryTimer), true);
});

test('intrinsic read-only metadata prevents stealing a writer lock', async () => {
	const previous = createLock('project-a', { readOnly: true });
	const fixture = createFixture(previous);
	let acquisitions = 0;
	fixture.setMetadata({ intrinsicReadOnly: true });
	fixture.setAcquisition(async (projectId) => {
		acquisitions += 1;
		return createLock(projectId);
	});

	assert.equal(await fixture.service.claimProjectLock(), false);
	assert.equal(acquisitions, 0);
	assert.equal(previous.releases, 0);
});

test('release clears recovery scheduling and waits for lock shutdown', async () => {
	const finished = deferred<void>();
	const lock = createLock('project-a', { readOnly: true, finished: finished.promise });
	const fixture = createFixture(lock);
	fixture.service.scheduleProjectLockRecovery('project-a', lock);
	assert.equal(fixture.timers.size, 1);

	const release = fixture.service.releaseProjectLock();
	assert.equal(lock.releases, 1);
	assert.equal(fixture.state.projectLock, null);
	assert.equal(fixture.timers.size, 0);
	finished.resolve();
	await release;
});
