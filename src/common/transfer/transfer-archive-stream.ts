/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Turning this origin's stored projects into `.scape` archives, one at a time.
 *
 * `exportProjectTransferBundle()` is an async generator for a reason: a project
 * library can be tens of gigabytes, and the only way a browser tab survives
 * exporting one is to never hold more of it than the archive currently in
 * flight. A consumer that drains that generator into an array throws the whole
 * design away, so this module is the single export path and it stays a stream
 * all the way to whichever transport is consuming it.
 *
 * It also owns the two ceilings that bound a transfer's memory: the per-archive
 * one the protocol already enforces, and the aggregate one that exists because
 * the handshake offer cannot be streamed (see `transfer-session.ts`).
 *
 * Nothing here touches the DOM, the network, or a global. Both the archive
 * functions and the store arrive injected.
 */

import type * as Bundle from './project-transfer-bundle.ts';
import type * as Handshake from './project-transfer-handshake.ts';

/**
 * Mirrors `PROJECT_TRANSFER_MAX_ENTRY_BYTES` in the handshake module.
 *
 * Duplicated as a plain number on purpose: importing the constant would make
 * the handshake a static dependency of every transfer page, including the
 * download-only path that never opens a popup.
 * `tests/project-transfer-page-session.test.ts` asserts the two stay equal.
 */
export const TRANSFER_MAX_ARCHIVE_BYTES = 256 * 1024 * 1024;

/**
 * The most one transfer will hold in memory at once.
 *
 * The per-entry ceiling above bounds one archive and the protocol's own
 * `PROJECT_TRANSFER_MAX_ENTRIES` bounds the count, but their product is 128 GB -
 * no bound at all for a browser tab. This is the aggregate the streaming export
 * is measured against, and it exists because `sendProjectTransfer()` admits its
 * whole offer up front: every archive of a handshake transfer is resident from
 * the moment the offer is built until the last acknowledgement arrives.
 *
 * A gibibyte is far above any plausible project library and far below what a
 * tab can be expected to survive. Past it the visitor is told to send fewer
 * projects or to use the download - which streams, and so has no such ceiling -
 * and both are one interaction away.
 */
export const TRANSFER_MAX_TOTAL_BYTES = 1024 * 1024 * 1024;

/** The aggregate ceiling refusing a transfer that would not fit in memory. */
export class TransferBudgetError extends Error {
	readonly code = 'transfer-budget-exceeded';
	readonly byteLength: number;
	readonly maximumTotalBytes: number;

	constructor(byteLength: number, maximumTotalBytes: number) {
		super(
			`This transfer would hold ${byteLength} bytes of archives at once, over the`
			+ ` ${maximumTotalBytes} byte limit for one transfer. Send fewer projects at a time,`
			+ ' or download the archives instead.',
		);
		this.name = 'TransferBudgetError';
		this.byteLength = byteLength;
		this.maximumTotalBytes = maximumTotalBytes;
	}
}

export interface TransferRuntime {
	readonly exportProject: Bundle.ProjectTransferArchiveExport;
	readonly inspectProject: Bundle.ProjectTransferArchiveInspect;
	readonly importProject: Bundle.ProjectTransferArchiveImport;
	readonly exportBundle: typeof Bundle.exportProjectTransferBundle;
	readonly importBundle: typeof Bundle.importProjectTransferBundle;
	readonly sendTransfer: typeof Handshake.sendProjectTransfer;
	readonly receiveTransfer: typeof Handshake.receiveProjectTransfer;
}

export interface TransferExportFailure {
	readonly projectId: string;
	readonly title: string | null;
	readonly code: string | null;
	readonly reason: string;
}

export type TransferStreamEvent =
	| Readonly<{ kind: 'entry'; entry: Bundle.ProjectTransferEntry; index: number; total: number }>
	| Readonly<{ kind: 'failed'; failure: TransferExportFailure; index: number; total: number }>
	| Readonly<{ kind: 'summary'; total: number; exported: number; failed: number; byteLength: number }>;

export interface TransferCollection {
	/** One archive per project that exported cleanly, in listing order. */
	readonly entries: readonly Bundle.ProjectTransferEntry[];
	/** Projects the archive layer refused; the run continued past each one. */
	readonly failures: readonly TransferExportFailure[];
	/** How many projects were selected, whether or not they exported. */
	readonly total: number;
	/** Total size of `entries`, which is what the aggregate cap measures. */
	readonly byteLength: number;
}

export interface CollectTransferArchivesOptions {
	readonly runtime: TransferRuntime;
	readonly store: Bundle.ProjectTransferExportStore;
	/**
	 * Which projects to export. **Always pass this from a page.** Both products
	 * share one origin's store, so omitting it exports every project the visitor
	 * has, including the ones belonging to the product that is not moving.
	 */
	readonly select?: (project: Bundle.ProjectTransferProject) => boolean;
	readonly maximumEntries?: number;
	readonly maximumEntryBytes?: number;
	/** Aggregate ceiling for the whole run; defaults to `TRANSFER_MAX_TOTAL_BYTES`. */
	readonly maximumTotalBytes?: number;
	readonly signal?: AbortSignal;
	readonly onProgress?: (progress: Bundle.ProjectTransferProgress) => void;
}

