/* SPDX-License-Identifier: AGPL-3.0-only */

/** Determines the exact prospective bytes an explicit model install may write. */

import { lstat } from 'node:fs/promises';

import type { FileLocalModelStore, LocalModelArtifact } from './local-model-store.ts';

export interface LocalModelArtifactTransferPlan {
	readonly artifact: LocalModelArtifact;
	readonly resumedFromBytes: number;
	readonly transferBytes: number;
}

export interface LocalModelTransferPlan {
	readonly artifacts: readonly LocalModelArtifactTransferPlan[];
	readonly totalBytes: number;
}

function errorCode(error: unknown): string | undefined {
	return typeof error === 'object' && error !== null && 'code' in error
		? String((error as { code?: unknown }).code)
		: undefined;
}

async function existingPublishedPath(store: FileLocalModelStore, sha256: string): Promise<boolean> {
	try {
		await lstat(store.blobPath(sha256));
		return true;
	} catch (error) {
		if (errorCode(error) === 'ENOENT') return false;
		throw error;
	}
}

async function resumableBytes(store: FileLocalModelStore, artifact: LocalModelArtifact): Promise<number> {
	const path = await store.partialPath(artifact.sha256);
	try {
		const metadata = await lstat(path);
		if (!metadata.isFile() || metadata.isSymbolicLink()) {
			throw new Error('A local model partial must be a regular non-symbolic file.');
		}
		return metadata.size > 0 && metadata.size < artifact.byteLength ? metadata.size : 0;
	} catch (error) {
		if (errorCode(error) === 'ENOENT') return 0;
		throw error;
	}
}

/**
 * Authenticates any published entry before declaring it reusable. Partials are
 * only length hints: their digest remains a publication-time hard gate.
 */
export async function planLocalModelTransfers(
	store: FileLocalModelStore,
	artifacts: readonly LocalModelArtifact[],
): Promise<LocalModelTransferPlan> {
	const seen = new Set<string>();
	const planned: LocalModelArtifactTransferPlan[] = [];
	let totalBytes = 0;
	for (const artifact of artifacts) {
		if (seen.has(artifact.sha256)) continue;
		seen.add(artifact.sha256);
		if (await existingPublishedPath(store, artifact.sha256)) {
			if (!await store.verifyArtifact(artifact)) {
				throw new Error('A published artifact failed its integrity check for this local model.');
			}
			planned.push(Object.freeze({ artifact, resumedFromBytes: artifact.byteLength, transferBytes: 0 }));
			continue;
		}
		const resumedFromBytes = await resumableBytes(store, artifact);
		const transferBytes = artifact.byteLength - resumedFromBytes;
		if (!Number.isSafeInteger(transferBytes) || !Number.isSafeInteger(totalBytes + transferBytes)) {
			throw new RangeError('A local-model transfer plan exceeds the safe byte domain.');
		}
		totalBytes += transferBytes;
		planned.push(Object.freeze({ artifact, resumedFromBytes, transferBytes }));
	}
	return Object.freeze({ artifacts: Object.freeze(planned), totalBytes });
}
