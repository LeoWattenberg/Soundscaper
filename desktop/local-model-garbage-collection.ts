/* SPDX-License-Identifier: AGPL-3.0-only */

/** Explicit cleanup and external-deletion reconciliation for the model store. */

import { lstat, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

import type { FileLocalModelStore, LocalModelArtifact } from './local-model-store.ts';

const MODEL_ID_PATTERN = /^[a-z\d][a-z\d.-]{0,62}[a-z\d]$/u;
const PARTIAL_NAME_PATTERN = /^sha256-([a-f\d]{64})\.part$/u;

export interface LocalModelGarbageCollectionOptions {
	readonly store: FileLocalModelStore;
	/** Exact artifacts in the authenticated current catalog. */
	readonly offeredArtifacts: readonly LocalModelArtifact[];
}

export interface LocalModelGarbageCollectionReport {
	readonly reclaimedBlobBytes: number;
	readonly discardedManifestCount: number;
	readonly discardedPartialCount: number;
	readonly discardedPartialBytes: number;
	readonly reclaimedBytes: number;
}

function errorCode(error: unknown): string | undefined {
	return typeof error === 'object' && error !== null && 'code' in error
		? String((error as { code?: unknown }).code)
		: undefined;
}

async function discardDamagedManifests(store: FileLocalModelStore): Promise<number> {
	const directory = join(store.rootPath, 'manifests');
	let entries;
	try {
		entries = await readdir(directory, { withFileTypes: true });
	} catch (error) {
		if (errorCode(error) === 'ENOENT') return 0;
		throw error;
	}
	let discarded = 0;
	for (const entry of entries) {
		const path = join(directory, entry.name);
		const modelId = entry.name.endsWith('.json') ? entry.name.slice(0, -5) : '';
		let authenticated = entry.isFile() && !entry.isSymbolicLink() && MODEL_ID_PATTERN.test(modelId);
		if (authenticated) {
			try {
				const manifest = await store.readManifest(modelId);
				authenticated = manifest !== null && manifest.modelId === modelId;
				for (const artifact of manifest?.artifacts ?? []) {
					if (!await store.verifyArtifact(artifact)) authenticated = false;
				}
			} catch {
				authenticated = false;
			}
		}
		if (authenticated) continue;
		await rm(path, { recursive: entry.isDirectory(), force: true });
		discarded += 1;
	}
	return discarded;
}

function offeredByDigest(
	store: FileLocalModelStore,
	artifacts: readonly LocalModelArtifact[],
): ReadonlyMap<string, LocalModelArtifact> {
	const offered = new Map<string, LocalModelArtifact>();
	for (const artifact of artifacts) {
		store.blobPath(artifact.sha256);
		if (!Number.isSafeInteger(artifact.byteLength) || artifact.byteLength <= 0) {
			throw new RangeError('An offered local-model artifact byte length is invalid.');
		}
		const previous = offered.get(artifact.sha256);
		if (previous && previous.byteLength !== artifact.byteLength) {
			throw new Error('One offered local-model digest has conflicting byte lengths.');
		}
		offered.set(artifact.sha256, artifact);
	}
	return offered;
}

async function discardNonResumablePartials(
	store: FileLocalModelStore,
	offered: ReadonlyMap<string, LocalModelArtifact>,
): Promise<Readonly<{ count: number; bytes: number }>> {
	const directory = join(store.rootPath, 'staging');
	let entries;
	try {
		entries = await readdir(directory, { withFileTypes: true });
	} catch (error) {
		if (errorCode(error) === 'ENOENT') return Object.freeze({ count: 0, bytes: 0 });
		throw error;
	}
	let count = 0;
	let bytes = 0;
	for (const entry of entries) {
		const path = join(directory, entry.name);
		const match = PARTIAL_NAME_PATTERN.exec(entry.name);
		const expected = match ? offered.get(match[1] as string) : undefined;
		let metadata = null;
		try {
			metadata = await lstat(path);
		} catch (error) {
			if (errorCode(error) === 'ENOENT') continue;
			throw error;
		}
		const published = expected ? await store.verifyArtifact(expected) : false;
		const resumable = expected !== undefined
			&& metadata.isFile()
			&& !metadata.isSymbolicLink()
			&& metadata.size > 0
			&& metadata.size < expected.byteLength
			&& !published;
		if (resumable) continue;
		await rm(path, { recursive: metadata.isDirectory(), force: true });
		count += 1;
		if (metadata.isFile() && !metadata.isSymbolicLink()) bytes += metadata.size;
	}
	return Object.freeze({ count, bytes });
}

/** Runs only after an explicit caller action; ordinary status never deletes. */
export async function collectLocalModelGarbage(
	options: LocalModelGarbageCollectionOptions,
): Promise<LocalModelGarbageCollectionReport> {
	const offered = offeredByDigest(options.store, options.offeredArtifacts);
	await options.store.initialize();
	const discardedManifestCount = await discardDamagedManifests(options.store);
	const reclaimedBlobBytes = await options.store.reclaimUnreferencedBlobs();
	const partials = await discardNonResumablePartials(options.store, offered);
	const reclaimedBytes = reclaimedBlobBytes + partials.bytes;
	if (!Number.isSafeInteger(reclaimedBytes)) {
		throw new RangeError('Local-model garbage collection exceeded the safe byte domain.');
	}
	return Object.freeze({
		reclaimedBlobBytes,
		discardedManifestCount,
		discardedPartialCount: partials.count,
		discardedPartialBytes: partials.bytes,
		reclaimedBytes,
	});
}
