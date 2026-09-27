/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import { WORKLET_COVERAGE_CHECKPOINT_URL } from '../scripts/lib/browser-service-worker-coverage.mjs';
import { startPackagedRuntimeTargetCoverage } from './browser/helpers/packaged-runtime-target-coverage.js';

test('packaged worklet coverage queues resume before awaiting the realtime checkpoint', async () => {
	const session = new ResumeGatedWorkletSession();
	const pending: Promise<unknown>[] = [];
	const coverage = await startPackagedRuntimeTargetCoverage({
		authenticateWebAssembly: async () => true,
		keepUrl: () => false,
		page: { isClosed: () => false },
		pending,
		rootSession: session,
	});

	await Promise.race([
		coverage.checkpoint(),
		new Promise((_, reject) => setTimeout(
			() => reject(new Error('Worklet checkpoint waited for coverage before queueing resume.')),
			250,
		)),
	]);
	const checkpoint = session.childCalls.indexOf('Profiler.takePreciseCoverage');
	const resume = session.childCalls.indexOf('Debugger.resume');
	assert.ok(checkpoint >= 0);
	assert.equal(resume, checkpoint + 1);
});

test('packaged worklet coverage ignores resume failure after its target detaches', async () => {
	const session = new ResumeGatedWorkletSession({ detachOnResume: true });
	const pending: Promise<unknown>[] = [];
	const coverage = await startPackagedRuntimeTargetCoverage({
		authenticateWebAssembly: async () => true,
		keepUrl: () => false,
		page: { isClosed: () => false },
		pending,
		rootSession: session,
	});

	await coverage.checkpoint();
	assert.equal(session.childCalls.includes('Debugger.resume'), true);
});

test('packaged worklet pause resumes an already running global checkpoint', async () => {
	const session = new ResumeGatedWorkletSession({ pauseOnStart: false });
	const pending: Promise<unknown>[] = [];
	const coverage = await startPackagedRuntimeTargetCoverage({
		authenticateWebAssembly: async () => true,
		keepUrl: () => false,
		page: { isClosed: () => false },
		pending,
		rootSession: session,
	});

	const checkpoint = coverage.checkpoint();
	for (let turn = 0; turn < 20
		&& !session.childCalls.includes('Profiler.takePreciseCoverage'); turn += 1) {
		await new Promise((resolve) => setImmediate(resolve));
	}
	assert.equal(session.childCalls.includes('Profiler.takePreciseCoverage'), true);
	session.pauseWorklet();
	await Promise.race([
		checkpoint,
		new Promise((_, reject) => setTimeout(
			() => reject(new Error('Paused worklet did not resume its in-flight global checkpoint.')),
			250,
		)),
	]);
});

class ResumeGatedWorkletSession extends EventEmitter {
	readonly childCalls: string[] = [];
	#deferredCheckpoints: { id: number; sessionId: string }[] = [];
	#deferredOnce = false;
	#detachOnResume: boolean;
	#pauseOnStart: boolean;

	constructor({ detachOnResume = false, pauseOnStart = true } = {}) {
		super();
		this.#detachOnResume = detachOnResume;
		this.#pauseOnStart = pauseOnStart;
	}

	async detach(): Promise<void> {}

	pauseWorklet(): void {
		this.#event('worklet-session', 'Debugger.paused', {
			callFrames: [{ location: { scriptId: 'worklet-checkpoint' } }],
		});
	}

	async send(method: string, parameters: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
		if (method === 'Page.addScriptToEvaluateOnNewDocument') return { identifier: 'navigation-hook' };
		if (method === 'Profiler.takePreciseCoverage') return { result: [] };
		if (method === 'Target.setAutoAttach') {
			queueMicrotask(() => this.emit('Target.attachedToTarget', {
				sessionId: 'worklet-session',
				targetInfo: { type: 'worklet' },
				waitingForDebugger: true,
			}));
			return {};
		}
		if (method !== 'Target.sendMessageToTarget') return {};
		const sessionId = String(parameters.sessionId);
		const request = JSON.parse(String(parameters.message)) as {
			id: number;
			method: string;
		};
		this.childCalls.push(request.method);
		if (request.method === 'Profiler.takePreciseCoverage' && !this.#deferredOnce) {
			this.#deferredCheckpoints.push({ id: request.id, sessionId });
			return {};
		}
		queueMicrotask(() => {
			if (request.method === 'Debugger.resume' && this.#deferredCheckpoints.length > 0) {
				if (this.#detachOnResume) {
					this.emit('Target.detachedFromTarget', { sessionId });
					return;
				}
				for (const checkpoint of this.#deferredCheckpoints.splice(0)) {
					this.#reply(checkpoint.sessionId, checkpoint.id, { result: [] });
				}
				this.#deferredOnce = true;
			}
			if (request.method === 'Debugger.resume') {
				this.#error(sessionId, request.id, 'Can only perform operation while paused.');
			} else this.#reply(sessionId, request.id,
				request.method === 'Runtime.evaluate'
					? { result: { value: true } }
					: request.method === 'Profiler.takePreciseCoverage' ? { result: [] } : {});
			if (request.method === 'Runtime.evaluate') {
				this.#event(sessionId, 'Debugger.scriptParsed', {
					scriptId: 'worklet-checkpoint',
					url: WORKLET_COVERAGE_CHECKPOINT_URL,
				});
			}
			if (request.method === 'Runtime.runIfWaitingForDebugger' && this.#pauseOnStart) {
				this.pauseWorklet();
			}
		});
		return {};
	}

	#event(sessionId: string, method: string, params: Record<string, unknown>): void {
		this.emit('Target.receivedMessageFromTarget', {
			message: JSON.stringify({ method, params }),
			sessionId,
		});
	}

	#reply(sessionId: string, id: number, result: Record<string, unknown>): void {
		this.emit('Target.receivedMessageFromTarget', {
			message: JSON.stringify({ id, result }),
			sessionId,
		});
	}

	#error(sessionId: string, id: number, message: string): void {
		this.emit('Target.receivedMessageFromTarget', {
			message: JSON.stringify({ id, error: { message } }),
			sessionId,
		});
	}
}
