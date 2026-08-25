/* SPDX-License-Identifier: AGPL-3.0-only */

/** Explicit zero-network installation and reconciliation for offline model seeds. */

import { createHash } from 'node:crypto';
import { createReadStream, constants as fsConstants } from 'node:fs';
import { copyFile, lstat, rm } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';

import { LocalModelCapacity } from './local-model-capacity.ts';
import type { InstalledLocalModel, FileLocalModelStore, LocalModelArtifact } from './local-model-store.ts';

const FILE_NAME_PATTERN = /^[A-Za-z\d](?:[A-Za-z\d._-]{0,158}[A-Za-z\d])?$/u;

export interface PreseededLocalModelEntry {
	readonly modelId: string;
	readonly version: string;
	readonly artifacts: readonly LocalModelArtifact[];
}

export interface InstallPreseededLocalModelOptions {
	readonly store: FileLocalModelStore;
	readonly entry: PreseededLocalModelEntry;
	readonly sourceDirectory: string;
	readonly capacity?: LocalModelCapacity;
	readonly signal?: AbortSignal;
}

export interface RejectedPreseededLocalModel {
	readonly modelId: string;
	readonly reason: string;
}

export interface PreseededLocalModelReconciliation {
	readonly installedModelIds: readonly string[];
	readonly incompleteModelIds: readonly string[];
	readonly rejected: readonly RejectedPreseededLocalModel[];
}

interface AuthenticatedSeed {
	readonly artifact: LocalModelArtifact;
	readonly sourcePath: string;
}

const DEFAULT_CAPACITY = new LocalModelCapacity();

function errorCode(error: unknown): string | undefined {
	return typeof error === 'object' && error !== null && 'code' in error
		? String((error as { code?: unknown }).code)
		: undefined;
}

async function digestOf(path: string, signal?: AbortSignal): Promise<string> {
	const digest = createHash('sha256');
	for await (const chunk of createReadStream(path, { signal })) {
		signal?.throwIfAborted();
		digest.update(chunk as Uint8Array);
	}
	signal?.throwIfAborted();
	return digest.digest('hex');
}

function validateEntry(store: FileLocalModelStore, entry: PreseededLocalModelEntry): void {
	store.manifestPath(entry.modelId);
	if (typeof entry.version !== 'string' || entry.version.trim() === '' || entry.version.length > 64) {
		throw new TypeError('A pre-seeded local model needs a short non-empty version.');
	}
	if (!Array.isArray(entry.artifacts) || entry.artifacts.length === 0) {
		throw new RangeError('A pre-seeded local model needs at least one artifact.');
	}
	const names = new Set<string>();
	for (const artifact of entry.artifacts) {
		if (typeof artifact.fileName !== 'string' || !FILE_NAME_PATTERN.test(artifact.fileName)) {
			throw new TypeError('A pre-seeded artifact needs a plain relative file name.');
		}
		if (names.has(artifact.fileName)) throw new Error('A pre-seeded model repeats an artifact file name.');
		names.add(artifact.fileName);
		if (!Number.isSafeInteger(artifact.byteLength) || artifact.byteLength <= 0) {
			throw new RangeError('A pre-seeded artifact byte length is invalid.');
		}
		store.blobPath(artifact.sha256);
	}
}

async function publishedPathExists(store: FileLocalModelStore, artifact: LocalModelArtifact): Promise<boolean> {
	try {
		await lstat(store.blobPath(artifact.sha256));
		return true;
	} catch (error) {
		if (errorCode(error) === 'ENOENT') return false;
		throw error;
	}
}

async function authenticateSource(
	path: string,
	artifact: LocalModelArtifact,
	signal?: AbortSignal,
): Promise<void> {
	signal?.throwIfAborted();
	const metadata = await lstat(path);
	signal?.throwIfAborted();
	if (!metadata.isFile() || metadata.isSymbolicLink()) {
		throw new Error(`Seed artifact ${artifact.fileName} must be a regular non-symbolic file.`);
	}
	if (metadata.size !== artifact.byteLength) {
		throw new RangeError(`Seed artifact ${artifact.fileName} does not match its recorded byte length.`);
	}
	if (await digestOf(path, signal) !== artifact.sha256) {
		throw new Error(`Seed artifact ${artifact.fileName} does not match its recorded digest.`);
	}
}

