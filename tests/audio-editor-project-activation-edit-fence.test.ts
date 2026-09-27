/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	assertProjectActivationEditAllowed,
	createProjectActivationEditFence,
} from '../src/common/editor/controller/document/project-activation-edit-fence.ts';
import {
	createFixture,
	deferred,
	project,
} from './helpers/audio-editor-project-switch-fixture.ts';

test('the activation edit fence publishes only its outer transitions', async () => {
	const state = { projectActivationPending: false, projectQueue: Promise.resolve() };
	const publications: boolean[] = [];
	const fence = createProjectActivationEditFence(state, () => {
		publications.push(state.projectActivationPending);
	});
	const firstGate = deferred<void>();
	const secondGate = deferred<void>();
	const reservation = () => ({ release() {} });

	const first = fence.enqueue(reservation, () => firstGate.promise);
	const second = fence.enqueue(reservation, () => secondGate.promise);
	assert.equal(fence.pending, 2);
	assert.throws(
		() => assertProjectActivationEditAllowed(state),
		(error: unknown) => error instanceof DOMException
			&& error.name === 'AbortError'
			&& /reserved for activation/iu.test(error.message),
	);
	firstGate.resolve();
	await first;
	assert.equal(state.projectActivationPending, true);
	secondGate.resolve();
	await second;

	assert.equal(fence.pending, 0);
	assert.equal(state.projectActivationPending, false);
	assert.deepEqual(publications, [true, false]);
});

test('activation setup publication failure releases custody and rolls back edit admission', async () => {
	const failure = new Error('snapshot publication failed');
	const state = { projectActivationPending: false, projectQueue: Promise.resolve() };
	let releases = 0;
	let runs = 0;
	const fence = createProjectActivationEditFence(state, () => { throw failure; });

	const activation = fence.enqueue(
		() => ({ release() { releases += 1; } }),
		() => { runs += 1; },
	);
	await assert.rejects(activation, (error: unknown) => error === failure);

	assert.equal(releases, 1);
	assert.equal(runs, 0);
	assert.equal(fence.pending, 0);
	assert.equal(state.projectActivationPending, false);
});

test('activation cleanup preserves both the operation and reservation failures', async () => {
	const operationFailure = new Error('activation failed');
	const releaseFailure = new Error('reservation release failed');
	const state = { projectActivationPending: false, projectQueue: Promise.resolve() };
	const fence = createProjectActivationEditFence(state, () => undefined);

	await assert.rejects(
		fence.enqueue(
			() => ({ release() { throw releaseFailure; } }),
			() => { throw operationFailure; },
		),
		(error: unknown) => error instanceof AggregateError
			&& error.cause === operationFailure
			&& error.errors[0] === operationFailure
			&& error.errors[1] === releaseFailure,
	);
	assert.equal(fence.pending, 0);
	assert.equal(state.projectActivationPending, false);
});

test('project switching stays edit-blocked until activation maintenance releases session custody', async () => {
	const fixture = createFixture();
	const maintenanceStarted = deferred<void>();
	const maintenanceGate = deferred<void>();
	fixture.setMaintainOpenedProject(async () => {
		maintenanceStarted.resolve();
		await maintenanceGate.promise;
	});

	const switching = fixture.service.switchProject(project('next-project'));
	await maintenanceStarted.promise;

	assert.equal(fixture.getProject()?.id, 'next-project');
	assert.equal(fixture.state.projectActivationPending, true);
	assert.equal(fixture.publishedActivationStates.at(-1), true);
	assert.throws(
		() => assertProjectActivationEditAllowed(fixture.state),
		/reserved for activation/iu,
	);

	maintenanceGate.resolve();
	await switching;

	assert.equal(fixture.state.projectActivationPending, false);
	assert.equal(fixture.publishedActivationStates.at(-1), false);
	assert.doesNotThrow(() => assertProjectActivationEditAllowed(fixture.state));
});

test('a snapshot subscriber cannot reverse reentrant project-switch ordering', async () => {
	const fixture = createFixture();
	let reentrantSwitch: Promise<void> | null = null;
	fixture.setPublishDocumentSnapshot(() => {
		if (!fixture.state.projectActivationPending || reentrantSwitch) return;
		reentrantSwitch = fixture.service.switchProject(project('second-project'));
	});

	await fixture.service.switchProject(project('first-project'));
	await reentrantSwitch;

	assert.equal(fixture.getProject()?.id, 'second-project');
	assert.deepEqual(fixture.events.filter((event) => event.startsWith('engine-load:')), [
		'engine-load:first-project',
		'engine-load:second-project',
	]);
});

test('a cancellation failure releases the acquired Scape inspection fence', async () => {
	const fixture = createFixture();
	const failure = new Error('task cancellation failed');
	let releases = 0;
	Object.defineProperty(fixture.runtime, 'scapeInspectionQuiescence', { value: {
		beginFence: () => ({ wait: async () => undefined, release: () => { releases += 1; } }),
	} });
	Object.defineProperty(fixture.lifetime, 'cancelTask', { value: () => { throw failure; } });

	await assert.rejects(
		fixture.service.switchProject(project('cancel-failure-project')),
		(error: unknown) => error === failure,
	);
	assert.equal(releases, 1);
	assert.equal(fixture.state.projectActivationPending, false);
});
