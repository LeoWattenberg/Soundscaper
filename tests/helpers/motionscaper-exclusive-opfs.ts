/* SPDX-License-Identifier: AGPL-3.0-only */
import { OpfsSyncWorkerRuntime } from '../../src/common/editor/storage/opfs-sync-worker-runtime.ts';
import { serializeOpfsWorkerError } from '../../src/common/editor/storage/opfs-sync-worker-protocol.ts';

/** Models an OPFS host whose sync handles remain exclusive even for read-only mode. */
export function exclusiveMotionOpfs(initial: Record<string, Uint8Array> = {}) {
	const files = new Map(Object.entries(initial).map(([path, bytes]) => [path, bytes.slice()]));
	const held = new Set<string>(); const acquired: string[] = [], closed: string[] = [];
	const workers: { name: string; terminated: boolean }[] = [];
	const pauses = new Map<string, { entered: () => void; wait: Promise<void> }>();
	const failures = new Map<string, Error>();
	const requestObservers = new Set<(value: unknown) => void>();
	const directory = {
		async getFileHandle(path: string, options?: { create?: boolean }) {
			if (!files.has(path)) {
				if (!options?.create) throw new DOMException('Missing file', 'NotFoundError');
				files.set(path, new Uint8Array());
			}
			return {
				async getFile() { return new Blob([files.get(path)!.slice()]); },
				async createSyncAccessHandle(options?: { mode?: string }) {
					if (held.has(path)) throw new DOMException('No modification allowed', 'NoModificationAllowedError');
					held.add(path); acquired.push(path);
					const pause = options?.mode === 'read-only' ? pauses.get(path) : undefined;
					if (pause) { pauses.delete(path); pause.entered(); await pause.wait; }
					else await Promise.resolve();
					let released = false;
					return {
						getSize() { const failure = failures.get(path); if (failure) { failures.delete(path); throw failure; } return files.get(path)!.length; },
						read(target: ArrayBufferView, { at }: { at: number }) {
							const destination = new Uint8Array(target.buffer, target.byteOffset, target.byteLength);
							const bytes = files.get(path)!.subarray(at, at + destination.length); destination.set(bytes); return bytes.length;
						},
						write(source: ArrayBufferView, { at }: { at: number }) {
							const bytes = new Uint8Array(source.buffer, source.byteOffset, source.byteLength), previous = files.get(path)!;
							const next = new Uint8Array(Math.max(previous.length, at + bytes.length)); next.set(previous); next.set(bytes, at); files.set(path, next); return bytes.length;
						},
						truncate(size: number) { files.set(path, files.get(path)!.slice(0, size)); },
						flush() { /* Bytes already belong to this test's durable directory. */ },
						close() { if (released) throw new Error('Handle closed twice'); released = true; held.delete(path); closed.push(path); },
					};
				},
			};
		},
		async removeEntry(path: string) { if (!files.delete(path)) throw new DOMException('Missing file', 'NotFoundError'); },
		async *entries() { for (const path of files.keys()) yield [path, { kind: 'file' }]; },
	} as unknown as FileSystemDirectoryHandle;
	const root = { async getDirectoryHandle() { return directory; } } as unknown as FileSystemDirectoryHandle;
	class Worker {
		readonly runtime = new OpfsSyncWorkerRuntime({ supportsSyncAccessHandles: () => true });
		readonly listeners = new Map<string, Set<(event: MessageEvent) => void>>();
		readonly state: { name: string; terminated: boolean };
		constructor(_url: unknown, options: { name: string }) { this.state = { name: options.name, terminated: false }; workers.push(this.state); }
		addEventListener(type: string, listener: (event: MessageEvent) => void) { const values = this.listeners.get(type) ?? new Set(); values.add(listener); this.listeners.set(type, values); }
		postMessage(value: { id: string; type: string }) {
			const operation = this.runtime.handle(value);
			for (const observe of requestObservers) observe(value);
			void operation.then(
				result => { if (value.type !== 'cancel') this.deliver({ id: value.id, type: 'result', result }); },
				error => this.deliver({ id: value.id, type: 'error', error: serializeOpfsWorkerError(error) }),
			);
		}
		deliver(data: unknown) { if (!this.state.terminated) for (const listener of this.listeners.get('message') ?? []) listener({ data } as MessageEvent); }
		terminate() { this.state.terminated = true; }
	}
	return {
		root, directory, files, held, acquired, closed, workers, failures,
		nextSnapshot(path: string) {
			return new Promise<void>(resolve => {
				const observe = (value: unknown) => {
					if (value && typeof value === 'object' && Reflect.get(value, 'type') === 'snapshot' && Reflect.get(value, 'path') === path) { requestObservers.delete(observe); resolve(); }
				};
				requestObservers.add(observe);
			});
		},
		pause(path: string) {
			const entered = deferred(), released = deferred();
			pauses.set(path, { entered: () => entered.resolve(), wait: released.promise });
			return { entered: entered.promise, release: () => released.resolve() };
		},
		installWorker() {
			const previous = Object.getOwnPropertyDescriptor(globalThis, 'Worker');
			Object.defineProperty(globalThis, 'Worker', { configurable: true, writable: true, value: Worker });
			return () => { if (previous) Object.defineProperty(globalThis, 'Worker', previous); else Reflect.deleteProperty(globalThis, 'Worker'); };
		},
	};
}

function deferred() {
	let complete!: () => void;
	const promise = new Promise<void>(resolve => { complete = resolve; });
	return { promise, resolve: () => complete() };
}
