/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { OpfsSyncWorkerClient, type OpfsWorkerLike } from '../../src/common/editor/storage/opfs-sync-worker-client.ts';
import { serializeOpfsWorkerError } from '../../src/common/editor/storage/opfs-sync-worker-protocol.ts';
import { OpfsSyncWorkerRuntime } from '../../src/common/editor/storage/opfs-sync-worker-runtime.ts';
import { PHOTO_MEDIA_NAMESPACES_V1 } from '../../src/lightscaper/storage/photo-media-store.ts';
import { deferred } from './async-test-control.ts';
import { InstrumentedKeyRange } from './instrumented-indexeddb-keys.ts';

export type AcquisitionCut = 'file' | 'access' | 'open-result' | 'close-result';
export function observed<Value>(work: Promise<Value>) {
	return work.then(value => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }));
}

export class ControlledFile {
	bytes: Uint8Array<ArrayBuffer>;
	readonly calls: string[] = [];
	constructor(bytes: Uint8Array = new Uint8Array()) { this.bytes = new Uint8Array(bytes); }
}

// Explicit Node Worker/FileSystem ports. The actual production runtime computes
// every response, writer identity, cancellation and cleanup outcome; this port
// only controls filesystem acquisition or delivery of an already settled result.
// It does not demonstrate browser Worker, OPFS or native image execution.
export class WriterAcquisitionFixture {
	readonly files = new Map<string, ControlledFile>();
	readonly entries = new Map<string, ControlledFile>();
	readonly events: string[] = [];
	readonly workers: ControlledOpfsWorker[] = [];
	readonly entered = deferred<void>();
	readonly release = deferred<void>();
	readonly removalEntered = deferred<void>();
	readonly removalRelease = deferred<void>();
	cut: AcquisitionCut | null = null;
	path: string | null = null;
	acquisitionFailure: Error | undefined;
	removeFailure: Error | undefined;
	#held = false;
	#removalHeld = false;

	readonly directory = {
		getFileHandle: async (path: string, options: Readonly<{ create?: boolean }> = {}) => {
			let file = this.files.get(path);
			if (!file && !options.create) throw new DOMException('Missing controlled file.', 'NotFoundError');
			if (!file) { file = new ControlledFile(); this.files.set(path, file); this.entries.set(path, file); }
			if (options.create && this.cut !== null && this.path === null) this.path = path;
			this.events.push(`file:${path}`);
			await this.pause('file', path);
			if (this.acquisitionFailure && this.cut === 'file' && path === this.path) throw this.acquisitionFailure;
			const owned = file;
			return {
				getFile: () => Promise.resolve(new Blob([new Uint8Array(owned.bytes)])),
				createSyncAccessHandle: async () => {
					owned.calls.push('access'); this.events.push(`access:${path}`);
					await this.pause('access', path);
					if (this.acquisitionFailure && this.cut === 'access' && path === this.path) throw this.acquisitionFailure;
					return {
						getSize: () => owned.bytes.byteLength,
						read: (target: ArrayBufferView, options: Readonly<{ at: number }>) => {
							const bytes = new Uint8Array(target.buffer, target.byteOffset, target.byteLength);
							bytes.set(owned.bytes.subarray(options.at, options.at + bytes.byteLength)); return bytes.byteLength;
						},
						write: (source: ArrayBufferView, options: Readonly<{ at: number }>) => {
							const bytes = new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
							if (options.at + bytes.byteLength > owned.bytes.byteLength) {
								const next = new Uint8Array(options.at + bytes.byteLength); next.set(owned.bytes); owned.bytes = next;
							}
							owned.bytes.set(bytes, options.at); owned.calls.push('write'); return bytes.byteLength;
						},
						truncate: (size: number) => { const next = new Uint8Array(size); next.set(owned.bytes.subarray(0, size)); owned.bytes = next; owned.calls.push('truncate'); },
						flush: () => { owned.calls.push('flush'); },
						close: () => { owned.calls.push('close'); },
					};
				},
			};
		},
		removeEntry: async (path: string) => {
			this.events.push(`remove-enter:${path}`);
			if (path === this.path && !this.#removalHeld) {
				this.#removalHeld = true; this.removalEntered.resolve(); await this.removalRelease.promise;
			}
			if (path === this.path && this.removeFailure) throw this.removeFailure;
			if (!this.files.delete(path)) throw new DOMException('Missing controlled file.', 'NotFoundError');
			this.events.push(`remove-ack:${path}`);
		},
	};
	readonly root = { getDirectoryHandle: (name: string) => {
		assert.equal(name, PHOTO_MEDIA_NAMESPACES_V1.opfsDirectoryName); return Promise.resolve(this.directory);
	} };

