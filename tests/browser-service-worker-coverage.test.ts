/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import {
	createBrowserServiceWorkerCoverageCollector,
} from '../scripts/lib/browser-service-worker-coverage.mjs';

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
			callCount: false,
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
	detachCount = 0;

	close(): void {
		this.emit('close');
	}

	async detach(): Promise<void> { this.detachCount += 1; }

	async send(method: string, parameters?: { scriptId?: string }): Promise<unknown> {
		this.calls.push([method, parameters]);
		if (method === 'Debugger.getScriptSource') {
			return { scriptSource: `service-worker-source:${String(parameters?.scriptId)}` };
		}
		if (method === 'Profiler.takePreciseCoverage') return { result: [] };
		return {};
	}
}
