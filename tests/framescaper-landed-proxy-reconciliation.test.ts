/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	reconcileLandedCapturedVideoProxyProject,
} from '../src/framescaper/editor-captured-video-proxy-landed-reconciliation.ts';

type Data = Record<string, unknown>;

const BASE: Data = Object.freeze({ id: 'project-1', revision: 3 });
const TARGET: Data = Object.freeze({ id: 'project-1', revision: 4 });

const RECONCILIATION = Object.freeze({
	outcome: 'committed' as const,
	base: BASE,
	target: TARGET,
	cleanupOperation: null,
});

const CLEANUP_OPERATION = Object.freeze({
	operationId: 'cleanup-1',
	projectId: 'project-1',
	sourceId: 'video-source',
	baseFingerprint: 'fingerprint-1',
});

function sameProject(left: unknown, right: unknown): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}

function dependencies(options: Readonly<{
	releases?: string[];
	releaseFailure?: Error;
	cleanupStatus?: 'settled' | 'indeterminate';
	synchronized?: string[];
	activeTab?: boolean;
	synchronizeActiveProject?: (update: Data) => unknown;
}> = {}): never {
	const activeTab = options.activeTab !== false;
	const history = { present: BASE, limit: 10, undoStack: [] };
	return {
		session: {
			getSnapshot: () => ({
				activeProjectId: activeTab ? 'project-1' : null,
				tabs: [{ projectId: 'project-1', readOnly: false, history }],
			}),
			captureProjectHistory: () => ({ token: {}, history }),
			assertProjectHistoryToken: () => undefined,
			beginProjectActivation: () => ({
				token: {},
				release: () => {
					options.releases?.push('released');
					if (options.releaseFailure) throw options.releaseFailure;
				},
			}),
			installCommittedProjectHistory: async (_id: string, next: Data) => ({ history: next }),
		},
		claimCleanup: {
			cleanupOperation: async () => ({ status: options.cleanupStatus ?? 'settled' }),
		},
		synchronizeActiveProject: options.synchronizeActiveProject
			?? ((update: Data) => { options.synchronized?.push(String(update.projectId)); }),
		sameProject,
	} as unknown as never;
}

function reconcile(
	deps: never,
	signal: AbortSignal = new AbortController().signal,
	...ticket: readonly unknown[]
): Promise<void> {
	return reconcileLandedCapturedVideoProxyProject(
		deps,
		RECONCILIATION as never,
		'video-source',
		signal,
		...ticket as [],
	);
}

test('an unowned reconciliation captures its own ticket and releases it afterwards', async () => {
	const releases: string[] = [];
	const synchronized: string[] = [];

	await reconcile(dependencies({ releases, synchronized }));

	assert.deepEqual(releases, ['released']);
	assert.deepEqual(synchronized, ['project-1']);
});

test('a caller-supplied null ticket is respected rather than replaced', async () => {
	const releases: string[] = [];

	await reconcile(dependencies({ releases }), new AbortController().signal, null);

	assert.deepEqual(
		releases,
		[],
		'passing null means the caller owns ticketing, so none may be captured or released',
	);
});

test('a caller-owned ticket is never released by the reconciliation', async () => {
	const releases: string[] = [];
	const ticket = {
		kind: 'absent', active: false, alreadyInstalled: false,
		reservation: { token: {}, release: () => { releases.push('caller-ticket'); } },
	};

	await reconcile(dependencies({ releases }), new AbortController().signal, ticket);

	assert.deepEqual(releases, [], 'releasing a borrowed reservation would strip its owner');
});

test('an unsettled claim cleanup stops the reconciliation before any ticket is taken', async () => {
	const releases: string[] = [];

	await assert.rejects(
		() => reconcileLandedCapturedVideoProxyProject(
			dependencies({ releases, cleanupStatus: 'indeterminate' }),
			{ ...RECONCILIATION, cleanupOperation: CLEANUP_OPERATION } as never,
			'video-source',
			new AbortController().signal,
		),
		(error: AggregateError) => {
			assert.ok(error instanceof AggregateError);
			assert.match(error.message, /Captured proxy cleanup failed/u);
			return true;
		},
	);
	assert.deepEqual(releases, []);
});

test('an already-cancelled reconciliation rethrows its own abort reason', async () => {
	const controller = new AbortController();
	const reason = new Error('the caller cancelled reconciliation');
	controller.abort(reason);

	await assert.rejects(
		() => reconcile(dependencies(), controller.signal),
		(error: unknown) => {
			assert.equal(error, reason);
			return true;
		},
	);
});

test('a release failure on an otherwise clean run surfaces on its own', async () => {
	const releaseFailure = new Error('the reservation could not be released');

	await assert.rejects(
		() => reconcile(dependencies({ releaseFailure })),
		(error: unknown) => {
			assert.equal(error, releaseFailure);
			return true;
		},
	);
});

test('a release failure after a real failure reports both and keeps the original cause', async () => {
	const primary = new RangeError('active project synchronization failed');
	const releaseFailure = new Error('the reservation could not be released');

	await assert.rejects(
		() => reconcile(dependencies({
			releaseFailure,
			synchronizeActiveProject: () => { throw primary; },
		})),
		(error: AggregateError) => {
			assert.ok(error instanceof AggregateError);
			assert.deepEqual(error.errors, [primary, releaseFailure]);
			assert.equal(error.cause, primary);
			return true;
		},
	);
});

test('a project that is not the active tab commits without synchronizing anything', async () => {
	const synchronized: string[] = [];

	await reconcile(dependencies({ activeTab: false, synchronized }));

	assert.deepEqual(synchronized, []);
});
