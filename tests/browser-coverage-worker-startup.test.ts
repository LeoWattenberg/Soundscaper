/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import { createBrowserServiceWorkerCoverageCollector } from '../scripts/lib/browser-service-worker-coverage.mjs';

const STARTUP = ['Debugger.enable', 'Profiler.enable', 'Runtime.enable', 'Profiler.startPreciseCoverage', 'Runtime.runIfWaitingForDebugger'];
const WORKER_URL = 'http://127.0.0.1:4322/worker.js';

test('a paused worker queues profiler startup and resume before a delayed acknowledgement yields to Playwright', async () => {
	const { child, collector, root } = await fixture();
	const acknowledgement = deferred<Record<string, unknown>>();
	child.replies.set('Debugger.enable', acknowledgement.promise);
	root.emit('Target.attachedToTarget', { sessionId: 'worker', targetInfo: { type: 'worker', url: WORKER_URL }, waitingForDebugger: true });
	try {
		assert.deepEqual(child.calls.map(call => call[0]), STARTUP);
		assert.deepEqual(child.calls[3]?.[1], { allowTriggeredUpdates: true, callCount: true, detailed: true });
	} finally {
		acknowledgement.resolve({});
		await collector.settle();
	}
	child.emit('Debugger.scriptParsed', { scriptId: 'worker-source', url: WORKER_URL });
	child.emit('Profiler.preciseCoverageDeltaUpdate', { result: [coverage()] });
	root.emit('Target.detachedFromTarget', { sessionId: 'worker' });
	const captured = await collector.collect();
	assert.deepEqual(captured.entries, [coverage()]);
	assert.deepEqual([...captured.sources], [[WORKER_URL, 'worker source']]);
	assert.equal(child.calls.some(call => call[0] === 'Profiler.takePreciseCoverage'), false);
	assert.equal(root.detaches, 1);
	assert.equal(child.detaches, 1);
});

for (const method of ['Profiler.enable', 'Runtime.runIfWaitingForDebugger']) {
	test(`a rejected ${method} acknowledgement retains its exact error and allows final target cleanup`, async () => {
		const { child, collector, root } = await fixture();
		const acknowledgement = deferred<Record<string, unknown>>(), failure = new Error(`Rejected ${method}`);
		child.replies.set(method, acknowledgement.promise);
		root.emit('Target.attachedToTarget', { sessionId: 'worker', targetInfo: { type: 'worker', url: WORKER_URL }, waitingForDebugger: true });
		acknowledgement.reject(failure);
		await assert.rejects(collector.settle(), error => error === failure);
		assert.deepEqual(child.calls.map(call => call[0]), STARTUP);
		assert.deepEqual((await collector.collect()).entries, []);
		assert.equal(root.detaches, 1);
		assert.equal(child.detaches, 1);
		assert.deepEqual(root.calls.at(-1), ['Target.setAutoAttach', { autoAttach: false, flatten: true, waitForDebuggerOnStart: false }]);
	});
}

test('an already running worker queues coverage without a debugger resume', async () => {
	const { child, collector, root } = await fixture();
	root.emit('Target.attachedToTarget', { sessionId: 'worker', targetInfo: { type: 'worker', url: WORKER_URL }, waitingForDebugger: false });
	await collector.settle();
	assert.deepEqual(child.calls.map(call => call[0]), STARTUP.slice(0, -1));
	await collector.collect();
	assert.equal(root.detaches, 1);
	assert.equal(child.detaches, 1);
});

async function fixture() {
	const root = Object.assign(new EventEmitter(), {
		calls: [] as Array<[string, unknown]>, detaches: 0,
		async send(method: string, parameters?: unknown) { this.calls.push([method, parameters]); return {}; },
		async detach() { this.detaches += 1; },
	});
	const child = Object.assign(new EventEmitter(), {
		calls: [] as Array<[string, unknown]>, detaches: 0,
		replies: new Map<string, Promise<Record<string, unknown>>>(),
		async send(method: string, parameters?: unknown): Promise<Record<string, unknown>> {
			this.calls.push([method, parameters]);
			if (method === 'Profiler.takePreciseCoverage') return { result: [] };
			if (method === 'Debugger.getScriptSource') return { scriptSource: 'worker source' };
			return this.replies.get(method) ?? {};
		},
		close(this: EventEmitter) { this.emit('close'); },
		async detach() { this.detaches += 1; },
	});
	const collector = createBrowserServiceWorkerCoverageCollector({ openTargetSession: () => child, rootSession: root, targetTypes: ['worker'] });
	await collector.start();
	return { child, collector, root };
}

function coverage() {
	return { scriptId: 'worker-source', url: WORKER_URL, functions: [{ functionName: '', isBlockCoverage: true, ranges: [{ startOffset: 0, endOffset: 13, count: 1 }] }] };
}

function deferred<Value>() {
	let resolve!: (value: Value) => void, reject!: (reason: Error) => void;
	const promise = new Promise<Value>((accept, decline) => { resolve = accept; reject = decline; });
	return { promise, resolve, reject };
}
