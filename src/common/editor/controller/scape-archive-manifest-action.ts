/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The checksum manifest of the Scape archive this session just wrote.
 *
 * It is built by reading the written archive back and digesting what is in it,
 * never by copying the digests the writer computed on the way out. A manifest
 * that repeats the writer's own numbers agrees with the writer by construction
 * and would certify an archive the writer got wrong.
 *
 * That is also why a streamed save produces no manifest. When the archive goes
 * straight to its destination there are no bytes left to read back, and the
 * honest answer is to say the archive was never held rather than to publish a
 * manifest of something else — the same distinction the delivery conformance
 * path already draws between "we did not check" and "we checked and it passed".
 */

import {
	parseArchiveManifest,
	saveArchiveManifest,
	type ArchiveManifest,
	type ArchiveVerification,
} from '../archive-manifest.ts';

export interface ScapeArchiveManifestRuntime {
	/** Session state; the manifest is recorded on it like the delivery report. */
	readonly state: object;
	readonly fileService?: { saveFile?: (request: never) => unknown } | null;
	readonly publishDocumentSnapshot?: () => void;
}

export interface ArchiveManifestSessionRecord {
	readonly manifest: ArchiveManifest | null;
	/** Why no manifest exists, when none does. */
	readonly unavailable: string | null;
	readonly fileName: string;
}

/** Record the manifest of a saved archive, or why one could not be made. */
export async function recordScapeArchiveManifest(
	runtime: ScapeArchiveManifestRuntime,
	request: Readonly<{
		archive: Blob | null | undefined;
		fileName: string;
		projectTitle?: string | null;
		generatedAt?: string | null;
		signal?: AbortSignal;
	}>,
): Promise<ArchiveManifestSessionRecord> {
	const record = await manifestRecord(request);
	(runtime.state as Record<string, unknown>).archiveManifest = record;
	runtime.publishDocumentSnapshot?.();
	return record;
}

async function manifestRecord(
	request: Readonly<{
		archive: Blob | null | undefined;
		fileName: string;
		projectTitle?: string | null;
		generatedAt?: string | null;
		signal?: AbortSignal;
	}>,
): Promise<ArchiveManifestSessionRecord> {
	if (!(request.archive instanceof Blob)) {
		return Object.freeze({
			manifest: null,
			unavailable: 'The archive was streamed straight to its destination and never held as readable bytes.',
			fileName: request.fileName,
		});
	}
	try {
		const { createScapeArchiveManifest } = await import('../scape-archive-manifest.ts');
		return Object.freeze({
			manifest: await createScapeArchiveManifest(request.archive, {
				...(request.projectTitle ? { projectTitle: request.projectTitle } : {}),
				...(request.generatedAt ? { generatedAt: request.generatedAt } : {}),
				...(request.signal ? { signal: request.signal } : {}),
			}),
			unavailable: null,
			fileName: request.fileName,
		});
	} catch (error) {
		// The archive is written and saved by the time this runs. Evidence about
		// it that could not be gathered is a missing manifest with its reason
		// recorded, never a failed save of a file that is already on disk.
		return Object.freeze({
			manifest: null,
			unavailable: `The written archive could not be read back: ${errorText(error)}`,
			fileName: request.fileName,
		});
	}
}

function errorText(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/** Save the recorded manifest as a report document. */
export async function saveCurrentScapeArchiveManifest(
	runtime: ScapeArchiveManifestRuntime,
): Promise<Readonly<{ saved: boolean; reason: string | null }>> {
	const record = (runtime.state as Record<string, unknown>)
		.archiveManifest as ArchiveManifestSessionRecord | undefined;
	if (!record?.manifest) {
		return Object.freeze({ saved: false, reason: record?.unavailable ?? 'No archive has been written yet.' });
	}
	await saveArchiveManifest(
		record.manifest,
		runtime.fileService as Parameters<typeof saveArchiveManifest>[1],
	);
	return Object.freeze({ saved: true, reason: null });
}

/**
 * Check an archive against a manifest document.
 *
 * The manifest is parsed rather than trusted: a document that is not one is a
 * refusal, because verifying against a manifest nobody can read would report a
 * clean archive for the wrong reason.
 */
export async function verifyScapeArchiveAgainstManifest(
	archive: Blob,
	manifestText: string,
	options: Readonly<{ signal?: AbortSignal }> = {},
): Promise<ArchiveVerification> {
	const { verifyScapeArchiveManifest } = await import('../scape-archive-manifest.ts');
	return verifyScapeArchiveManifest(archive, parseArchiveManifest(manifestText), options);
}
