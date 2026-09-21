/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import {
	createPlaywrightBrowserServiceWorkerCoverageCollector,
} from '../scripts/lib/browser-service-worker-coverage.mjs';
import { createBrowserTargetSessionOwnership } from '../scripts/lib/browser-target-coverage-state.mjs';

test('target-session ownership validates, releases, and clears its identities', () => {
	const ownership = createBrowserTargetSessionOwnership();
	assert.throws(() => ownership.admit('', 'session'), /target ID/u);
	assert.throws(() => ownership.admit('target', ''), /session ID/u);
	assert.equal(ownership.admit('target', 'session'), true);
	assert.equal(ownership.admit('target', 'duplicate'), false);
	assert.throws(() => ownership.admit('other-target', 'session'), /already admitted/u);
	assert.equal(ownership.release('duplicate'), false);
	assert.equal(ownership.release('session'), true);
	assert.equal(ownership.admit('target', 'replacement'), true);
	ownership.clear();
	assert.equal(ownership.admit('target', 'after-clear'), true);
});

test('Playwright records one profiler session per logical service-worker target', async () => {
	const children = new Map([
		['first', new FakeTargetSession()],
		['duplicate', new FakeTargetSession()],
		['while-owned', new FakeTargetSession()],
		['replacement', new FakeTargetSession()],
	]);
	const root = new FakePlaywrightRoot(children);
	root.on('Target.attachedToTarget', ({ sessionId }) => {
		root.createChildSession(sessionId, () => undefined);
	});
	const browserImplementation = Object.assign(new EventEmitter(), { _session: root });
	const browser = {
		_connection: { toImpl: () => browserImplementation },
		async newBrowserCDPSession() {},
	};
	const collector = await createPlaywrightBrowserServiceWorkerCoverageCollector({
		authenticateWebAssembly: undefined,
		browser,
	});
	await collector.start();

	attach(root, 'first', 'shared-target');
	attach(root, 'duplicate', 'shared-target');
	await collector.settle();
	assert.equal(startCount(children.get('first')), 1);
	assert.equal(startCount(children.get('duplicate')), 0,
		'a second Playwright session must not reset precise coverage for the same isolate');

	root.emit('Target.detachedFromTarget', { sessionId: 'duplicate' });
	attach(root, 'while-owned', 'shared-target');
	await collector.settle();
	assert.equal(startCount(children.get('while-owned')), 0,
		'detaching an ignored duplicate must not release the admitted target');

	root.emit('Target.detachedFromTarget', { sessionId: 'first' });
	attach(root, 'replacement', 'shared-target');
	await collector.settle();
	assert.equal(startCount(children.get('replacement')), 1,
		'the logical target may be admitted again after its owning session detaches');

	const capture = await collector.collect();
	assert.deepEqual(capture.targetCounts, { service_worker: 2 });
	assert.deepEqual(capture.pausedTargetCounts, { service_worker: 2 });
});

function attach(root: FakePlaywrightRoot, sessionId: string, targetId: string): void {
	root.emit('Target.attachedToTarget', {
		sessionId,
		targetInfo: {
			targetId,
			type: 'service_worker',
			url: 'http://127.0.0.1:4322/service-worker.js',
		},
		waitingForDebugger: true,
	});
}

function startCount(session: FakeTargetSession | undefined): number {
	return session?.calls.filter(([method]) => method === 'Profiler.startPreciseCoverage').length ?? 0;
}

class FakePlaywrightRoot extends EventEmitter {
	constructor(private readonly children: Map<string, FakeTargetSession>) { super(); }

	createChildSession(sessionId: string, _listener: () => void): FakeTargetSession {
		const child = this.children.get(sessionId);
		if (child === undefined) throw new Error(`Unexpected target session ${sessionId}.`);
		return child;
	}
}

class FakeTargetSession extends EventEmitter {
	readonly calls: Array<[string, unknown]> = [];

	async detach(): Promise<void> {}

	async send(method: string, parameters?: unknown): Promise<unknown> {
		this.calls.push([method, parameters]);
		if (method === 'Profiler.takePreciseCoverage') return { result: [] };
		return {};
	}
}