/**
 * Read the selected projects out of this origin's store, one `.scape` at a
 * time, handing each archive to the caller before the next export begins.
 *
 * Structural refusals (too many projects, an oversized archive, a store that
 * lists a project with no id) propagate and stop the run; a single archive the
 * export layer rejects becomes one `failed` event and the rest still cross.
 * That asymmetry is the bundle module's, and it is the right one for a page
 * whose job is to rescue as much as it can.
 */
export async function* streamTransferArchives(
	options: CollectTransferArchivesOptions,
): AsyncGenerator<TransferStreamEvent, void> {
	const { runtime, store } = requireTransferRuntime(options, 'streaming transfer archives');
	const maximumTotalBytes = admitTotalByteCeiling(options.maximumTotalBytes);
	let total = 0;
	let exported = 0;
	let failed = 0;
	let byteLength = 0;
	let summarized = false;
	const events = runtime.exportBundle({
		store,
		exportProject: runtime.exportProject,
		select: options.select,
		maximumEntries: options.maximumEntries,
		maximumEntryBytes: options.maximumEntryBytes ?? TRANSFER_MAX_ARCHIVE_BYTES,
		signal: options.signal,
		onProgress: options.onProgress,
	});
	for await (const event of events) {
		if (event.kind === 'entry') {
			total = event.total;
			byteLength += event.entry.byteLength;
			// Checked before the archive is yielded: past the ceiling the caller
			// must not receive it, because receiving it is what makes it resident.
			if (byteLength > maximumTotalBytes) throw new TransferBudgetError(byteLength, maximumTotalBytes);
			exported += 1;
			yield Object.freeze({ kind: 'entry' as const, entry: event.entry, index: event.index, total });
			continue;
		}
		if (event.kind === 'failed') {
			total = event.total;
			failed += 1;
			yield Object.freeze({
				kind: 'failed' as const,
				index: event.index,
				total,
				failure: Object.freeze({
					projectId: event.projectId,
					title: event.title,
					code: event.code,
					reason: event.reason,
				}),
			});
			continue;
		}
		total = event.total;
		summarized = true;
		if (event.exported !== exported || event.failed !== failed) {
			throw new Error(
				`The transfer export summary claims ${event.exported} exported and ${event.failed} failed,`
				+ ` but ${exported} archives and ${failed} failures were reported.`,
			);
		}
	}
	if (!summarized) throw new Error('The transfer export ended without a summary.');
	yield Object.freeze({ kind: 'summary' as const, total, exported, failed, byteLength });
}

/**
 * Drain the stream into one resident collection.
 *
 * For the callers that genuinely need every archive addressable at once. Neither
 * transport uses it: a page that calls this on a whole library pays for the
 * whole library, which is exactly what the stream exists to avoid.
 */
export async function collectTransferArchives(
	options: CollectTransferArchivesOptions,
): Promise<TransferCollection> {
	const entries: Bundle.ProjectTransferEntry[] = [];
	const failures: TransferExportFailure[] = [];
	let total = 0;
	let byteLength = 0;
	for await (const event of streamTransferArchives(options)) {
		if (event.kind === 'entry') {
			entries.push(event.entry);
			total = event.total;
		} else if (event.kind === 'failed') {
			failures.push(event.failure);
			total = event.total;
		} else {
			total = event.total;
			byteLength = event.byteLength;
		}
	}
	return Object.freeze({
		entries: Object.freeze(entries),
		failures: Object.freeze(failures),
		total,
		byteLength,
	});
}

export interface TransferArchiveSourceOptions {
	/** Preferred: archives arriving one at a time, straight out of the exporter. */
	readonly archives?: AsyncIterable<TransferStreamEvent>;
	/** Accepted for callers that already hold every archive. */
	readonly collection?: TransferCollection;
}

/** Replay an already-collected set as the same event stream the transports read. */
async function* replayTransferCollection(
	collection: TransferCollection,
): AsyncGenerator<TransferStreamEvent, void> {
	let index = 0;
	for (const entry of collection.entries) {
		yield Object.freeze({ kind: 'entry' as const, entry, index, total: collection.total });
		index += 1;
	}
	for (const failure of collection.failures) {
		yield Object.freeze({ kind: 'failed' as const, failure, index, total: collection.total });
		index += 1;
	}
	yield Object.freeze({
		kind: 'summary' as const,
		total: collection.total,
		exported: collection.entries.length,
		failed: collection.failures.length,
		byteLength: collection.byteLength,
	});
}

export function transferArchiveEvents(
	options: TransferArchiveSourceOptions,
	label: string,
): AsyncIterable<TransferStreamEvent> {
	if (options?.archives) return options.archives;
	if (options?.collection) return replayTransferCollection(options.collection);
	throw new TypeError(`${label} needs either an archive stream or a collection.`);
}

