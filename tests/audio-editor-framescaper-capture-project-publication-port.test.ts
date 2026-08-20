/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';
import {
	createFramescaperCaptureProjectPublicationPort,
	framescaperCaptureProjectFence,
} from '../src/common/editor/controller/framescaper-capture-project-publication-port.ts';

interface Project extends Record<string, unknown> {
	readonly id: string;
	readonly schemaVersion: number;
	readonly revision: number;
	readonly updatedAt: string;
	readonly sources: readonly string[];
}

interface History {
	readonly limit: number;
	readonly present: Project;
	readonly undoStack: readonly unknown[];
	readonly redoStack: readonly unknown[];
}

const COMMAND = Object.freeze({
	type: 'batch' as const,
	commands: Object.freeze([]),
}) satisfies AudioEditorCommand;

test('publication reserves and atomically installs an inactive origin project', async () => {
	const fixture = publicationFixture();
	const fence = framescaperCaptureProjectFence(fixture.base);

	assert.deepEqual(await fixture.port.assertProjectFence(fence, {
		phase: 'before-assets', sessionId: 'session-a',
	}), { status: 'base-current' });
	fixture.events.splice(0);
	const result = await fixture.port.commitAtomic(COMMAND, fence);

	assert.equal(result.status, 'committed');
	assert.deepEqual(fixture.current, fixture.target);
	assert.deepEqual(fixture.history.present, fixture.target);
	assert.deepEqual(fixture.events, [
		'writable', 'authority:acquire', 'authority:assert', 'writable',
		'capture', 'reserve', 'load:revision:4', 'authority:assert', 'execute',
		'load:current', 'authority:assert', 'cas', 'authority:assert',
		'install', 'saved', 'release', 'authority:release',
	]);
	assert.equal(fixture.activeMirrors, 0, 'an inactive origin is not mirrored into active editor state');
});

test('two-phase fence assertions enter reconciliation only for the exact target', async () => {
	const fixture = publicationFixture({ durableTarget: true });
	const fence = framescaperCaptureProjectFence(fixture.base);

	assert.deepEqual(await fixture.port.assertProjectFence(fence, {
		phase: 'before-assets', sessionId: 'session-a',
	}), { status: 'reconcile-only' });
	assert.deepEqual(await fixture.port.assertProjectFence(fence, {
		phase: 'before-commit', sessionId: 'session-a', command: COMMAND,
		publicationMode: 'reconcile-only',
	}), { status: 'reconcile-only' });
});

test('the before-commit fence rejects a foreign current after conservative reconciliation', async () => {
	const fixture = publicationFixture({ foreignCurrent: true });
	const fence = framescaperCaptureProjectFence(fixture.base);

	assert.deepEqual(await fixture.port.assertProjectFence(fence, {
		phase: 'before-assets', sessionId: 'session-a',
	}), { status: 'reconcile-only' });
	await assert.rejects(fixture.port.assertProjectFence(fence, {
		phase: 'before-commit', sessionId: 'session-a', command: COMMAND,
		publicationMode: 'reconcile-only',
	}), /changed beyond/iu);
});

test('an acknowledged-failure retry recognizes the exact durable target without a second save', async () => {
	const fixture = publicationFixture({ durableTarget: true });
	const fence = framescaperCaptureProjectFence(fixture.base);

	const result = await fixture.port.commitAtomic(COMMAND, fence);

	assert.equal(result.status, 'committed');
	assert.deepEqual(fixture.history.present, fixture.target);
	assert.equal(fixture.events.includes('cas'), false);
	assert.equal(fixture.events.filter((event) => event === 'execute').length, 1);
	assert.ok(fixture.events.includes('install'));
});

test('an active exact target retries synchronization without reinstalling history', async () => {
	const fixture = publicationFixture({ durableTarget: true, sessionTarget: true, active: true });
	const fence = framescaperCaptureProjectFence(fixture.base);

	const result = await fixture.port.commitAtomic(COMMAND, fence);

	assert.equal(result.status, 'committed');
	assert.equal(fixture.events.includes('cas'), false);
	assert.equal(fixture.events.includes('install'), false);
	assert.equal(fixture.activeMirrors, 1);
	assert.ok(fixture.events.indexOf('sync') < fixture.events.indexOf('release'));
});

test('a foreign durable current returns a CAS mismatch and releases its reservation', async () => {
	const fixture = publicationFixture({ foreignCurrent: true });
	const fence = framescaperCaptureProjectFence(fixture.base);

	const result = await fixture.port.commitAtomic(COMMAND, fence);

	assert.equal(result.status, 'cas-mismatch');
	assert.equal(fixture.events.includes('install'), false);
	assert.deepEqual(fixture.events.slice(-2), ['release', 'authority:release']);
});

test('publication refuses missing write authority before storage or session mutation', async () => {
	const fixture = publicationFixture({ authorityDenied: true });
	const fence = framescaperCaptureProjectFence(fixture.base);

	await assert.rejects(fixture.port.commitAtomic(COMMAND, fence), /write authority/iu);
	assert.equal(fixture.events.includes('cas'), false);
	assert.equal(fixture.events.includes('install'), false);
});

