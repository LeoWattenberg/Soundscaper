/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	assertCapturedVideoProxyProjectCurrent,
	captureCapturedVideoProxyFinalControllerTicket,
	captureCapturedVideoProxyLandedControllerTicket,
} from '../src/framescaper/editor-captured-video-proxy-controller-fence.ts';

type Data = Record<string, unknown>;

const EXPECTED: Data = Object.freeze({ id: 'project-1', revision: 3 });
const LANDED: Data = Object.freeze({ id: 'project-1', revision: 4 });

function fingerprint(project: unknown): string {
	return JSON.stringify(project);
}

function controller(options: Readonly<{
	present?: Data | null;
	releaseFailure?: Error;
	releases?: string[];
}> = {}): never {
	const present = options.present === undefined ? EXPECTED : options.present;
	return {
		getSnapshot: () => ({
			activeProjectId: present ? 'project-1' : null,
			tabs: present ? [{ projectId: 'project-1', readOnly: false, history: { present } }] : [],
		}),
		captureProjectHistory: () => ({ token: {}, history: { present } }),
		assertProjectHistoryToken: () => undefined,
		beginProjectActivation: () => ({
			release: () => {
				options.releases?.push('released');
				if (options.releaseFailure) throw options.releaseFailure;
			},
		}),
	} as unknown as never;
}

function finalTicketOptions(overrides: Data = {}): never {
	return {
		expected: EXPECTED,
		fingerprint,
		changedMessage: 'the captured proxy origin changed',
		cloneProject: (project: unknown) => project,
		loadCurrent: () => EXPECTED,
		signal: new AbortController().signal,
		assertAdoptionCurrent: () => undefined,
		session: controller(),
		...overrides,
	} as unknown as never;
}

test('a current project passes the fence and keeps its reservation', async () => {
	const releases: string[] = [];

	const ticket = await captureCapturedVideoProxyFinalControllerTicket(
		finalTicketOptions({ session: controller({ releases }) }),
	);

	assert.equal(ticket?.kind, 'present');
	assert.deepEqual(releases, [], 'a successful fence must not release the reservation it captured');
});

test('a project that moved under the fence releases the reservation and aborts', async () => {
	const releases: string[] = [];

	await assert.rejects(
		() => captureCapturedVideoProxyFinalControllerTicket(finalTicketOptions({
			session: controller({ releases }),
			loadCurrent: () => ({ id: 'project-1', revision: 9 }),
		})),
		(error: Error) => {
			assert.equal(error.name, 'AbortError');
			assert.match(error.message, /the captured proxy origin changed/u);
			return true;
		},
	);
	assert.deepEqual(releases, ['released']);
});

test('a failing adoption check releases the reservation and rethrows its own error', async () => {
	const releases: string[] = [];
	const adoption = new RangeError('the adoption target moved');

	await assert.rejects(
		() => captureCapturedVideoProxyFinalControllerTicket(finalTicketOptions({
			session: controller({ releases }),
			assertAdoptionCurrent: () => { throw adoption; },
		})),
		(error: unknown) => {
			assert.equal(error, adoption);
			return true;
		},
	);
	assert.deepEqual(releases, ['released']);
});

test('a release that also fails reports both errors while keeping the original cause', async () => {
	const adoption = new RangeError('the adoption target moved');
	const releaseFailure = new Error('the reservation could not be released');

	await assert.rejects(
		() => captureCapturedVideoProxyFinalControllerTicket(finalTicketOptions({
			session: controller({ releaseFailure }),
			assertAdoptionCurrent: () => { throw adoption; },
		})),
		(error: AggregateError) => {
			assert.ok(error instanceof AggregateError);
			assert.deepEqual(error.errors, [adoption, releaseFailure]);
			assert.equal(error.cause, adoption, 'the original failure must remain the reported cause');
			return true;
		},
	);
});

test('an already-cancelled fence releases its reservation and rethrows the abort reason', async () => {
	const releases: string[] = [];
	const controllerSignal = new AbortController();
	const reason = new Error('the caller cancelled finalization');
	controllerSignal.abort(reason);

	await assert.rejects(
		() => captureCapturedVideoProxyFinalControllerTicket(finalTicketOptions({
			session: controller({ releases }),
			signal: controllerSignal.signal,
		})),
		(error: unknown) => {
			assert.equal(error, reason);
			return true;
		},
	);
	assert.deepEqual(releases, ['released']);
});

test('the standalone currency assertion compares durable fingerprints', async () => {
	const options = {
		expected: EXPECTED,
		fingerprint,
		cloneProject: (project: unknown) => project,
		changedMessage: 'the captured proxy origin changed',
		signal: new AbortController().signal,
	};

	await assert.doesNotReject(() => assertCapturedVideoProxyProjectCurrent({
		...options, loadCurrent: () => ({ ...EXPECTED }),
	} as never));
	await assert.rejects(
		() => assertCapturedVideoProxyProjectCurrent({
			...options, loadCurrent: () => ({ id: 'project-1', revision: 9 }),
		} as never),
		(error: Error) => error.name === 'AbortError',
	);
});

test('cancellation raised while the current project loads still aborts the assertion', async () => {
	const signalController = new AbortController();

	await assert.rejects(
		() => assertCapturedVideoProxyProjectCurrent({
			expected: EXPECTED,
			fingerprint,
			cloneProject: (project: unknown) => project,
			changedMessage: 'the captured proxy origin changed',
			signal: signalController.signal,
			loadCurrent: () => {
				signalController.abort();
				return EXPECTED;
			},
		} as never),
		(error: Error) => error.name === 'AbortError',
	);
});

test('a landed ticket reserves an absent tab without claiming it is installed', () => {
	const ticket = captureCapturedVideoProxyLandedControllerTicket(
		controller({ present: null }),
		EXPECTED as never,
		LANDED as never,
		fingerprint,
	);

	assert.equal(ticket?.kind, 'absent');
	assert.equal(ticket?.active, false);
	assert.equal(ticket?.alreadyInstalled, false);
});

test('a landed ticket recognises an open tab that already carries the target', () => {
	const ticket = captureCapturedVideoProxyLandedControllerTicket(
		controller({ present: LANDED }),
		EXPECTED as never,
		LANDED as never,
		fingerprint,
	);

	assert.equal(ticket?.alreadyInstalled, true);
});

test('a landed ticket refuses an open tab that is neither the predecessor nor the target', () => {
	assert.throws(() => captureCapturedVideoProxyLandedControllerTicket(
		controller({ present: { id: 'project-1', revision: 7 } }),
		EXPECTED as never,
		LANDED as never,
		fingerprint,
	), (error: Error) => {
		assert.equal(error.name, 'AbortError');
		assert.match(error.message, /no longer matches its durable predecessor or target/u);
		return true;
	});
});