/**
 * Imports one user-selected seed directory. All source bodies are authenticated
 * before capacity admission and before the first destination copy. There is no
 * network dependency or fallback in this path.
 */
export async function installPreseededLocalModel(
	options: InstallPreseededLocalModelOptions,
): Promise<InstalledLocalModel> {
	const { store, entry } = options;
	const { signal } = options;
	validateEntry(store, entry);
	signal?.throwIfAborted();
	if (typeof options.sourceDirectory !== 'string' || !isAbsolute(options.sourceDirectory)) {
		throw new TypeError('A pre-seeded local-model source directory must be absolute.');
	}
	const sourceDirectory = resolve(options.sourceDirectory);
	await store.initialize();
	signal?.throwIfAborted();
	const missing = new Map<string, AuthenticatedSeed>();
	for (const artifact of entry.artifacts) {
		signal?.throwIfAborted();
		if (missing.has(artifact.sha256)) continue;
		if (await publishedPathExists(store, artifact)) {
			if (!await store.verifyArtifact(artifact)) {
				throw new Error(`Published artifact ${artifact.fileName} failed its integrity check.`);
			}
			continue;
		}
		const sourcePath = join(sourceDirectory, artifact.fileName);
		await authenticateSource(sourcePath, artifact, signal);
		missing.set(artifact.sha256, Object.freeze({ artifact, sourcePath }));
	}
	const copyBytes = [...missing.values()].reduce((total, { artifact }) => {
		const next = total + artifact.byteLength;
		if (!Number.isSafeInteger(next)) throw new RangeError('A pre-seeded install exceeds the safe byte domain.');
		return next;
	}, 0);
	signal?.throwIfAborted();
	const reservation = await (options.capacity ?? DEFAULT_CAPACITY).reserve(store.rootPath, copyBytes);
	try {
		for (const { artifact, sourcePath } of missing.values()) {
			signal?.throwIfAborted();
			const stagedPath = await store.stagingPath();
			try {
				await copyFile(sourcePath, stagedPath, fsConstants.COPYFILE_EXCL);
				signal?.throwIfAborted();
				reservation.consume(artifact.byteLength);
				await store.publishBlob(stagedPath, artifact);
			} catch (error) {
				await rm(stagedPath, { force: true }).catch(() => undefined);
				throw error;
			}
		}
		signal?.throwIfAborted();
		return store.commitInstall(entry);
	} finally {
		reservation.release();
	}
}

/**
 * Discovers exact catalog artifacts that were copied directly into `blobs/`.
 * Complete sets gain manifests; missing sets remain untouched and corrupt sets
 * are reported. Nothing is downloaded, copied, deleted, or silently repaired.
 */
export async function reconcilePreseededLocalModels(
	store: FileLocalModelStore,
	entries: readonly PreseededLocalModelEntry[],
): Promise<PreseededLocalModelReconciliation> {
	await store.initialize();
	const installedModelIds: string[] = [];
	const incompleteModelIds: string[] = [];
	const rejected: RejectedPreseededLocalModel[] = [];
	for (const entry of [...entries].sort((left, right) => left.modelId.localeCompare(right.modelId))) {
		try {
			validateEntry(store, entry);
			let incomplete = false;
			const seen = new Set<string>();
			for (const artifact of entry.artifacts) {
				if (seen.has(artifact.sha256)) continue;
				seen.add(artifact.sha256);
				if (!await publishedPathExists(store, artifact)) {
					incomplete = true;
					continue;
				}
				if (!await store.verifyArtifact(artifact)) {
					throw new Error(`Published artifact ${artifact.fileName} failed its integrity check.`);
				}
			}
			if (incomplete) {
				incompleteModelIds.push(entry.modelId);
				continue;
			}
			await store.commitInstall(entry);
			installedModelIds.push(entry.modelId);
		} catch (error) {
			rejected.push(Object.freeze({
				modelId: entry.modelId,
				reason: error instanceof Error ? error.message : 'The pre-seeded model was rejected.',
			}));
		}
	}
	return Object.freeze({
		installedModelIds: Object.freeze(installedModelIds),
		incompleteModelIds: Object.freeze(incompleteModelIds),
		rejected: Object.freeze(rejected),
	});
}
