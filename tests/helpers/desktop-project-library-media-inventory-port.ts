/* SPDX-License-Identifier: AGPL-3.0-only */

import { lstat, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';

import type {
	DesktopLibraryManagedMediaInventoryPort,
} from '../../desktop/project-library-media.ts';
import type {
	DesktopLibraryManagedMediaInventoryRow,
} from '../../desktop/project-library-media-inventory.ts';

interface RegisteredStage {
	readonly file: string;
	readonly kind: 'upload' | 'reuse';
}

export class TestDesktopLibraryManagedMediaInventoryPort
	implements DesktopLibraryManagedMediaInventoryPort {
	readonly #root: string;
	readonly #rows = new Map<string, DesktopLibraryManagedMediaInventoryRow>();
	readonly #stages = new Map<string, RegisteredStage>();
	#nextId = 1;

	constructor(managedMediaRoot: string) {
		this.#root = managedMediaRoot;
	}

	reserve(options: Parameters<DesktopLibraryManagedMediaInventoryPort['reserve']>[0]) {
		const existing = this.#rows.get(options.descriptor.id);
		if (existing) {
			assertSameRow(existing, options);
			if (existing.state === 'planned') {
				if (this.#stages.has(existing.bindingId)) {
					throw new Error('Test managed-media inventory has an outstanding stage');
				}
				this.#stages.set(existing.bindingId, { file: options.stageFile, kind: options.stageKind });
			}
			return existing;
		}
		const row = Object.freeze({
			inventoryId: this.#nextId++,
			bindingId: options.descriptor.id,
			relativeFile: options.descriptor.relativeFile,
			byteLength: options.descriptor.byteLength,
			sha256: options.descriptor.sha256,
			encoding: options.encoding,
			projectId: options.projectId,
			projectRevision: options.projectRevision,
			projectSha256: options.projectSha256,
			storageKey: options.storageKey,
			state: 'planned' as const,
			leaseId: '0'.repeat(48),
			fencingToken: 1,
			registeredAtMs: 0,
		});
		this.#rows.set(row.bindingId, row);
		this.#stages.set(row.bindingId, { file: options.stageFile, kind: options.stageKind });
		return row;
	}

	async materialize(options: Parameters<DesktopLibraryManagedMediaInventoryPort['materialize']>[0]) {
		const row = this.#requiredRow(options.descriptor.id);
		assertSameDescriptor(row, options.descriptor);
		const stage = this.#stages.get(row.bindingId);
		if (!stage || stage.file !== options.stageFile || stage.kind !== options.stageKind) {
			throw new Error('Test managed-media stage reservation is missing');
		}
		const finalPath = this.#path(row.relativeFile);
		if (await exists(finalPath)) throw new Error('Test managed-media final path already exists');
		await rename(this.#path(stage.file), finalPath);
		const materialized = Object.freeze({ ...row, state: 'materialized' as const });
		this.#rows.set(row.bindingId, materialized);
		this.#stages.delete(row.bindingId);
	}

	async discard(options: Parameters<DesktopLibraryManagedMediaInventoryPort['discard']>[0]) {
		const row = this.#rows.get(options.descriptor.id);
		const stage = row ? this.#stages.get(row.bindingId) : undefined;
		if (!row || !stage || stage.file !== options.stageFile || stage.kind !== options.stageKind) return false;
		assertSameDescriptor(row, options.descriptor);
		if (options.removeFile) {
			try { await unlink(this.#path(stage.file)); } catch (error) {
				if (!isMissing(error)) throw error;
			}
		}
		this.#stages.delete(row.bindingId);
		return true;
	}

	#requiredRow(bindingId: string): DesktopLibraryManagedMediaInventoryRow {
		const row = this.#rows.get(bindingId);
		if (!row) throw new Error('Test managed-media inventory row is missing');
		return row;
	}

	#path(relativeFile: string): string {
		return join(this.#root, ...relativeFile.split('/'));
	}
}

function assertSameRow(
	row: DesktopLibraryManagedMediaInventoryRow,
	options: Parameters<DesktopLibraryManagedMediaInventoryPort['reserve']>[0],
): void {
	assertSameDescriptor(row, options.descriptor);
	if (row.encoding !== options.encoding || row.projectId !== options.projectId
		|| row.projectRevision !== options.projectRevision
		|| row.projectSha256 !== options.projectSha256 || row.storageKey !== options.storageKey) {
		throw new Error('Test immutable managed-media inventory conflict');
	}
}

function assertSameDescriptor(
	row: DesktopLibraryManagedMediaInventoryRow,
	descriptor: Readonly<{ id: string; relativeFile: string; byteLength: number; sha256: string }>,
): void {
	if (row.bindingId !== descriptor.id || row.relativeFile !== descriptor.relativeFile
		|| row.byteLength !== descriptor.byteLength || row.sha256 !== descriptor.sha256) {
		throw new Error('Test immutable managed-media descriptor conflict');
	}
}

async function exists(path: string): Promise<boolean> {
	try {
		await lstat(path);
		return true;
	} catch (error) {
		if (isMissing(error)) return false;
		throw error;
	}
}

function isMissing(error: unknown): boolean {
	return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}
