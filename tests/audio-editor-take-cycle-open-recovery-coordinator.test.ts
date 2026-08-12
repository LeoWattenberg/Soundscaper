/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { TakeCyclePendingOpenRecovery } from '../src/common/editor/controller/take-cycle-capture-orchestrator.ts';
import {
	createTakeCycleOpenRecoveryCoordinator,
} from '../src/common/editor/controller/take-cycle-open-recovery-coordinator.ts';

test('pending open freezes exact authority and defers every post-open mutation', async () => {
	const fixture = coordinatorFixture(pending('project-a', 'token-a'));
	const result = await fixture.coordinator.inspectOpenedProject('project-a');

	assert.equal(result.pending, true);
	assert.equal(fixture.coordinator.blocked, true);
	assert.equal(Object.isFrozen(fixture.state.takeCycleRecovery), true);
	assert.deepEqual(fixture.events, ['inspect:project-a', 'publish']);
	assert.equal(await fixture.coordinator.deferRecordOpened(async () => fixture.events.push('record-opened')), false);
	assert.equal(await fixture.coordinator.deferInitialSave(async () => fixture.events.push('initial-save')), false);
	assert.equal(await fixture.coordinator.deferGarbageCollection(async () => fixture.events.push('gc')), false);
	assert.equal(await fixture.coordinator.deferMaintenance(async () => fixture.events.push('maintenance')), false);
	assert.deepEqual(fixture.events, ['inspect:project-a', 'publish']);
});

test('inspection itself blocks mutations and replaces prior-project authority atomically', async () => {
	const inspection = deferred<TakeCyclePendingOpenRecovery | null>();
	const prior = pending('project-a', 'token-a');
	const fixture = coordinatorFixture(prior);
	await fixture.coordinator.inspectOpenedProject('project-a');
	fixture.currentProjectId = 'project-b';
	fixture.inspect = () => inspection.promise;
	const opening = fixture.coordinator.inspectOpenedProject('project-b');
	assert.equal(fixture.coordinator.blocked, true);
	assert.equal(fixture.state.takeCycleRecoveryInspecting, true);
	assert.strictEqual(fixture.state.takeCycleRecovery, prior);
	inspection.resolve(null);
	await opening;
	assert.equal(fixture.coordinator.blocked, false);
	assert.equal(fixture.state.takeCycleRecovery, null);
});

test('first-open inspection holds every mutation and drains them only after a clean result', async () => {
	const inspection = deferred<TakeCyclePendingOpenRecovery | null>();
	const fixture = coordinatorFixture(null);
	fixture.inspect = () => inspection.promise;
	const opening = fixture.coordinator.inspectOpenedProject('project-a');
	await fixture.coordinator.deferRecordOpened(async () => { fixture.events.push('record-opened'); });
	await fixture.coordinator.deferInitialSave(async () => { fixture.events.push('initial-save'); });
	await fixture.coordinator.deferGarbageCollection(async () => { fixture.events.push('gc'); });
	await fixture.coordinator.deferMaintenance(async () => { fixture.events.push('maintenance'); });
	assert.deepEqual(fixture.events, []);
	inspection.resolve(null);
	await opening;
	assert.deepEqual(fixture.events, ['record-opened', 'initial-save', 'gc', 'maintenance', 'publish']);
	assert.equal(fixture.coordinator.blocked, false);
});

test('stale inspection drops old-project authority but fails closed until current project inspection', async () => {
	const inspection = deferred<TakeCyclePendingOpenRecovery | null>();
	const authority = pending('project-a', 'token-a');
	const fixture = coordinatorFixture(authority);
	await fixture.coordinator.inspectOpenedProject('project-a');
	fixture.currentProjectId = 'project-b';
	fixture.inspect = () => inspection.promise;
	const opening = fixture.coordinator.inspectOpenedProject('project-b');
	fixture.currentProjectId = 'project-c';
	inspection.resolve(null);
	await assert.rejects(opening, /stale/u);
	assert.equal(fixture.state.takeCycleRecovery, null);
	assert.equal(fixture.coordinator.blocked, true);
	await assert.rejects(fixture.coordinator.resolve(authority, 'recover'), /stale/u);
	fixture.inspect = async () => null;
	await fixture.coordinator.inspectOpenedProject('project-c');
	assert.equal(fixture.coordinator.blocked, false);
});

