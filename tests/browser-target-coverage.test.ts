/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createBrowserTargetCoverageCollector,
} from '../scripts/lib/browser-target-coverage.mjs';

test('browser target coverage instruments related workers before they run', async () => {
	const root = fakeRootSession();
	const collector = createBrowserTargetCoverageCollector(root);
	await collector.start();
	assert.deepEqual(root.direct.at(-1), ['Target.setAutoAttach', {
		autoAttach: true,
		waitForDebuggerOnStart: true,
		flatten: false,
		filter: [
			{ type: 'worker' },
			{ type: 'shared_worker' },
			{ type: 'service_worker' },
			{ type: 'worklet' },
			{ type: 'shared_storage_worklet' },
			{ exclude: true },
		],
	}]);

	root.attach('worker-session', 'worker');
	await collector.settle();
	assert.deepEqual(root.targetMethods('worker-session'), [
		'Profiler.enable',
		'Runtime.enable',
		'Profiler.startPreciseCoverage',
		'Runtime.runIfWaitingForDebugger',
	]);
	assert.deepEqual(root.targetParams('worker-session', 'Profiler.startPreciseCoverage'), {
		callCount: false,
		detailed: true,
		allowTriggeredUpdates: true,
	});

	root.targetEvent('worker-session', 'Profiler.preciseCoverageDeltaUpdate', {
		result: [coverage('http://127.0.0.1:4322/assets/delta-worker.js', '1')],
	});
	root.takeResult.set('worker-session', [coverage('http://127.0.0.1:4322/assets/worker.js', '2')]);
	const entries = await collector.collect();

	assert.deepEqual(entries.map(({ url }) => url), [
		'http://127.0.0.1:4322/assets/delta-worker.js',
		'http://127.0.0.1:4322/assets/worker.js',
	]);
	assert.deepEqual(root.targetMethods('worker-session').slice(-3), [
		'Profiler.takePreciseCoverage',
		'Profiler.stopPreciseCoverage',
		'Profiler.disable',
	]);
	assert.deepEqual(root.direct.at(-1), ['Target.setAutoAttach', {
		autoAttach: false,
		waitForDebuggerOnStart: false,
		flatten: false,
	}]);
});

test('browser target coverage keeps a triggered update when a short-lived worker exits', async () => {
	const root = fakeRootSession();
	const collector = createBrowserTargetCoverageCollector(root);
	await collector.start();
	root.attach('short-session', 'service_worker');
	await collector.settle();
	root.targetEvent('short-session', 'Profiler.preciseCoverageDeltaUpdate', {
		result: [coverage('http://127.0.0.1:4322/service-worker.js', '3')],
	});
	root.detachTarget('short-session');

	assert.deepEqual((await collector.collect()).map(({ url }) => url), [
		'http://127.0.0.1:4322/service-worker.js',
	]);
});

function coverage(url: string, scriptId: string) {
	return {
		url,
		scriptId,
		functions: [{ functionName: '', isBlockCoverage: true, ranges: [{ startOffset: 0, endOffset: 10, count: 1 }] }],
	};
}

function fakeRootSession() {
	const listeners = new Map<string, ((value: unknown) => void)[]>();
	const direct: [string, unknown][] = [];
	const targets: { sessionId: string, method: string, params: unknown }[] = [];
	const takeResult = new Map<string, unknown[]>();
	const emit = (event: string, value: unknown) => {
		for (const listener of listeners.get(event) ?? []) listener(value);
	};
	return {
		direct,
		takeResult,
		on(event: string, listener: (value: unknown) => void) {
			listeners.set(event, [...listeners.get(event) ?? [], listener]);
		},
		async send(method: string, params: Record<string, unknown>) {
			direct.push([method, params]);
			if (method !== 'Target.sendMessageToTarget') return {};
			const sessionId = String(params.sessionId);
			const message = JSON.parse(String(params.message)) as {
				id: number,
				method: string,
				params: unknown,
			};
			targets.push({ sessionId, method: message.method, params: message.params });
			const result = message.method === 'Profiler.takePreciseCoverage'
				? { result: takeResult.get(sessionId) ?? [] }
				: {};
			queueMicrotask(() => emit('Target.receivedMessageFromTarget', {
				sessionId,
				message: JSON.stringify({ id: message.id, result }),
			}));
			return {};
		},
		attach(sessionId: string, type: string) {
			emit('Target.attachedToTarget', { sessionId, targetInfo: { type }, waitingForDebugger: true });
		},
		detachTarget(sessionId: string) {
			emit('Target.detachedFromTarget', { sessionId });
		},
		targetEvent(sessionId: string, method: string, params: unknown) {
			emit('Target.receivedMessageFromTarget', {
				sessionId,
				message: JSON.stringify({ method, params }),
			});
		},
		targetMethods(sessionId: string) {
			return targets.filter((entry) => entry.sessionId === sessionId).map(({ method }) => method);
		},
		targetParams(sessionId: string, method: string) {
			return targets.find((entry) => entry.sessionId === sessionId && entry.method === method)?.params;
		},
	};
}