export interface TransferDownloadRecord {
	readonly projectId: string;
	readonly title: string;
	readonly fileName: string;
	readonly byteLength: number;
	readonly outcome: 'saved' | 'failed';
	readonly reason: string | null;
}

export interface TransferDownloadReport {
	readonly records: readonly TransferDownloadRecord[];
	readonly exportFailures: readonly TransferExportFailure[];
	readonly saved: number;
	readonly failed: number;
}

export interface DownloadTransferArchivesOptions extends TransferArchiveSourceOptions {
	/** Injected so this module never touches `URL.createObjectURL` or the DOM. */
	readonly save: (entry: Bundle.ProjectTransferEntry) => Promise<void> | void;
	readonly signal?: AbortSignal;
}

/**
 * The fallback that assumes nothing: hand each archive to the browser to save.
 *
 * It exists because the handshake can be blocked by a popup blocker, by an
 * opener-severing policy, or by an enterprise profile, and a visitor whose
 * projects are about to become unreachable is owed a path that cannot be turned
 * off. One archive failing to save never stops the others.
 *
 * Each archive is saved as it is exported and then dropped, so this path holds
 * one archive at a time however large the library is - it is the transport that
 * never needs the aggregate ceiling.
 */
export async function downloadTransferArchives(
	options: DownloadTransferArchivesOptions,
): Promise<TransferDownloadReport> {
	if (options === null || typeof options !== 'object') {
		throw new TypeError('Downloading transfer archives needs an options record.');
	}
	const save = options.save;
	if (typeof save !== 'function') {
		throw new TypeError('Downloading transfer archives needs a save function.');
	}
	const records: TransferDownloadRecord[] = [];
	const exportFailures: TransferExportFailure[] = [];
	for await (const event of transferArchiveEvents(options, 'Downloading transfer archives')) {
		options.signal?.throwIfAborted();
		if (event.kind === 'failed') {
			exportFailures.push(event.failure);
			continue;
		}
		if (event.kind !== 'entry') continue;
		try {
			await save(event.entry);
			records.push(downloadRecord(event.entry, 'saved', null));
		} catch (error) {
			records.push(downloadRecord(event.entry, 'failed', describeTransferError(error)));
		}
	}
	return Object.freeze({
		records: Object.freeze(records),
		exportFailures: Object.freeze(exportFailures),
		saved: records.filter(({ outcome }) => outcome === 'saved').length,
		failed: records.filter(({ outcome }) => outcome === 'failed').length,
	});
}

function downloadRecord(
	entry: Bundle.ProjectTransferEntry,
	outcome: 'saved' | 'failed',
	reason: string | null,
): TransferDownloadRecord {
	return Object.freeze({
		projectId: entry.projectId,
		title: entry.title,
		fileName: entry.fileName,
		byteLength: entry.byteLength,
		outcome,
		reason,
	});
}

/** `"Field recording.scape"` names a project called `"Field recording"`. */
export function transferArchiveTitle(fileName: unknown): string {
	const name = typeof fileName === 'string' ? fileName.trim() : '';
	if (!name) return 'Untitled project';
	const trimmed = name.toLowerCase().endsWith('.scape') ? name.slice(0, -'.scape'.length) : name;
	return trimmed.trim() || 'Untitled project';
}

export function describeTransferError(error: unknown): string {
	if (error instanceof Error) return error.message || error.name;
	if (typeof error === 'string' && error) return error;
	return 'The operation failed for an unreported reason.';
}

export function admitTotalByteCeiling(value: unknown): number {
	if (value === undefined || value === null) return TRANSFER_MAX_TOTAL_BYTES;
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1
		|| value > TRANSFER_MAX_TOTAL_BYTES) {
		throw new RangeError(
			`maximumTotalBytes must be a safe integer in [1, ${TRANSFER_MAX_TOTAL_BYTES}].`,
		);
	}
	return value;
}

const TRANSFER_RUNTIME_MEMBERS = Object.freeze([
	'exportProject',
	'inspectProject',
	'importProject',
	'exportBundle',
	'importBundle',
	'sendTransfer',
	'receiveTransfer',
] as const);

/**
 * Refuse a half-built runtime up front rather than at the first call.
 *
 * The runtime is assembled by a dynamic import, so a missing member means a
 * chunk that loaded but did not export what this seam expects - a build
 * problem, not a transfer problem. Saying so before any project is read keeps
 * that distinction visible in the page's own error text.
 */
export function requireTransferRuntime<T extends { readonly runtime: TransferRuntime }>(
	options: T,
	label: string,
): T {
	if (options === null || typeof options !== 'object') {
		throw new TypeError(`A record of options is required for ${label}.`);
	}
	const runtime = (options as unknown as { runtime?: Record<string, unknown> }).runtime;
	for (const member of TRANSFER_RUNTIME_MEMBERS) {
		if (typeof runtime?.[member] !== 'function') {
			throw new TypeError(`The transfer runtime for ${label} is missing ${member}().`);
		}
	}
	// The store itself is not re-checked here: the bundle module's admission is
	// the authority on what a store must expose, and duplicating it would let
	// the two drift.
	return options;
}
