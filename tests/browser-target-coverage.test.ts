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
			{ type: 'worklet' },
			{ type: 'shared_storage_worklet' },
			{ exclude: true },
		],
	}]);

	root.attach('worker-session', 'worker');
	await collector.settle();
	assert.deepEqual(root.targetMethods('worker-session'), [
		'Debugger.enable',
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

test('browser target coverage keeps a triggered update when a short-lived dedicated worker exits', async () => {
	const root = fakeRootSession();
	const collector = createBrowserTargetCoverageCollector(root);
	await collector.start();
	root.attach('short-session', 'worker');
	await collector.settle();
	root.targetEvent('short-session', 'Profiler.preciseCoverageDeltaUpdate', {
		result: [coverage('http://127.0.0.1:4322/assets/short-worker.js', '3')],
	});
	root.detachTarget('short-session');

	assert.deepEqual((await collector.collect()).map(({ url }) => url), [
		'http://127.0.0.1:4322/assets/short-worker.js',
	]);
});

test('browser target coverage checkpoints a worker before its owner navigates away', async () => {
	const root = fakeRootSession();
	const collector = createBrowserTargetCoverageCollector(root);
	await collector.start();
	root.attach('navigating-session', 'worker');
	await collector.settle();
	root.takeResult.set('navigating-session', [coverage(
		'http://127.0.0.1:4322/assets/navigation-worker.js',
		'4',
	)]);

	await collector.checkpoint();
	root.detachTarget('navigating-session');

	assert.deepEqual((await collector.collect()).map(({ url }) => url), [
		'http://127.0.0.1:4322/assets/navigation-worker.js',
	]);
});

test('browser target coverage ignores a detach while its startup command is dispatching', async () => {
	const root = fakeRootSession();
	root.holdTargetCommand('short-session', 'Profiler.enable');
	const collector = createBrowserTargetCoverageCollector(root);
	await collector.start();
	root.attach('short-session', 'worker');
	assert.deepEqual(root.targetMethods('short-session'), [
		'Debugger.enable',
		'Profiler.enable',
		'Runtime.enable',
		'Profiler.startPreciseCoverage',
		'Runtime.runIfWaitingForDebugger',
	]);

	root.detachTarget('short-session');
	await new Promise<void>((resolve) => { setImmediate(resolve); });
	root.releaseTargetCommand('short-session', 'Profiler.enable');

	await collector.settle();
	assert.deepEqual(await collector.collect(), []);
});

test('browser target coverage reports a startup command error for an active target', async () => {
	const root = fakeRootSession();
	root.failTargetCommand('broken-session', 'Profiler.enable', 'Profiler is unavailable.');
	const collector = createBrowserTargetCoverageCollector(root);
	await collector.start();
	root.attach('broken-session', 'worker');

	await assert.rejects(collector.settle(), /Profiler is unavailable\./u);
});

test('browser target coverage tolerates only a closed root target during final detach', async () => {
	const closed = fakeRootSession();
	const closedCollector = createBrowserTargetCoverageCollector(closed);
	await closedCollector.start();
	closed.failNextDirect('Target.setAutoAttach', 'Target page, context or browser has been closed');
	assert.deepEqual(await closedCollector.collect(), []);

	const broken = fakeRootSession();
	const brokenCollector = createBrowserTargetCoverageCollector(broken);
	await brokenCollector.start();
	broken.failNextDirect('Target.setAutoAttach', 'Coverage transport is unavailable.');
	await assert.rejects(brokenCollector.collect(), /Coverage transport is unavailable\./u);

	const brokenCollection = fakeRootSession();
	brokenCollection.failTargetCommand('broken-session', 'Profiler.enable', 'Profiler is unavailable.');
	const brokenCollectionCollector = createBrowserTargetCoverageCollector(brokenCollection);
	await brokenCollectionCollector.start();
	brokenCollection.attach('broken-session', 'worker');
	brokenCollection.failNextDirect('Target.setAutoAttach', 'Target page, context or browser has been closed');
	await assert.rejects(brokenCollectionCollector.collect(), /Profiler is unavailable\./u);
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
	const heldTargetCommands = new Map<string, () => void>();
	const targetCommandsToHold = new Set<string>();
	const targetCommandErrors = new Map<string, string>();
	const directCommandErrors = new Map<string, string>();
	const targetCommandKey = (sessionId: string, method: string) => `${sessionId}\0${method}`;
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
			const directError = directCommandErrors.get(method);
			if (directError !== undefined) {
				directCommandErrors.delete(method);
				throw new Error(directError);
			}
			if (method !== 'Target.sendMessageToTarget') return {};
			const sessionId = String(params.sessionId);
			const message = JSON.parse(String(params.message)) as {
				id: number,
				method: string,
				params: unknown,
			};
			targets.push({ sessionId, method: message.method, params: message.params });
			const commandKey = targetCommandKey(sessionId, message.method);
			if (targetCommandsToHold.has(commandKey)) {
				await new Promise<void>((resolve) => { heldTargetCommands.set(commandKey, resolve); });
			}
			const result = message.method === 'Profiler.takePreciseCoverage'
				? { result: takeResult.get(sessionId) ?? [] }
				: {};
			queueMicrotask(() => emit('Target.receivedMessageFromTarget', {
				sessionId,
				message: JSON.stringify(targetCommandErrors.has(commandKey)
					? { id: message.id, error: { message: targetCommandErrors.get(commandKey) } }
					: { id: message.id, result }),
			}));
			return {};
		},
		attach(sessionId: string, type: string) {
			emit('Target.attachedToTarget', { sessionId, targetInfo: { type }, waitingForDebugger: true });
		},
		detachTarget(sessionId: string) {
			emit('Target.detachedFromTarget', { sessionId });
		},
		failTargetCommand(sessionId: string, method: string, message: string) {
			targetCommandErrors.set(targetCommandKey(sessionId, method), message);
		},
		failNextDirect(method: string, message: string) {
			directCommandErrors.set(method, message);
		},
		holdTargetCommand(sessionId: string, method: string) {
			targetCommandsToHold.add(targetCommandKey(sessionId, method));
		},
		releaseTargetCommand(sessionId: string, method: string) {
			const commandKey = targetCommandKey(sessionId, method);
			targetCommandsToHold.delete(commandKey);
			heldTargetCommands.get(commandKey)?.();
			heldTargetCommands.delete(commandKey);
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
