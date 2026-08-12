/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	detectPcmTransientsInWorker,
	type TransientAnalysisWorkerPort,
} from '../src/common/editor/transient-analysis-worker-client.ts';
import { executeTransientAnalysisWorkerRequest } from '../src/common/editor/transient-analysis-worker-runtime.ts';

test('worker requests return the deterministic transient recipe', async () => {
	const worker = new LinkedWorker();
	const result = await detectPcmTransientsInWorker(
		[Float32Array.from([0, 0, 0, 1, 0, 0, 0, 0])],
		{
			sourceStartFrame: 20,
			parameters: { windowFrames: 4, hopFrames: 2, minimumSpacingFrames: 0 },
		},
		{ workerFactory: () => worker },
	);

	assert.deepEqual(result.sourceRange, { startFrame: 20, endFrame: 28 });
	assert.equal(result.transients[0]?.sourceFrame, 23);
	assert.equal(worker.terminated, true);
	assert.equal(worker.postedTransferCount, 1);
});

test('borrowed PCM is copied before transfer while explicit owned PCM is detached', async () => {
	const borrowed = Float32Array.from([0, 1, 0, 0]);
	const borrowedWorker = new LinkedWorker();
	await detectPcmTransientsInWorker([borrowed], {
		parameters: { windowFrames: 2, hopFrames: 1, minimumSpacingFrames: 0 },
	}, { workerFactory: () => borrowedWorker });
	assert.equal(borrowed.byteLength, 16);
	assert.equal(borrowed[1], 1);

	const owned = Float32Array.from([0, 1, 0, 0]);
	const ownedWorker = new LinkedWorker();
	await detectPcmTransientsInWorker([owned], {
		parameters: { windowFrames: 2, hopFrames: 1, minimumSpacingFrames: 0 },
	}, { workerFactory: () => ownedWorker, pcmOwnership: 'transfer' });
	assert.equal(owned.byteLength, 0);
});

test('transfer ownership rejects shared and partial backing buffers', () => {
	const backing = new Float32Array(8);
	assert.throws(
		() => detectPcmTransientsInWorker([backing.subarray(1, 5)], {}, {
			workerFactory: () => new LinkedWorker(),
			pcmOwnership: 'transfer',
		}),
		/exact-span PCM channels/iu,
	);
	assert.throws(
		() => detectPcmTransientsInWorker([backing, backing], {}, {
			workerFactory: () => new LinkedWorker(),
			pcmOwnership: 'transfer',
		}),
		/unique backing buffers/iu,
	);
});

test('direct worker requests admit geometry and detector working set before copy or worker creation', () => {
	let workers = 0;
	let posts = 0;
	const workerFactory = () => {
		workers += 1;
		const worker = new LinkedWorker();
		const postMessage = worker.postMessage.bind(worker);
		worker.postMessage = (message, transfer) => { posts += 1; postMessage(message, transfer); };
		return worker;
	};
	const oversizedWindows = new Float32Array(1_000_001);
	for (const pcmOwnership of ['borrow', 'transfer'] as const) assert.throws(() => detectPcmTransientsInWorker([oversizedWindows], {
		parameters: { windowFrames: 1, hopFrames: 1, minimumSpacingFrames: 0 },
	}, { workerFactory, pcmOwnership }), /1000000-window output bound/iu);
	assert.equal(oversizedWindows.byteLength, 4_000_004, 'borrowed input was not detached');
	assert.equal(workers, 0);

	const shared = new Float32Array(2_097_152);
	const oversizedPcm = Array.from({ length: 32 }, () => shared);
	for (const pcmOwnership of ['borrow', 'transfer'] as const) assert.throws(() => detectPcmTransientsInWorker(oversizedPcm, {
		parameters: { windowFrames: 1_048_576, hopFrames: 1_048_576 },
	}, { workerFactory, pcmOwnership }), /aggregate PCM and detector working-set bytes/iu);
	const tooManyChannels = Array.from({ length: 33 }, () => new Float32Array(1));
	assert.throws(() => detectPcmTransientsInWorker(tooManyChannels, {}, {
		workerFactory,
	}), /1 to 32/iu);
	assert.equal(workers, 0);
	assert.equal(posts, 0);
});

test('cancellation rejects with the exact reason and terminates the worker', async () => {
	const worker = new LinkedWorker({ stalled: true });
	const controller = new AbortController();
	const reason = new DOMException('superseded analysis', 'AbortError');
	const pending = detectPcmTransientsInWorker([new Float32Array(4)], {}, {
		workerFactory: () => worker,
		signal: controller.signal,
	});
	controller.abort(reason);

	await assert.rejects(pending, (error) => error === reason);
	assert.equal(worker.terminated, true);
});

test('worker failures preserve their safe name and message', async () => {
	const worker = new LinkedWorker({ failure: new RangeError('bad detector request') });
	await assert.rejects(
		detectPcmTransientsInWorker([new Float32Array(4)], {}, { workerFactory: () => worker }),
		{ name: 'RangeError', message: 'bad detector request' },
	);
});

type Listener = (event: Readonly<{ data?: unknown; error?: unknown; message?: string }>) => void;

class LinkedWorker implements TransientAnalysisWorkerPort {
	readonly #listeners = new Map<string, Set<Listener>>();
	readonly #stalled: boolean;
	readonly #failure: Error | null;
	terminated = false;
	postedTransferCount = 0;

	constructor(options: Readonly<{ stalled?: boolean; failure?: Error }> = {}) {
		this.#stalled = options.stalled ?? false;
		this.#failure = options.failure ?? null;
	}

	addEventListener(type: 'message' | 'messageerror' | 'error', listener: Listener): void {
		const listeners = this.#listeners.get(type) ?? new Set<Listener>();
		listeners.add(listener);
		this.#listeners.set(type, listeners);
	}

	removeEventListener(type: 'message' | 'messageerror' | 'error', listener: Listener): void {
		this.#listeners.get(type)?.delete(listener);
	}

	postMessage(message: unknown, transfer: readonly Transferable[] = []): void {
		this.postedTransferCount = transfer.length;
		if (this.#stalled) return;
		const delivered = structuredClone(message, { transfer: [...transfer] });
		queueMicrotask(() => {
			const response = this.#failure
				? { type: 'error', requestId: requestId(delivered), error: { name: this.#failure.name, message: this.#failure.message } }
				: executeTransientAnalysisWorkerRequest(delivered);
			this.#emit('message', { data: response });
		});
	}

	terminate(): void {
		this.terminated = true;
	}

	#emit(type: string, event: Readonly<{ data?: unknown; error?: unknown; message?: string }>): void {
		for (const listener of this.#listeners.get(type) ?? []) listener(event);
	}
}

function requestId(value: unknown): unknown {
	return typeof value === 'object' && value !== null && 'requestId' in value ? value.requestId : null;
}
