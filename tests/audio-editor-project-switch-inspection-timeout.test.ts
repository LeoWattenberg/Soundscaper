/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { EditorControllerLifetime } from '../src/common/editor/controller/lifecycle.ts';
import {
	createProjectSwitchService,
	type ProjectSwitchServiceRuntime,
	type ProjectSwitchState,
} from '../src/common/editor/controller/project-switch-service.ts';
import {
	ScapeInspectionSettlementTimeoutError,
	createScapeInspectionQuiescence,
} from '../src/common/editor/controller/scape-inspection-quiescence.ts';
import type {
	ProjectLifecycleHistory,
	ProjectLifecycleProject,
} from '../src/common/editor/controller/project-lifecycle-types.ts';

interface TestProject extends ProjectLifecycleProject {
	readonly title: string;
	readonly tracks: readonly [];
}

interface TestHistory extends ProjectLifecycleHistory<TestProject> {
	readonly present: TestProject;
}

test('a Scape inspection timeout rejects project switching before project work', async () => {
	const provider = deferred<void>();
	const timerHandle = Object.freeze({ id: 'project-switch-inspection-deadline' });
	const timer: { deadline: (() => void) | null } = { deadline: null };
	const quiescence = createScapeInspectionQuiescence({
		limits: { maximumActiveInspections: 1, settlementTimeoutMs: 11 },
		setTimeout(callback, delayMs) {
			assert.equal(delayMs, 11);
			assert.equal(timer.deadline, null);
			timer.deadline = callback;
			return timerHandle;
		},
		clearTimeout(handle) {
			assert.equal(handle, timerHandle);
			timer.deadline = null;
		},
	});
	const inspection = quiescence.admit();
	inspection.retain(provider.promise);
	inspection.finish({ status: 'fulfilled' });

	const lifetime = new EditorControllerLifetime();
	let projectWorkCalls = 0;
	const state = { projectQueue: Promise.resolve() } as ProjectSwitchState<TestProject, TestHistory>;
	const runtime = {
		state,
		lifetime,
		scapeInspectionQuiescence: quiescence,
		productCapabilities: {},
		projectGeneration: {
			invalidate() { projectWorkCalls += 1; },
			activate() { return null; },
		},
		sessionTab() {
			projectWorkCalls += 1;
			return null;
		},
	} as unknown as ProjectSwitchServiceRuntime<TestProject, TestHistory>;
	const service = createProjectSwitchService(runtime);
	const nextProject: TestProject = {
		id: 'deadline-blocked-project',
		title: 'Deadline blocked project',
		tracks: [],
	};
	const switching = service.switchProject(nextProject);
	const rejected = assert.rejects(switching, (error: unknown) => (
		error instanceof ScapeInspectionSettlementTimeoutError
		&& error.timeoutMs === 11
		&& error.pendingInspections === 1
	));

	try {
		assert.equal(await settlesByNextTurn(switching), false);
		assert.equal(projectWorkCalls, 0);
		assert.ok(timer.deadline, 'project switching must arm the captured inspection deadline');
		timer.deadline();
		timer.deadline = null;
		await rejected;
		assert.equal(projectWorkCalls, 0, 'timed-out inspection cleanup must block all project work');
	} finally {
		provider.resolve();
		await provider.promise;
		await new Promise<void>((resolve) => { setImmediate(resolve); });
		await quiescence.drain();
	}
});

async function settlesByNextTurn(value: PromiseLike<unknown>): Promise<boolean> {
	return Promise.race([
		Promise.resolve(value).then(() => true, () => true),
		new Promise<false>((resolve) => { setImmediate(() => resolve(false)); }),
	]);
}

function deferred<Value>() {
	let resolve: (value: Value | PromiseLike<Value>) => void = () => undefined;
	const promise = new Promise<Value>((complete) => { resolve = complete; });
	return { promise, resolve };
}
