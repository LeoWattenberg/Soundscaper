/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The checksum manifest of a written Scape archive.
 *
 * The archive already carries its own manifest, written as the assets streamed
 * out. This is a different document with a different job: it is built by
 * reading the finished file back and digesting what is actually in it, so a
 * user can verify an archive later — after a copy, a transfer, or a year on a
 * disk — against something that was never merely copied from the writer's own
 * account of itself.
 *
 * That distinction is why nothing here reuses the export manifest's digests.
 * Repeating them would produce a document that agrees with the writer by
 * construction and would therefore detect nothing the writer got wrong. The
 * digests are recomputed from the archive's bytes, which is also what makes
 * this the end-to-end half of "written, then read back".
 *
 * Members are digested as they stream. A reference-scale archive member does
 * not fit in memory, and a manifest that could only be built for small archives
 * would be missing at exactly the scale it matters.
 */

import {
	compareArchiveManifests,
	createArchiveManifestFromStreams,
	type ArchiveManifest,
	type ArchiveManifestContext,
	type ArchiveVerification,
} from './archive-manifest.ts';
import type { ScapeArchiveEntry } from './scape-archive-envelope.ts';
import { withScapeArchiveReader, type ScapeArchiveReaderFactory } from './scape-archive-reader.ts';

export interface ScapeArchiveManifestOptions extends ArchiveManifestContext {
	readonly signal?: AbortSignal;
	/** Injected so a test can supply entries without a real Zip reader. */
	readonly createReader?: ScapeArchiveReaderFactory;
}

/** Digest every member of a written archive and record what was found. */
export async function createScapeArchiveManifest(
	archive: Blob,
	options: ScapeArchiveManifestOptions = {},
): Promise<ArchiveManifest> {
	const context: ArchiveManifestContext = {
		...(options.generatedAt === undefined ? {} : { generatedAt: options.generatedAt }),
		...(options.projectTitle === undefined ? {} : { projectTitle: options.projectTitle }),
	};
	return readArchive(archive, options, async (entries) => createArchiveManifestFromStreams(
		memberStreams(entries, options.signal),
		context,
	));
}

/**
 * Check an archive against a manifest, member by member.
 *
 * Every member is checked even after one fails, and a member the archive
 * carries but the manifest does not list is reported too: an unlisted member
 * means the two disagree about what the archive is, which is not harmless.
 */
export async function verifyScapeArchiveManifest(
	archive: Blob,
	manifest: ArchiveManifest,
	options: ScapeArchiveManifestOptions = {},
): Promise<ArchiveVerification> {
	// The archive is read once, into an observed manifest, and the comparison is
	// against what that measured. Reading every member a second time to check it
	// would double the cost of a reference-scale verification to prove the same
	// thing.
	return compareArchiveManifests(manifest, await createScapeArchiveManifest(archive, options));
}

async function readArchive<Value>(
	archive: Blob,
	options: ScapeArchiveManifestOptions,
	action: (entries: readonly ScapeArchiveEntry[]) => Promise<Value>,
): Promise<Value> {
	return options.createReader
		? withScapeArchiveReader(archive, options.signal, action, options.createReader)
		: withScapeArchiveReader(archive, options.signal, action);
}

async function* memberStreams(
	entries: readonly ScapeArchiveEntry[],
	signal: AbortSignal | undefined,
) {
	for (const entry of entries) {
		if (entry.directory) continue;
		const filename = String(entry.filename ?? '');
		if (!filename) throw new TypeError('A Scape archive entry has no name to record.');
		yield {
			id: filename,
			path: filename,
			chunks: entryChunks(entry, signal),
		};
	}
}

async function* entryChunks(
	entry: ScapeArchiveEntry,
	signal: AbortSignal | undefined,
): AsyncGenerator<Uint8Array> {
	if (typeof entry.getData !== 'function') {
		throw new TypeError(`Scape archive entry ${entry.filename} cannot be read.`);
	}
	const pending: Uint8Array[] = [];
	let notify: (() => void) | null = null;
	let done = false;
	let failure: unknown = null;
	const writable = new WritableStream<Uint8Array>({
		write(chunk) {
			pending.push(chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk as ArrayBuffer));
			notify?.();
		},
		close() { done = true; notify?.(); },
		abort(reason: unknown) { failure = reason; done = true; notify?.(); },
	});
	const reading = Promise.resolve(entry.getData(writable, signal ? { signal } : undefined))
		.then(() => { done = true; notify?.(); }, (error: unknown) => {
			failure ??= error;
			done = true;
			notify?.();
		});
	try {
		while (true) {
			while (pending.length > 0) yield pending.shift()!;
			if (failure) throw failure;
			if (done) break;
			await new Promise<void>((resolve) => { notify = resolve; });
			notify = null;
		}
		while (pending.length > 0) yield pending.shift()!;
		if (failure) throw failure;
	} finally {
		await reading;
	}
}
