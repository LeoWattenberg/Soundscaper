/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import {
	createBrowserServiceWorkerCoverageCollector,
	WORKLET_COVERAGE_CHECKPOINT_URL,
} from '../scripts/lib/browser-service-worker-coverage.mjs';

const WEBASSEMBLY_URL = 'wasm://wasm/00091612';

test('browser-level service-worker coverage starts before execution and keeps a final delta', async () => {
	const root = new FakeRootSession();
	const child = new FakeTargetSession();
	const collector = createBrowserServiceWorkerCoverageCollector({
		openTargetSession: (_root: unknown, sessionId: string) => {
			assert.equal(sessionId, 'service-worker-session');
			return child;
		},
		rootSession: root,
	});

	await collector.start();
	assert.deepEqual(root.calls, [['Target.setAutoAttach', {
		autoAttach: true,
		flatten: true,
		filter: [{ type: 'service_worker' }, { exclude: true }],
		waitForDebuggerOnStart: true,
	}]]);

	root.emit('Target.attachedToTarget', {
		sessionId: 'service-worker-session',
		targetInfo: { type: 'service_worker', url: 'http://127.0.0.1:4322/service-worker.js' },
		waitingForDebugger: true,
	});
	await collector.settle();
	assert.deepEqual(child.calls.slice(0, 6), [
		['Debugger.enable', undefined],
		['Profiler.enable', undefined],
		['Runtime.enable', undefined],
		['Profiler.startPreciseCoverage', {
			allowTriggeredUpdates: true,
			callCount: true,
			detailed: true,
		}],
		['Runtime.runIfWaitingForDebugger', undefined],
	]);

	child.emit('Debugger.scriptParsed', {
		scriptId: '3',
		url: 'http://127.0.0.1:4322/service-worker.js',
	});
	await collector.settle();
	child.emit('Profiler.preciseCoverageDeltaUpdate', {
		result: [coverage('3', '', 42)],
	});
	root.emit('Target.detachedFromTarget', { sessionId: 'service-worker-session' });

	const capture = await collector.collect();
	assert.deepEqual(capture.entries, [coverage(
		'3',
		'http://127.0.0.1:4322/service-worker.js',
		42,
	)]);
	assert.deepEqual([...capture.sources], [[
		'http://127.0.0.1:4322/service-worker.js',
		'service-worker-source:3',
	]]);
	assert.deepEqual(capture.pausedTargetCounts, { service_worker: 1 });
	assert.deepEqual(capture.targetCounts, { service_worker: 1 });
	assert.deepEqual(capture.targetTypes, ['service_worker']);
	assert.equal(child.calls.some(([method]) => method === 'Profiler.takePreciseCoverage'), false,
		'a detached worker relies on its banked delta');
	assert.deepEqual(root.calls.at(-1), ['Target.setAutoAttach', {
		autoAttach: false,
		flatten: true,
		waitForDebuggerOnStart: false,
	}]);
	assert.equal(root.detachCount, 1, 'the browser-target session is released exactly once');
	assert.equal(child.detachCount, 1, 'the detached child wrapper is released exactly once');
});

test('dynamic target sources are captured by exact URL and conflicting bytes fail closed', async () => {
	const root = new FakeRootSession();
	const first = new FakeTargetSession();
	const second = new FakeTargetSession();
	const dynamicUrl = 'soundscaper-macro://module-v1/' + 'a'.repeat(64) + '/' + 'b'.repeat(64) + '.mjs';
	first.sources.set('dynamic', 'first source');
	second.sources.set('dynamic', 'changed source');
	const collector = createBrowserServiceWorkerCoverageCollector({
		captureSource: (url: string) => url === dynamicUrl,
		openTargetSession: (_root, sessionId) => sessionId === 'first-worker' ? first : second,
		rootSession: root,
		targetTypes: ['worker'],
	});

	await collector.start();
	for (const sessionId of ['first-worker', 'second-worker']) {
		root.emit('Target.attachedToTarget', {
			sessionId,
			targetInfo: { type: 'worker', url: 'blob:http://127.0.0.1/dynamic' },
			waitingForDebugger: true,
		});
	}
	await collector.settle();
	first.emit('Debugger.scriptParsed', { scriptId: 'dynamic', url: dynamicUrl });
	second.emit('Debugger.scriptParsed', { scriptId: 'dynamic', url: dynamicUrl });
	await assert.rejects(collector.collect(), /conflicting source bytes/u);
});

test('worker capture excludes protocol-authenticated WebAssembly from JavaScript profiles', async () => {
	const root = new FakeRootSession();
	const child = new FakeTargetSession();
	const collector = createBrowserServiceWorkerCoverageCollector({
		openTargetSession: () => child,
		rootSession: root,
		targetTypes: ['worker'],
	});
	await collector.start();
	root.emit('Target.attachedToTarget', {
		sessionId: 'worker-session',
		targetInfo: { type: 'worker', url: 'http://127.0.0.1:4322/worker.js' },
		waitingForDebugger: true,
	});
	await collector.settle();
	child.emit('Debugger.scriptParsed', {
		scriptId: '3',
		url: 'http://127.0.0.1:4322/worker.js',
	});
	child.emit('Debugger.scriptParsed', {
		scriptId: '4',
		scriptLanguage: 'WebAssembly',
		url: WEBASSEMBLY_URL,
	});
	child.emit('Profiler.preciseCoverageDeltaUpdate', {
		result: [coverage('3', '', 42), coverage('4', '', 8)],
	});
	await collector.settle();

	const capture = await collector.collect();
	assert.deepEqual(capture.entries, [coverage(
		'3',
		'http://127.0.0.1:4322/worker.js',
		42,
	)]);
	assert.deepEqual([...capture.sources], [[
		'http://127.0.0.1:4322/worker.js',
		'service-worker-source:3',
	]]);
});