test('lock loss after project CAS remains indeterminate and never clears session read-only state', async () => {
	const fixture = publicationFixture({ loseAuthorityAfterCas: true });
	const fence = framescaperCaptureProjectFence(fixture.base);

	await assert.rejects(fixture.port.commitAtomic(COMMAND, fence), /write authority changed/iu);
	assert.deepEqual(fixture.current, fixture.target, 'the durable acknowledgement is reconciled on retry');
	assert.deepEqual(fixture.history.present, fixture.base, 'session install waits for live authority');
	assert.equal(fixture.events.includes('install'), false);
	assert.ok(fixture.events.includes('authority:release'));
});

test('publication joins both cleanup owners and preserves its primary failure', async () => {
	const primary = new Error('command derivation failed');
	const reservationFailure = new Error('reservation release failed');
	const authorityFailure = new Error('authority release failed');
	const fixture = publicationFixture({
		executeError: primary,
		reservationReleaseError: reservationFailure,
		authorityReleaseError: authorityFailure,
	});
	const fence = framescaperCaptureProjectFence(fixture.base);

	await assert.rejects(fixture.port.commitAtomic(COMMAND, fence), (error: unknown) => {
		assert.ok(error instanceof AggregateError);
		assert.equal(error.cause, primary);
		assert.deepEqual(error.errors, [primary, reservationFailure, authorityFailure]);
		return true;
	});
	assert.deepEqual(fixture.events.slice(-2), ['release', 'authority:release']);
});

function publicationFixture(options: Readonly<{
	durableTarget?: boolean;
	sessionTarget?: boolean;
	foreignCurrent?: boolean;
	active?: boolean;
	authorityDenied?: boolean;
	loseAuthorityAfterCas?: boolean;
	executeError?: Error;
	reservationReleaseError?: Error;
	authorityReleaseError?: Error;
}> = {}) {
	const events: string[] = [];
	const base = project(4, []);
	const target = project(5, ['capture-source']);
	const foreign = project(5, ['foreign-source']);
	let current = options.foreignCurrent ? foreign : options.durableTarget ? target : base;
	let history = createHistory(options.sessionTarget ? target : base);
	let token: object = Object.freeze({});
	let activeMirrors = 0;
	let authorityCurrent = true;
	const port = createFramescaperCaptureProjectPublicationPort<Project, History>({
		projects: {
			async load(_projectId, loadOptions) {
				events.push(loadOptions?.revision === undefined
					? 'load:current' : `load:revision:${String(loadOptions.revision)}`);
				return loadOptions?.revision === 4 ? base : current;
			},
			async saveIfCurrent(expected, next) {
				events.push('cas');
				if (JSON.stringify(current) !== JSON.stringify(expected)) return null;
				current = next;
				if (options.loseAuthorityAfterCas) authorityCurrent = false;
				return next;
			},
		},
		assertProjectWritable() {
			events.push('writable');
			if (options.authorityDenied) throw new Error('Capture project write authority is unavailable.');
		},
		async acquireProjectWriteAuthority() {
			events.push('authority:acquire');
			if (options.authorityDenied) throw new Error('Capture project write authority is unavailable.');
			return {
				assertCurrent() {
					events.push('authority:assert');
					if (!authorityCurrent) throw new Error('Capture project write authority changed.');
				},
				async release() {
					events.push('authority:release');
					if (options.authorityReleaseError) throw options.authorityReleaseError;
				},
			};
		},
		session: {
			captureProjectHistory() { events.push('capture'); return { history, token }; },
			beginProjectActivation(_projectId, reservation) {
				assert.equal(reservation.expectedHistoryToken, token);
				events.push('reserve');
				const activationToken = Object.freeze({});
				return { token: activationToken, release: () => {
					events.push('release');
					if (options.reservationReleaseError) throw options.reservationReleaseError;
					return true;
				} };
			},
			installCommittedProjectHistory(_projectId, next, installOptions) {
				assert.equal(installOptions.expectedHistoryToken, token);
				events.push('install');
				history = next;
				token = Object.freeze({});
			},
			getProjectHistory() { return history; },
			markProjectSaved() { events.push('saved'); },
		},
		projectRuntime: {
			createHistory,
			executeCommand(startingHistory) {
				events.push('execute');
				if (options.executeError) throw options.executeError;
				assert.deepEqual(startingHistory.present, base);
				return { ...startingHistory, present: target };
			},
		},
		isActiveProject: () => options.active === true,
		setActiveProject(value) { assert.deepEqual(value, target); },
		setActiveHistory(value) { assert.deepEqual(value.present, target); },
		async synchronizeProject(value) {
			assert.deepEqual(value, target);
			events.push('sync');
			activeMirrors += 1;
		},
	});
	return {
		base, target, events, port,
		get current() { return current; },
		get history() { return history; },
		get activeMirrors() { return activeMirrors; },
	};
}

function project(revision: number, sources: readonly string[]): Project {
	return Object.freeze({
		id: 'project-a', schemaVersion: 19, revision,
		updatedAt: '2026-08-20T10:00:00.000Z', sources: Object.freeze([...sources]),
	});
}

function createHistory(value: Project): History {
	return Object.freeze({ limit: 100, present: value, undoStack: Object.freeze([]), redoStack: Object.freeze([]) });
}
