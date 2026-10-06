/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { digestMediaContentInWorker } from '../src/common/editor/media-content-digest-worker-client.ts';
import { executeMediaContentDigestRequest } from '../src/common/editor/media-content-digest-worker-runtime.ts';
import type { OneShotWorkerPort } from '../src/common/editor/one-shot-worker-task.ts';

type Listener = Parameters<OneShotWorkerPort['addEventListener']>[1];
class DigestWorker implements OneShotWorkerPort {
	readonly listeners = new Map<string, Set<Listener>>();
	terminated = false;
	stalled = false;
	addEventListener(type: string, listener: Listener): void {
		const entries = this.listeners.get(type) ?? new Set(); entries.add(listener); this.listeners.set(type, entries);
	}
	removeEventListener(type: string, listener: Listener): void { this.listeners.get(type)?.delete(listener); }
	postMessage(request: unknown): void {
		if (this.stalled) return;
		void executeMediaContentDigestRequest(structuredClone(request)).then(response => {
			for (const listener of this.listeners.get('message') ?? []) listener({ data: response });
		});
	}
	terminate(): void { this.terminated = true; }
}

test('worker hashes the exact immutable Blob in bounded spans without its full arrayBuffer', async () => {
	const bytes = Uint8Array.from({ length: 9 * 1024 * 1024 + 3 }, (_, i) => i % 251);
	class ReviewedBlob extends Blob {
		override async arrayBuffer(): Promise<ArrayBuffer> { throw new Error('Whole-file read'); }
		override slice(): Blob { throw new Error('Mutable caller override'); }
	}
	const worker = new DigestWorker();
	assert.equal(await digestMediaContentInWorker(new ReviewedBlob([bytes]), { workerFactory: () => worker }), bytesToHex(sha256(bytes)));
	assert.equal(worker.terminated, true);
	assert.ok([...worker.listeners.values()].every(listeners => listeners.size === 0));
});

test('hash cancellation terminates a stalled worker and retains its reason', async () => {
	const worker = new DigestWorker(); worker.stalled = true;
	const controller = new AbortController();
	const pending = digestMediaContentInWorker(new Blob(['audio']), { workerFactory: () => worker, signal: controller.signal });
	const reason = new DOMException('Project replaced', 'AbortError'); controller.abort(reason);
	await assert.rejects(pending, error => error === reason);
	assert.equal(worker.terminated, true);
});

test('digest worker refuses forged Blob shapes and bounded request ids', async () => {
	const result = await executeMediaContentDigestRequest({ requestId: 'hash', blob: { size: 1, arrayBuffer: () => new ArrayBuffer(1) } });
	assert.equal(result.type, 'error');
	assert.equal((await executeMediaContentDigestRequest({ requestId: '', blob: new Blob(['audio']) })).type, 'error');
});
