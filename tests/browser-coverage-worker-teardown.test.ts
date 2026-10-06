/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { setImmediate } from 'node:timers/promises';
import test from 'node:test';

import {
	createBrowserServiceWorkerCoverageCollector,
	WORKLET_COVERAGE_CHECKPOINT_URL,
} from '../scripts/lib/browser-service-worker-coverage.mjs';

const WASM_URL = 'wasm://wasm/00091612';
const WORKER_URL = 'http://127.0.0.1:4322/worker.js';

test('a released worklet ignores queued script events after its final checkpoint', async () => {
	const { child, collector } = await fixture('worklet');
	child.finalCoverageResult = [coverage('worker', WORKER_URL)];
	await collector.checkpoint({ releaseWorklets: true });
	child.debuggerEnabled = false;
	const previousReads = child.sourceReadCount;
	child.emit('Debugger.scriptParsed', {
		scriptId: 'late-wasm', scriptLanguage: 'WebAssembly', url: WASM_URL,
	});
	child.emit('Debugger.scriptParsed', { scriptId: 'late-js', url: WORKER_URL });
	const capture = await collector.collect();
	assert.equal(child.sourceReadCount, previousReads);
	assert.deepEqual(capture.entries, [coverage('worker', WORKER_URL)]);
});

test('a detached worker preserves its JavaScript delta when a pending Wasm read rejects', async () => {
	const { child, collector, root } = await fixture('worker');
	const source = deferred<unknown>();
	child.sourceReply = source.promise;
	child.emit('Debugger.scriptParsed', {
		scriptId: 'wasm', scriptLanguage: 'WebAssembly', url: WASM_URL,
	});
	child.emit('Profiler.preciseCoverageDeltaUpdate', {
		result: [coverage('worker', WORKER_URL), coverage('wasm', WASM_URL)],
	});
	root.emit('Target.detachedFromTarget', { sessionId: 'target' });
	source.reject(new Error('Protocol error (Debugger.getScriptSource): Debugger agent is not enabled'));
	const capture = await collector.collect();
	assert.deepEqual(capture.entries, [coverage('worker', WORKER_URL)]);
});

test('a live worker cannot hide a rejected Wasm source read', async () => {
	const { child, collector } = await fixture('worker');
	const source = deferred<unknown>();
	child.sourceReply = source.promise;
	child.emit('Debugger.scriptParsed', {
		scriptId: 'wasm', scriptLanguage: 'WebAssembly', url: WASM_URL,
	});
	source.reject(new Error('live Wasm source read failed'));
	await assert.rejects(collector.collect(), /live Wasm source read failed/u);
});

test('a detached worker cannot hide invalid bytes from a successful Wasm source reply', async () => {
	const { child, collector, root } = await fixture('worker');
	const source = deferred<unknown>();
	child.sourceReply = source.promise;
	child.emit('Debugger.scriptParsed', {
		scriptId: 'wasm', scriptLanguage: 'WebAssembly', url: WASM_URL,
	});
	root.emit('Target.detachedFromTarget', { sessionId: 'target' });
	source.resolve({ bytecode: 'not wasm', scriptSource: '' });
	await assert.rejects(collector.collect(), /non-JavaScript WebAssembly bytes/u);
});

for (const detached of [false, true]) {
	test(`a ${detached ? 'detached' : 'live'} worker rejects a successful null Wasm source reply`, async () => {
		const { child, collector, root } = await fixture('worker');
		const source = deferred<unknown>();
		child.sourceReply = source.promise;
		child.emit('Debugger.scriptParsed', {
			scriptId: 'wasm', scriptLanguage: 'WebAssembly', url: WASM_URL,
		});
		if (detached) root.emit('Target.detachedFromTarget', { sessionId: 'target' });
		source.resolve(null);
		await assert.rejects(collector.collect(), /non-JavaScript WebAssembly bytes/u);
	});
}

