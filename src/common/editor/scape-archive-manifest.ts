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
	createArchiveManifestFromStreams,
	type ArchiveManifest,
	type ArchiveManifestContext,
} from './archive-manifest.ts';
import type { ScapeArchiveEntry } from './scape-archive-envelope.ts';
import { withScapeArchiveReader } from './scape-archive-reader.ts';

export interface ScapeArchiveManifestOptions {
	readonly signal: AbortSignal;
	readonly projectTitle?: string | null;
}

/** Digest every member of a written archive and record what was found. */
export async function createScapeArchiveManifest(
	archive: Blob,
	options: ScapeArchiveManifestOptions,
): Promise<ArchiveManifest> {
	const context: ArchiveManifestContext = {
		...(options.projectTitle === undefined ? {} : { projectTitle: options.projectTitle }),
	};
	return withScapeArchiveReader(archive, options.signal, async (entries) => createArchiveManifestFromStreams(
		memberStreams(entries, options.signal),
		context,
	));
}

async function* memberStreams(
	entries: readonly ScapeArchiveEntry[],
	signal: AbortSignal,
) {
	for (const entry of entries) {
		if (entry.directory) continue;
		const { filename } = entry;
		yield {
			id: filename,
			path: filename,
			chunks: entryChunks(entry, signal),
		};
	}
}

async function* entryChunks(
	entry: ScapeArchiveEntry,
	signal: AbortSignal,
): AsyncGenerator<Uint8Array> {
	const pending: Uint8Array[] = [];
	let notify: (() => void) | null = null;
	let done = false;
	let failure: unknown = null;
	const writable = new WritableStream<Uint8Array>({
		write(chunk) {
			pending.push(chunk);
			notify?.();
		},
		close() { done = true; notify?.(); },
		abort(reason: unknown) { failure = reason; done = true; notify?.(); },
	});
	const reading = Promise.resolve(entry.getData!(writable, { signal }))
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