test('explicit recovery consumes exact authority then resumes deferred mutations once', async () => {
	const authority = pending('project-a', 'token-a');
	const fixture = coordinatorFixture(authority);
	await fixture.coordinator.inspectOpenedProject('project-a');
	await fixture.coordinator.deferRecordOpened(async () => { fixture.events.push('record-opened'); });
	await fixture.coordinator.deferInitialSave(async () => { fixture.events.push('initial-save'); });
	await fixture.coordinator.deferGarbageCollection(async () => { fixture.events.push('gc'); });
	await fixture.coordinator.deferMaintenance(async () => { fixture.events.push('maintenance'); });
	await fixture.coordinator.deferMaintenance(async () => { fixture.events.push('cleanup'); });
	await fixture.coordinator.resolve(authority, 'recover');

	assert.deepEqual(fixture.events, [
		'inspect:project-a', 'publish', 'recover:token-a:recover',
		'publish', 'record-opened', 'initial-save', 'gc', 'maintenance', 'cleanup',
	]);
	assert.equal(fixture.coordinator.blocked, false);
	assert.equal(fixture.state.takeCycleRecovery, null);
	await assert.rejects(fixture.coordinator.resolve(authority, 'recover'), /stale/u);
});

test('copied, switched, raced, and disposed recovery authorities cannot settle', async () => {
	const authority = pending('project-a', 'token-a');
	const fixture = coordinatorFixture(authority);
	await fixture.coordinator.inspectOpenedProject('project-a');
	await assert.rejects(
		fixture.coordinator.resolve({ ...authority }, 'discard'),
		/exact pending authority/u,
	);
	fixture.currentProjectId = 'project-b';
	await assert.rejects(fixture.coordinator.resolve(authority, 'discard'), /stale/u);
	fixture.currentProjectId = 'project-a';
	fixture.disposed = true;
	await assert.rejects(fixture.coordinator.resolve(authority, 'discard'), /stale/u);
	assert.equal(fixture.recoveries, 0);
	assert.strictEqual(fixture.state.takeCycleRecovery, authority);
});

test('concurrent resolution coalesces only the same exact decision', async () => {
	const settlement = deferred<void>();
	const authority = pending('project-a', 'token-a');
	const fixture = coordinatorFixture(authority);
	fixture.recover = () => settlement.promise;
	await fixture.coordinator.inspectOpenedProject('project-a');
	const recovering = fixture.coordinator.resolve(authority, 'recover');
	assert.strictEqual(fixture.coordinator.resolve(authority, 'recover'), recovering);
	await assert.rejects(
		fixture.coordinator.resolve(authority, 'discard'),
		/already settling another decision/u,
	);
	settlement.resolve();
	await recovering;
});

test('recover and discard both refuse read-only authority without mutating durable roots', async () => {
	const authority = pending('project-a', 'token-a');
	const fixture = coordinatorFixture(authority);
	fixture.writable = false;
	await fixture.coordinator.inspectOpenedProject('project-a');
	await assert.rejects(fixture.coordinator.resolve(authority, 'recover'), /writable active project/u);
	await assert.rejects(fixture.coordinator.resolve(authority, 'discard'), /writable active project/u);
	assert.equal(fixture.recoveries, 0);
	assert.strictEqual(fixture.state.takeCycleRecovery, authority);
});