	arm(cut: AcquisitionCut): void { assert.equal(this.cut, null); this.cut = cut; }
	seed(path: string, bytes: Uint8Array): void { const file = new ControlledFile(bytes); this.files.set(path, file); this.entries.set(path, file); }
	async pause(cut: AcquisitionCut, path: string): Promise<void> {
		if (this.cut !== cut || path !== this.path || this.#held) return;
		this.#held = true; this.entered.resolve(); await this.release.promise;
	}
	createWorker(): ControlledOpfsWorker { const worker = new ControlledOpfsWorker(this); this.workers.push(worker); return worker; }
	client(timeoutMs?: number) { const worker = this.createWorker(); return { worker, client: new OpfsSyncWorkerClient({ workerFactory: () => worker, timeoutMs }) }; }
	file(): ControlledFile { assert.ok(this.path); const file = this.entries.get(this.path); assert.ok(file); return file; }
	releaseAll(): void { this.release.resolve(); this.removalRelease.resolve(); }
	async dispose(): Promise<void> {
		this.releaseAll(); this.acquisitionFailure = undefined; this.removeFailure = undefined;
		for (const worker of this.workers) await worker.drain();
		// Test cleanup is deliberately after all assertions. It cannot serve as
		// evidence that the product reclaimed an interrupted acquisition.
		for (const worker of this.workers) {
			for (const id of worker.writerIds) await worker.runtime.handle({ id: `fixture-dispose-${id}`, type: 'abort-writer', writerId: id });
		}
		for (const worker of this.workers) worker.terminate();
	}
}

export class ControlledOpfsWorker implements OpfsWorkerLike {
	readonly runtime = new OpfsSyncWorkerRuntime({ supportsSyncAccessHandles: () => true });
	readonly requests: Readonly<Record<string, unknown>>[] = [];
	readonly writerIds = new Set<string>();
	readonly deliveryErrors: unknown[] = [];
	readonly #tasks = new Set<Promise<void>>();
	readonly #listeners = new Map<string, Array<(event: MessageEvent) => void>>();
	terminated = 0;
	constructor(readonly fixture: WriterAcquisitionFixture) {}
	addEventListener(type: string, listener: (event: MessageEvent) => void): void {
		const listeners = this.#listeners.get(type) ?? []; listeners.push(listener); this.#listeners.set(type, listeners);
	}
	postMessage(value: unknown, _transfer?: readonly Transferable[]): void {
		assert.equal(this.terminated, 0, 'A retired controlled worker received new work.');
		assert.ok(value && typeof value === 'object'); const request = value as Readonly<Record<string, unknown>>;
		assert.equal(typeof request.id, 'string'); const id = request.id as string;
		this.requests.push(request); this.fixture.events.push(`post:${String(request.type)}`);
		const task = this.forward(request, id); this.#tasks.add(task);
		void task.then(() => { this.#tasks.delete(task); }, (error: unknown) => { this.deliveryErrors.push(error); this.#tasks.delete(task); });
	}
	async forward(request: Readonly<Record<string, unknown>>, id: string): Promise<void> {
		const result = await observed(this.runtime.handle(request));
		if (request.type === 'cancel') { if (!result.ok) throw result.error; return; }
		this.fixture.events.push(`terminal:${String(request.type)}`);
		if (result.ok && request.type === 'open-writer') {
			assert.equal(typeof result.value.writerId, 'string'); this.writerIds.add(result.value.writerId as string);
			assert.equal(typeof request.path, 'string'); await this.fixture.pause('open-result', request.path as string);
		}
		if (result.ok && request.type === 'close-writer' && this.fixture.path !== null) await this.fixture.pause('close-result', this.fixture.path);
		if (this.terminated > 0) { this.fixture.events.push(`dropped:${String(request.type)}`); return; }
		const response = result.ok ? { id, type: 'result', result: result.value } : { id, type: 'error', error: serializeOpfsWorkerError(result.error) };
		for (const listener of this.#listeners.get('message') ?? []) listener({ data: response } as MessageEvent);
		this.fixture.events.push(`delivered:${String(request.type)}`);
	}
	terminate(): void { if (this.terminated === 0) { this.terminated++; this.fixture.events.push('terminate'); } }
	fail(error: Error): void { for (const listener of this.#listeners.get('error') ?? []) listener({ error, message: error.message } as unknown as MessageEvent); }
	async drain(): Promise<void> { while (this.#tasks.size) await Promise.allSettled([...this.#tasks]); assert.deepEqual(this.deliveryErrors, []); }
}

export function controlledLocks(): LockManager {
	const active = new Set<string>();
	return { async request(name: string, _options: unknown, run: (lock: unknown) => Promise<unknown>) {
		if (active.has(name)) return run(null); active.add(name);
		try { return await run({ name, mode: 'exclusive' }); } finally { active.delete(name); }
	} } as unknown as LockManager;
}

export function installAcquisitionPlatform(fixture: WriterAcquisitionFixture, locks: LockManager): () => void {
	// These image ports only permit the real Node import owner to reach storage.
	// They do not establish native decode or browser pixel fidelity.
	const values = { IDBKeyRange: InstrumentedKeyRange, ImageDecoder: undefined,
		Worker: class { constructor(_url: URL, options: Readonly<{ name?: string }>) {
			assert.equal(options.name, PHOTO_MEDIA_NAMESPACES_V1.opfsWorkerName); return fixture.createWorker();
		} }, navigator: { locks, storage: { getDirectory: () => Promise.resolve(fixture.root) } },
		createImageBitmap: () => Promise.resolve({ width: 1, height: 1, close() {} }),
		OffscreenCanvas: class {
			constructor(readonly width: number, readonly height: number) {}
			getContext() { return { clearRect() {}, drawImage() {}, getImageData() { return { data: Uint8ClampedArray.of(23, 71, 149, 255) }; } }; }
		},
	};
	const saved = Object.keys(values).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
	for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, value });
	return () => { for (const [key, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); } };
}