test('browser-level worker coverage routes only the requested worker and worklet targets', async () => {
	const root = new FakeRootSession();
	const children = new Map([
		['worker-session', new FakeTargetSession()],
		['worklet-session', new FakeTargetSession()],
	]);
	const collector = createBrowserServiceWorkerCoverageCollector({
		openTargetSession: (_root: unknown, sessionId: string) => {
			const child = children.get(sessionId);
			if (child === undefined) throw new Error(`Unexpected target ${sessionId}.`);
			return child;
		},
		rootSession: root,
		targetTypes: ['worker', 'worklet'],
	});

	await collector.start();
	assert.deepEqual(root.calls[0], ['Target.setAutoAttach', {
		autoAttach: true,
		flatten: true,
		filter: [{ type: 'worker' }, { type: 'worklet' }, { exclude: true }],
		waitForDebuggerOnStart: true,
	}]);
	root.emit('Target.attachedToTarget', {
		sessionId: 'page-session',
		targetInfo: { type: 'page', url: 'http://127.0.0.1:4322/' },
		waitingForDebugger: true,
	});
	root.emit('Target.attachedToTarget', {
		sessionId: 'service-worker-session',
		targetInfo: { type: 'service_worker', url: 'http://127.0.0.1:4322/sw.js' },
		waitingForDebugger: true,
	});
	root.emit('Target.attachedToTarget', {
		sessionId: 'worker-session',
		targetInfo: { type: 'worker', url: 'http://127.0.0.1:4322/worker.js' },
		waitingForDebugger: true,
	});
	root.emit('Target.attachedToTarget', {
		sessionId: 'worklet-session',
		targetInfo: { type: 'worklet', url: 'http://127.0.0.1:4322/worklet.js' },
		waitingForDebugger: false,
	});
	await collector.settle();
	children.get('worker-session')?.emit('Profiler.preciseCoverageDeltaUpdate', {
		result: [coverage('4', 'http://127.0.0.1:4322/worker.js', 24)],
	});
	children.get('worklet-session')?.emit('Profiler.preciseCoverageDeltaUpdate', {
		result: [coverage('5', 'http://127.0.0.1:4322/worklet.js', 32)],
	});
	children.get('worklet-session')?.emit('Debugger.paused', {
		callFrames: [{ location: { scriptId: 'coverage-worklet-hook' } }],
	});
	await collector.settle();
	assert.ok(children.get('worklet-session')?.calls.some(([method]) => method === 'Debugger.resume'));

	const capture = await collector.collect();
	assert.deepEqual(capture.entries.map(({ url }) => url), [
		'http://127.0.0.1:4322/worker.js',
		'http://127.0.0.1:4322/worklet.js',
	]);
	assert.deepEqual(capture.pausedTargetCounts, { worker: 1 });
	assert.deepEqual(capture.targetCounts, { worker: 1, worklet: 1 });
	assert.deepEqual(capture.targetTypes, ['worker', 'worklet']);
});

test('a worklet release failure fails its lifecycle checkpoint closed', async () => {
	const root = new FakeRootSession();
	const child = new FakeTargetSession();
	const collector = createBrowserServiceWorkerCoverageCollector({
		openTargetSession: () => child,
		rootSession: root,
		targetTypes: ['worklet'],
	});
	await collector.start();
	root.emit('Target.attachedToTarget', {
		sessionId: 'worklet-session',
		targetInfo: { type: 'worklet', url: 'http://127.0.0.1:4322/worklet.js' },
		waitingForDebugger: false,
	});
	await collector.settle();
	child.detachFailure = new Error('worklet release failed');
	await assert.rejects(
		collector.checkpoint({ releaseWorklets: true }),
		/worklet release failed/u,
	);
	child.detachFailure = null;
	await collector.collect();
});

function coverage(scriptId: string, url: string, endOffset: number) {
	return {
		functions: [{
			functionName: '',
			isBlockCoverage: true,
			ranges: [{ count: 1, endOffset, startOffset: 0 }],
		}],
		scriptId,
		url,
	};
}

class FakeRootSession extends EventEmitter {
	readonly calls: Array<[string, unknown]> = [];
	detachCount = 0;

	async detach(): Promise<void> { this.detachCount += 1; }

	async send(method: string, parameters?: unknown): Promise<Record<string, never>> {
		this.calls.push([method, parameters]);
		return {};
	}
}

class FakeTargetSession extends EventEmitter {
	readonly calls: Array<[string, unknown]> = [];
	readonly sources = new Map<string, string>();
	detachFailure: Error | null = null;
	detachCount = 0;

	close(): void {
		this.emit('close');
	}

	async detach(): Promise<void> {
		this.detachCount += 1;
		if (this.detachFailure !== null) throw this.detachFailure;
	}

	async send(method: string, parameters?: { scriptId?: string }): Promise<unknown> {
		this.calls.push([method, parameters]);
		if (method === 'Runtime.evaluate') {
			queueMicrotask(() => {
				this.emit('Debugger.scriptParsed', {
					scriptId: 'coverage-worklet-hook',
					url: WORKLET_COVERAGE_CHECKPOINT_URL,
				});
			});
			return { result: { value: true } };
		}
		if (method === 'Debugger.getScriptSource') {
			const scriptId = String(parameters?.scriptId);
			if (scriptId === '4') return { bytecode: 'AGFzbQEAAAA=', scriptSource: '' };
			return { scriptSource: this.sources.get(scriptId) ?? `service-worker-source:${scriptId}` };
		}
		if (method === 'Profiler.takePreciseCoverage') return { result: [] };
		return {};
	}
}