test('post-root cancellation clears exact authority after reinspection proves settlement', async () => {
	const authority = pending('project-a', 'token-a');
	const fixture = coordinatorFixture(authority);
	fixture.recover = async () => {
		fixture.inspect = async () => null;
		fixture.writable = false;
		throw new DOMException('lost after final root removal', 'AbortError');
	};
	await fixture.coordinator.inspectOpenedProject('project-a');
	await fixture.coordinator.deferMaintenance(async () => fixture.events.push('unsafe-maintenance'));
	await fixture.coordinator.resolve(authority, 'recover');
	assert.equal(fixture.state.takeCycleRecovery, null);
	assert.equal(fixture.coordinator.blocked, false);
	assert.equal(fixture.events.includes('unsafe-maintenance'), false);
});

test('partial lock-loss settlement refreshes the exact retry authority', async () => {
	const authority = pending('project-a', 'token-a'), retry = pending('project-a', 'token-b');
	const fixture = coordinatorFixture(authority);
	fixture.recover = async () => { fixture.inspect = async () => retry; fixture.writable = false; throw new DOMException('lost during settlement', 'AbortError'); };
	await fixture.coordinator.inspectOpenedProject('project-a');
	await assert.rejects(fixture.coordinator.resolve(authority, 'recover'), /lost during settlement/u);
	assert.strictEqual(fixture.state.takeCycleRecovery, retry);
	await assert.rejects(fixture.coordinator.resolve(authority, 'recover'), /exact pending authority/u);
	fixture.writable = true; fixture.recover = async () => {};
	await fixture.coordinator.resolve(retry, 'recover');
	assert.equal(fixture.coordinator.blocked, false);
});

test('switching away clears only in-memory authority and never resumes or settles durable roots', async () => {
	const authority = pending('project-a', 'token-a');
	const fixture = coordinatorFixture(authority);
	await fixture.coordinator.inspectOpenedProject('project-a');
	await fixture.coordinator.deferInitialSave(async () => fixture.events.push('initial-save'));
	fixture.coordinator.leaveProject('project-a');

	assert.equal(fixture.state.takeCycleRecovery, null);
	assert.equal(fixture.coordinator.blocked, false);
	assert.equal(fixture.recoveries, 0);
	assert.deepEqual(fixture.events, ['inspect:project-a', 'publish', 'publish']);
});

function coordinatorFixture(authority: TakeCyclePendingOpenRecovery | null) {
	const state = {
		takeCycleRecovery: null as TakeCyclePendingOpenRecovery | null,
		takeCycleRecoveryInspecting: false,
	};
	const events: string[] = [];
	let recoveries = 0;
	const fixture = {
		currentProjectId: 'project-a',
		disposed: false,
		writable: true,
		inspect: async (projectId: string) => { events.push(`inspect:${projectId}`); return authority; },
		recover: async (pendingValue: TakeCyclePendingOpenRecovery, decision: 'recover' | 'discard') => {
			recoveries += 1;
			events.push(`recover:${pendingValue.recoveryToken}:${decision}`);
		},
		state,
		events,
		get recoveries() { return recoveries; },
		coordinator: null as unknown as ReturnType<typeof createTakeCycleOpenRecoveryCoordinator>,
	};
	fixture.coordinator = createTakeCycleOpenRecoveryCoordinator({
		state,
		inspect: (projectId) => fixture.inspect(projectId),
		recover: (pendingValue, decision) => fixture.recover(pendingValue, decision),
		getCurrentProjectId: () => fixture.currentProjectId,
		isDisposed: () => fixture.disposed,
		isCurrentProjectWritable: () => fixture.writable,
		publish: () => { events.push('publish'); },
	});
	return fixture;
}

function pending(projectId: string, recoveryToken: string): TakeCyclePendingOpenRecovery {
	return Object.freeze({
		kind: 'take-cycle-pending-open-recovery', projectId,
		publicationGeneration: 7, recoveryToken, draftCount: 2, requiresDecision: true,
	});
}

function deferred<Value>() {
	let resolve!: (value: Value | PromiseLike<Value>) => void;
	const promise = new Promise<Value>((complete) => { resolve = complete; });
	return { promise, resolve };
}
