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

test('a detached target may close before its pending source reply', async () => {
	const root = new FakeRootSession();
	const child = new FakeTargetSession();
	let rejectSource!: (error: Error) => void;
	child.scriptSourceReply = new Promise((_resolve, reject) => { rejectSource = reject; });
	const collector = createBrowserServiceWorkerCoverageCollector({
		openTargetSession: () => child,
		rootSession: root,
	});
	await collector.start();
	root.emit('Target.attachedToTarget', {
		sessionId: 'detaching-service-worker',
		targetInfo: { type: 'service_worker', url: 'http://127.0.0.1:4322/transient.js' },
		waitingForDebugger: false,
	});
	await collector.settle();
	child.emit('Debugger.scriptParsed', {
		scriptId: 'transient',
		url: 'http://127.0.0.1:4322/transient.js',
	});
	root.emit('Target.detachedFromTarget', { sessionId: 'detaching-service-worker' });
	rejectSource(new Error('Internal server error, session closed'));
	const capture = await collector.collect();
	assert.deepEqual(capture.entries, []);
	assert.deepEqual([...capture.sources], []);
});

test('a live target cannot hide a source capture failure', async () => {
	const root = new FakeRootSession();
	const child = new FakeTargetSession();
	child.scriptSourceReply = Promise.reject(new Error('live source capture failed'));
	const collector = createBrowserServiceWorkerCoverageCollector({
		openTargetSession: () => child,
		rootSession: root,
	});
	await collector.start();
	root.emit('Target.attachedToTarget', {
		sessionId: 'live-service-worker',
		targetInfo: { type: 'service_worker', url: 'http://127.0.0.1:4322/live.js' },
		waitingForDebugger: false,
	});
	await collector.settle();
	child.emit('Debugger.scriptParsed', { scriptId: 'live', url: 'http://127.0.0.1:4322/live.js' });
	await assert.rejects(collector.collect(), /live source capture failed/u);
});

test('browser-owned worker scripts stay outside capture and final profiles', async () => {
	const root = new FakeRootSession();
	const child = new FakeTargetSession();
	const collector = createBrowserServiceWorkerCoverageCollector({
		openTargetSession: () => child,
		rootSession: root,
		targetTypes: ['worker'],
	});
	await collector.start();
	root.emit('Target.attachedToTarget', {
		sessionId: 'browser-worker',
		targetInfo: { type: 'worker', url: 'chrome-error://chromewebdata/' },
		waitingForDebugger: false,
	});
	await collector.settle();
	child.emit('Debugger.scriptParsed', { scriptId: 'browser', url: 'chrome-error://chromewebdata/' });
	child.emit('Profiler.preciseCoverageDeltaUpdate', {
		result: [coverage('browser', 'chrome-error://chromewebdata/', 1)],
	});
	const capture = await collector.collect();
	assert.deepEqual(capture.entries, []);
	assert.deepEqual([...capture.sources], []);
	assert.equal(child.calls.some(([method]) => method === 'Debugger.getScriptSource'), false);
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

test('final worker checkpoint awaits late WebAssembly authentication failure', async () => {
	const root = new FakeRootSession();
	const child = new FakeTargetSession();
	let rejectAuthentication!: (error: Error) => void;
	let authenticationStarted!: () => void;
	let debuggerDisabled!: () => void;
	const started = new Promise<void>((resolvePromise) => { authenticationStarted = resolvePromise; });
	const disabled = new Promise<void>((resolvePromise) => { debuggerDisabled = resolvePromise; });
	const authentication = new Promise<boolean>((_resolvePromise, reject) => {
		rejectAuthentication = reject;
	});
	const collector = createBrowserServiceWorkerCoverageCollector({
		authenticateWebAssembly: () => {
			authenticationStarted();
			return authentication;
		},
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
	child.onFinalCoverage = () => child.emit('Debugger.scriptParsed', {
		scriptId: 'late-wasm',
		scriptLanguage: 'WebAssembly',
		url: 'http://127.0.0.1:4322/assets/late.wasm',
	});
	child.onDebuggerDisabled = debuggerDisabled;

	const collection = collector.collect();
	await Promise.all([started, disabled]);
	rejectAuthentication(new Error('late WebAssembly authentication failed'));
	await assert.rejects(collection, /late WebAssembly authentication failed/u);
});

test('worker listener banks a script identity rebind failure', async () => {
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
		scriptId: '4', scriptLanguage: 'WebAssembly', url: WEBASSEMBLY_URL,
	});
	await collector.settle();
	assert.doesNotThrow(() => child.emit('Debugger.scriptParsed', {
		scriptId: '4', scriptLanguage: 'JavaScript', url: WEBASSEMBLY_URL,
	}));
	await assert.rejects(collector.settle(), /CDP rebound script.*WebAssembly.*JavaScript/u);
});

test('worker coverage preserves old ranges before execution-context ID reuse', async () => {
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
		executionContextId: 41,
		scriptId: '7',
		url: 'http://127.0.0.1:4322/old-worker.js',
	});
	await collector.settle();
	child.emit('Profiler.preciseCoverageDeltaUpdate', {
		result: [coverage('7', '', 21)],
	});
	child.emit('Runtime.executionContextsCleared', {});
	child.emit('Debugger.scriptParsed', {
		executionContextId: 41,
		scriptId: '7',
		url: 'http://127.0.0.1:4322/new-worker.js',
	});
	await collector.settle();
	child.emit('Profiler.preciseCoverageDeltaUpdate', {
		result: [coverage('7', '', 22)],
	});

	const capture = await collector.collect();
	assert.deepEqual(capture.entries, [
		coverage('7', 'http://127.0.0.1:4322/old-worker.js', 21),
		coverage('7', 'http://127.0.0.1:4322/new-worker.js', 22),
	]);
});

test('worker teardown cannot hide invalid coverage returned while it detaches', async () => {
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
		scriptId: '4', scriptLanguage: 'WebAssembly', url: WEBASSEMBLY_URL,
	});
	await collector.settle();
	child.finalCoverageResult = [coverage('4', 'http://127.0.0.1:4322/not-wasm.js', 8)];
	child.onFinalCoverage = () => child.emit('close');
	await assert.rejects(collector.collect(), /different WebAssembly script URL/u);
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
	finalCoverageResult: unknown[] = [];
	onDebuggerDisabled: (() => void) | null = null;
	onFinalCoverage: (() => void) | null = null;
	scriptSourceReply: Promise<unknown> | null = null;

	close(): void {
		this.emit('close');
	}

	async detach(): Promise<void> {
		this.detachCount += 1;
		if (this.detachFailure !== null) throw this.detachFailure;
	}

	async send(method: string, parameters?: { scriptId?: string }): Promise<unknown> {
		this.calls.push([method, parameters]);
		if (method === 'Debugger.disable') this.onDebuggerDisabled?.();
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
			if (this.scriptSourceReply !== null) return this.scriptSourceReply;
			const scriptId = String(parameters?.scriptId);
			if (scriptId === '4' || scriptId === 'late-wasm') {
				return { bytecode: 'AGFzbQEAAAA=', scriptSource: '' };
			}
			return { scriptSource: this.sources.get(scriptId) ?? `service-worker-source:${scriptId}` };
		}
		if (method === 'Profiler.takePreciseCoverage') {
			this.onFinalCoverage?.();
			this.onFinalCoverage = null;
			return { result: this.finalCoverageResult };
		}
		return {};
	}
}
