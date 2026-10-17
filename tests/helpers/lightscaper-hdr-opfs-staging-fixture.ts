/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { OpfsRepository } from '../../src/common/editor/storage/opfs-repository.ts';

/** The filesystem transport is modeled; the binary repository, native Blob
 * snapshots and scoped HDR staging owner under test are real. */
export function hdrOpfsStagingFixture() {
	const files = new Map<string, Blob>(), leases = new Set<string>(), events: string[] = [];
	const hooks: { write?: () => Promise<void>; remove?: () => Promise<void>; snapshot?: () => Promise<void> } = {};
	let closed = false;
	const directory = {
		async getFileHandle(path: string, options?: { create?: boolean }) {
			if (!files.has(path)) {
				if (!options?.create) throw new DOMException('Absent', 'NotFoundError');
				assert.ok(leases.has(path), 'Existing temporary-file lease must precede creation.');
				files.set(path, new Blob()); events.push(`create:${path}`);
			}
			return {
				async createWritable() {
					const chunks: Uint8Array<ArrayBuffer>[] = []; let retired = false;
					return {
						async write(value: ArrayBuffer) {
							assert.equal(retired, false); events.push('write:entered'); await hooks.write?.();
							chunks.push(new Uint8Array(value).slice()); events.push('write:joined');
						},
						async close() { assert.equal(retired, false); retired = true; files.set(path, new Blob(chunks)); events.push('writer:closed'); },
						async abort() { retired = true; chunks.length = 0; events.push('writer:aborted'); },
					};
				},
				async getFile() { await hooks.snapshot?.(); const file = files.get(path); if (!file) throw new DOMException('Absent', 'NotFoundError'); return file; },
			};
		},
		async removeEntry(path: string) {
			assert.ok(leases.has(path), 'Deletion must finish before releasing the existing file lease.');
			await hooks.remove?.(); if (!files.delete(path)) throw new DOMException('Absent', 'NotFoundError'); events.push(`delete:${path}`);
		},
	};
	const root = { async getDirectoryHandle(name: string) { assert.equal(name, 'audio-editor-exports'); return directory; } };
	const repository = new OpfsRepository({ preferOpfs: true, opfsRoot: root as unknown as FileSystemDirectoryHandle,
		opfsDirectoryName: 'audio-editor-exports', syncWorkerClient: null });
	const backend = {
		async ready() { return Boolean(await repository.directory()); },
		planBinaryWriter: repository.planBinaryWriter.bind(repository),
		async read(path: string): Promise<unknown> { return repository.loadBinaryRecord({ storage: 'opfs', path }, 'HDR staging file is missing.'); },
		deletePathExact: repository.deletePathExact.bind(repository),
		close() { repository.close(); closed = true; events.push('repository:closed'); },
	};
	async function acquireLease(path: string) {
		assert.equal(files.has(path), false); assert.equal(leases.has(path), false); leases.add(path); events.push(`lease:${path}`);
		return async () => { assert.ok(leases.delete(path)); events.push(`release:${path}`); };
	}
	return { files, leases, events, hooks, backend, acquireLease, get closed() { return closed; } };
}