test('final coverage drains late Wasm source reads before disabling the debugger', async () => {
	const { child, collector } = await fixture('worker');
	const source = deferred<unknown>();
	child.sourceReply = source.promise;
	child.finalCoverageResult = [coverage('worker', WORKER_URL), coverage('wasm', WASM_URL)];
	child.onFinalCoverage = () => child.emit('Debugger.scriptParsed', {
		scriptId: 'wasm', scriptLanguage: 'WebAssembly', url: WASM_URL,
	});
	child.onDebuggerDisabled = () => source.reject(new Error('Debugger agent is not enabled'));
	const collection = collector.collect();
	void collection.catch(() => undefined);
	await setImmediate();
	const debuggerEnabledDuringRead = child.debuggerEnabled;
	source.resolve({ bytecode: 'AGFzbQEAAAA=', scriptSource: '' });
	assert.equal(debuggerEnabledDuringRead, true);
	const capture = await collection;
	assert.deepEqual(capture.entries, [coverage('worker', WORKER_URL)]);
});

test('a worker detaching during final capture cannot hide a successful malformed Wasm reply', async () => {
	const { child, collector } = await fixture('worker');
	const source = deferred<unknown>();
	child.sourceReply = source.promise;
	child.onFinalCoverage = () => child.emit('Debugger.scriptParsed', {
		scriptId: 'wasm', scriptLanguage: 'WebAssembly', url: WASM_URL,
	});
	child.onProfilerDisabled = () => {
		child.close();
		source.resolve({ bytecode: 'not wasm', scriptSource: '' });
	};
	await assert.rejects(collector.collect(), /non-JavaScript WebAssembly bytes/u);
});

async function fixture(type: 'worker' | 'worklet') {
	const root = Object.assign(new EventEmitter(), {
		async detach() {},
		async send() { return {}; },
	});
	const child = new FakeTargetSession();
	const collector = createBrowserServiceWorkerCoverageCollector({
		openTargetSession: () => child,
		rootSession: root,
		targetTypes: [type],
	});
	await collector.start();
	root.emit('Target.attachedToTarget', {
		sessionId: 'target', targetInfo: { type, url: WORKER_URL }, waitingForDebugger: false,
	});
	await collector.settle();
	return { child, collector, root };
}

function coverage(scriptId: string, url: string) {
	return {
		functions: [{
			functionName: '', isBlockCoverage: true,
			ranges: [{ count: 1, endOffset: 5, startOffset: 0 }],
		}],
		scriptId,
		url,
	};
}

function deferred<Value>() {
	let reject!: (error: Error) => void;
	let resolve!: (value: Value) => void;
	const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
		reject = rejectPromise;
		resolve = resolvePromise;
	});
	return { promise, reject, resolve };
}

class FakeTargetSession extends EventEmitter {
	debuggerEnabled = true;
	finalCoverageResult: unknown[] = [];
	onDebuggerDisabled: (() => void) | null = null;
	onFinalCoverage: (() => void) | null = null;
	onProfilerDisabled: (() => void) | null = null;
	sourceReadCount = 0;
	sourceReply: Promise<unknown> | null = null;

	close(): void { this.emit('close'); }
	async detach(): Promise<void> {}

	async send(method: string): Promise<unknown> {
		if (method === 'Profiler.disable') this.onProfilerDisabled?.();
		if (method === 'Debugger.disable') {
			this.debuggerEnabled = false;
			this.onDebuggerDisabled?.();
		}
		if (method === 'Debugger.getScriptSource') {
			this.sourceReadCount += 1;
			if (!this.debuggerEnabled) throw new Error('Debugger agent is not enabled');
			return this.sourceReply ?? { scriptSource: 'source' };
		}
		if (method === 'Runtime.evaluate') {
			this.emit('Debugger.scriptParsed', {
				scriptId: 'hook', url: WORKLET_COVERAGE_CHECKPOINT_URL,
			});
			return { result: { value: true } };
		}
		if (method === 'Profiler.takePreciseCoverage') {
			this.onFinalCoverage?.();
			this.onFinalCoverage = null;
			return { result: this.finalCoverageResult };
		}
		return {};
	}
}
