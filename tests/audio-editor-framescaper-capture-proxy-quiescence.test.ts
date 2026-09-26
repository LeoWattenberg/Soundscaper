/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createFramescaperCaptureProxySaveQuiescence } from '../src/common/editor/controller/capture/framescaper-capture-proxy-quiescence.ts';
import { createProjectSaveService } from '../src/common/editor/controller/document/project-save-service.ts';
import { waitFor } from './helpers/async-test-control.ts';

interface TestProject {
	readonly id: string;
	readonly revision: number;
}

test('cancelled proxy quiescence reopens only the origin save gate and reschedules its dirty active project', async () => {
	let project: TestProject = { id: 'origin', revision: 1 };
	let activeProjectId = project.id;
	const timers = new Map<number, () => void>();
	const writes: Array<{ snapshot: TestProject; resolve(): void }> = [];
	let nextTimer = 1;
	const saves = createProjectSaveService({
		getProject: () => project,
		hasHistory: () => true,
		hasUnsavedProjectChanges: () => true,
		isReadOnly: () => false,
		cloneProject: (value) => ({ ...value }),
		admitProjectPublication: async () => undefined,
		saveProject: (snapshot) => new Promise<void>((resolve) => {
			writes.push({ snapshot, resolve });
		}),
		persistActiveProjectId: async () => undefined,
		isCurrentProject: (projectId) => activeProjectId === projectId,
		hasSessionTab: () => true,
		markProjectSaved: () => undefined,
		publish: () => undefined,
		garbageCollect: async () => undefined,
		refreshStorageUsage: async () => undefined,
		handleError: (error) => { throw error; },
		scheduleTimer(callback) {
			const handle = nextTimer++;
			timers.set(handle, callback);
			return handle;
		},
		clearTimer: (handle) => { timers.delete(handle); },
	});
	const quiesce = createFramescaperCaptureProxySaveQuiescence({
		getActiveProjectId: () => activeProjectId,
		hasUnsavedProjectChanges: () => true,
		saves,
	});

	const queued = saves.flushProject();
	assert.ok(queued);
	await waitFor(() => writes.length === 1, 'the origin save to start');
	const controller = new AbortController();
	const draining = quiesce('origin', controller.signal);
	project = { id: 'origin', revision: 2 };
	assert.equal(saves.scheduleAutosave(), false, 'the suspended origin rejects new saves');

	activeProjectId = 'other';
	project = { id: 'other', revision: 1 };
	assert.equal(saves.scheduleAutosave(), true, 'an unrelated project remains admitted');
	assert.equal(timers.size, 1);
	const otherTimer = [...timers.values()][0];
	assert.ok(otherTimer);
	otherTimer();
	timers.clear();
	activeProjectId = 'origin';
	project = { id: 'origin', revision: 2 };

	const reason = new Error('The capture was cancelled during proxy publication.');
	controller.abort(reason);
	await assert.rejects(draining, (error: unknown) => error === reason);
	assert.equal(timers.size, 1, 'release schedules one autosave for the active dirty origin');
	const originTimer = [...timers.values()][0];
	assert.ok(originTimer);
	originTimer();
	timers.clear();

	assert.equal(writes.length, 1, 'cancellation does not interrupt the admitted write');
	writes[0]?.resolve();
	await queued;
	await waitFor(() => writes.length === 2, 'the unrelated autosave');
	assert.deepEqual(writes[1]?.snapshot, { id: 'other', revision: 1 });
	writes[1]?.resolve();
	await waitFor(() => writes.length === 3, 'the origin autosave after release');
	assert.deepEqual(writes[2]?.snapshot, { id: 'origin', revision: 2 });
	writes[2]?.resolve();
	await saves.drain();
	assert.deepEqual(writes.map(({ snapshot }) => snapshot.id), ['origin', 'other', 'origin']);
});

test('proxy quiescence reports both drain and resume failures', async () => {
	const drainError = new Error('drain failed');
	const resumeError = new Error('resume failed');
	const calls: string[] = [];
	const quiesce = createFramescaperCaptureProxySaveQuiescence({
		getActiveProjectId: () => 'origin',
		hasUnsavedProjectChanges: () => true,
		saves: {
			suspendProject: () => { calls.push('suspend'); },
			resumeProject: () => { calls.push('resume'); throw resumeError; },
			scheduleAutosave: () => { calls.push('autosave'); return true; },
			drain: () => Promise.reject(drainError),
		},
	});
	await assert.rejects(quiesce('origin'), (error: unknown) => {
		assert.ok(error instanceof AggregateError);
		assert.deepEqual(error.errors, [drainError, resumeError]);
		assert.equal(error.cause, drainError);
		return true;
	});
	assert.deepEqual(calls, ['suspend', 'resume']);
});
