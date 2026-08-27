/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * What a transfer document actually does, with no DOM and no globals.
 *
 * Two finished modules do the real work - `project-transfer-bundle.ts` moves a
 * set of projects between two stores, `project-transfer-handshake.ts` speaks the
 * popup protocol - and neither knows about the other. This is the seam that
 * joins them. The export half lives in `transfer-archive-stream.ts` and is
 * re-exported here so a page has one import; this file is the transport half:
 * archives onto the wire, arriving archives into the store.
 *
 * Every dependency is injected, including both of those modules, so the whole
 * flow is exercisable against fakes and the page entry stays a thin shell that
 * loads the heavy archive code on demand. What the sending side knows about its
 * own wire independently of the protocol - which archives it buffered, posted
 * and had answered - lives in `transfer-send-watch.ts` and is re-exported here
 * for the same reason.
 *
 * Two invariants run through all of it:
 *
 *   **The sending origin loses nothing.** Export reads; it never deletes, never
 *   rewrites, never marks anything sent. A transfer that half-succeeded must
 *   leave the visitor able to try again.
 *
 *   **Nothing is reported as landed that did not land.** The wire's vocabulary
 *   is `stored` and `failed`; the import layer's is `imported`, `skipped` and
 *   `failed`. Mapping the second onto the first is exactly where a transfer
 *   page gets to lie, so that mapping is written out below rather than
 *   defaulted.
 */

import type * as Bundle from './project-transfer-bundle.ts';
import type * as Handshake from './project-transfer-handshake.ts';
import {
	transferArchiveEvents,
	transferArchiveTitle,
	admitTotalByteCeiling,
	describeTransferError,
	requireTransferRuntime,
	TransferBudgetError,
	TRANSFER_MAX_ARCHIVE_BYTES,
	type TransferArchiveSourceOptions,
	type TransferExportFailure,
	type TransferRuntime,
} from './transfer-archive-stream.ts';

import {
	bufferTransferPort,
	observeTransferAcknowledgements,
	type TransferSendPending,
} from './transfer-send-watch.ts';

import {
	encodeTransferRefusal,
	isTransferSkipReason,
	TransferDeclinedError,
} from './transfer-refusal.ts';

export * from './transfer-archive-stream.ts';
export * from './transfer-refusal.ts';
export { bufferTransferPort };
export type { TransferSendPending };

/**
 * How long either page waits for one answer from the peer window.
 *
 * The protocol's own default is 30 seconds, which is right for a handshake-shaped
 * exchange and badly wrong for the one message that dominates this transfer: the
 * sender's wait for an acknowledgement covers the receiving origin reading,
 * inspecting and importing a `.scape` of up to `TRANSFER_MAX_ARCHIVE_BYTES`
 * (256 MiB) into IndexedDB and OPFS. That is a cold write path measured in
 * single-digit megabytes per second on ordinary hardware, so a large project can
 * legitimately need several minutes - and the failure mode of the 30-second
 * default is the worst one available here: the visitor is told their projects
 * "did not cross" while the other origin is still busy storing them.
 *
 * Ten minutes covers a 256 MiB import at well under 0.5 MB/s, and is still a
 * sixth of the protocol's own `PROJECT_TRANSFER_MAX_TIMEOUT_MILLISECONDS`
 * ceiling of one hour. It is deliberately a real, finite budget rather than that
 * maximum: a peer that has genuinely stopped answering - a closed popup, a
 * crashed tab, a page the visitor navigated away from - must fail the transfer
 * with a named timeout instead of leaving the page waiting forever. Every leg of
 * the protocol is bounded by this same number, and the download fallback is
 * always on the page beside it.
 */
export const TRANSFER_ACKNOWLEDGEMENT_TIMEOUT_MILLISECONDS = 600_000;

export interface TransferChannelOptions {
	readonly port: Handshake.ProjectTransferPort;
	readonly targetOrigin: string;
	readonly allowedOrigins: readonly string[];
	/** Defaults to `TRANSFER_ACKNOWLEDGEMENT_TIMEOUT_MILLISECONDS`, never to the protocol's. */
	readonly timeoutMilliseconds?: number;
	/** Injected only by tests, so a timeout can be observed without waiting one out. */
	readonly clock?: Handshake.ProjectTransferClock;
	readonly signal?: AbortSignal | null;
}

export interface TransferSendReport {
	readonly sessionId: string;
	readonly total: number;
	readonly stored: number;
	/** Entries the other origin declined without storing, and without failing. */
	readonly skipped: number;
	readonly failed: number;
	readonly outcomes: readonly Handshake.ProjectTransferOutcome[];
	readonly exportFailures: readonly TransferExportFailure[];
	/** False when the protocol died before the peer's final report arrived. */
	readonly completed: boolean;
	readonly stopped: TransferStop | null;
	/**
	 * Archives that were posted and never acknowledged. They are **not**
	 * failures: the peer may have stored one and died before saying so, and a
	 * page that counts them either way tells the visitor something it cannot
	 * know.
	 */
	readonly unanswered: readonly TransferSendPending[];
	/**
	 * Archives the protocol stopped before this side ever posted. Their fate is
	 * not unknown - they definitely did not cross - so they are kept apart from
	 * `unanswered` rather than folded into it. Reporting an archive this origin
	 * knows it never sent as one whose fate it cannot determine is the same lie
	 * as reporting it as sent, told in the other direction.
	 */
	readonly unsent: readonly TransferSendPending[];
	/**
	 * The real project titles, by entry id.
	 *
	 * The wire carries a file name, never a title: `ProjectTransferEntry` is a
	 * closed record of `entryId`, `name`, `byteLength` and `payload`, and the
	 * name is `projectTransferFileName()`'s output - a sanitized derivation that
	 * has already dropped every character outside `\p{L}\p{N} ._-`, collapsed the
	 * runs and stripped the trailing dots. Recovering a title from it is lossy in
	 * exactly the cases a visitor most needs to recognise: `Rushes: 12/03 «take
	 * 2»` comes back as `Rushes 12 03 take 2`.
	 *
	 * So the title travels here instead, beside the archives rather than inside
	 * them. Each is the title this origin holds for the project it exported, which
	 * is the same title the receiving origin reads out of the archive itself - and
	 * that is the point: **one project is named one thing on both pages**, and on
	 * the download report the visitor may be holding beside them.
	 */
	readonly titles: ReadonlyMap<string, string>;
}

export interface SendTransferArchivesOptions
	extends TransferChannelOptions, TransferArchiveSourceOptions {
	readonly runtime: TransferRuntime;
	readonly maximumTotalBytes?: number;
}

/**
 * Hand the exported archives to the peer window.
 *
 * The offer is materialized as an array because `sendProjectTransfer()` admits
 * the whole transfer up front: it needs the count before it can announce
 * `begin`, and it validates every payload before the first one is posted. That
 * is the one place archives unavoidably pile up in a handshake transfer, so it
 * is the place the aggregate ceiling is enforced - past `maximumTotalBytes` the
 * transfer is refused by name before anything is posted, rather than taking the
 * tab down. The download transport has no such array and no such ceiling.
 *
 * The archives are passed by structured clone rather than transferred: a failed
 * handshake has to leave the visitor able to retry, or to fall back to
 * downloading exactly the same bytes.
 */
export async function sendTransferArchives(
	options: SendTransferArchivesOptions,
): Promise<TransferSendReport> {
	const { runtime } = requireTransferRuntime(options, 'sending transfer archives');
	const maximumTotalBytes = admitTotalByteCeiling(options.maximumTotalBytes);
	// Subscribed before the first project is read: the peer may already be
	// talking, and the export below is the long part of this function. This is
	// the *last* line of defence, not the first - by the time a transport is
	// running, the page has already awaited its runtime and its store, so the
	// page wraps the port where it builds it and this call finds it wrapped.
	const port = bufferTransferPort(options.port);
	const offered: Handshake.ProjectTransferEntry[] = [];
	// Kept beside the offer rather than in it: the protocol admits an entry as a
	// closed record, so an extra field on one is refused by name, and the file
	// name it does carry cannot be turned back into the title.
	const titles = new Map<string, string>();
	const exportFailures: TransferExportFailure[] = [];
	let total = 0;
	let byteLength = 0;
	for await (const event of transferArchiveEvents(options, 'Sending transfer archives')) {
		total = event.total;
		if (event.kind === 'failed') {
			exportFailures.push(event.failure);
			continue;
		}
		if (event.kind === 'summary') continue;
		byteLength += event.entry.byteLength;
		if (byteLength > maximumTotalBytes) throw new TransferBudgetError(byteLength, maximumTotalBytes);
		offered.push(Object.freeze({
			entryId: event.entry.projectId,
			name: event.entry.fileName,
			byteLength: event.entry.byteLength,
			payload: event.entry.bytes,
		}));
		titles.set(event.entry.projectId, event.entry.title);
	}
	const watch = observeTransferAcknowledgements(port, offered, options.allowedOrigins);
	let report: Handshake.ProjectTransferReport | null = null;
	let stopped: TransferStop | null = null;
	try {
		report = await runtime.sendTransfer({
			entries: offered,
			port: watch.port,
			targetOrigin: options.targetOrigin,
			allowedOrigins: options.allowedOrigins,
			timeoutMilliseconds: options.timeoutMilliseconds ?? TRANSFER_ACKNOWLEDGEMENT_TIMEOUT_MILLISECONDS,
			clock: options.clock,
			signal: options.signal ?? null,
		});
	} catch (error) {
		// The acknowledgements this side already holds are owed to the visitor
		// whether or not the wire lived long enough to be summarized, so a
		// protocol failure is reported *on* the result. Anything else is a
		// defect in an injected seam and keeps propagating.
		stopped = transferStop(error, options.signal ?? null);
		if (!stopped) throw error;
	}
	const outcomes = report ? report.entries : watch.outcomes;
	let stored = 0;
	let skipped = 0;
	let failed = exportFailures.length;
	for (const outcome of outcomes) {
		if (outcome.status === 'stored') stored += 1;
		else if (isTransferSkipReason(outcome.reason)) skipped += 1;
		else failed += 1;
	}
	return Object.freeze({
		sessionId: report?.sessionId ?? watch.sessionId,
		total: Math.max(total, offered.length + exportFailures.length),
		stored,
		skipped,
		failed,
		outcomes,
		exportFailures: Object.freeze(exportFailures),
		completed: report !== null,
		stopped,
		// A protocol that reported has acknowledged every entry it was given, so
		// neither pending list can hold anything once a report exists.
		unanswered: report ? Object.freeze([]) : watch.unanswered,
		unsent: report ? Object.freeze([]) : watch.unsent,
		titles,
	});
}

/** Why a transfer ended before the protocol reported. */
export interface TransferStop {
	/** The protocol's own name for it - `'TIMEOUT'`, `'PEER_ABORTED'`, `'ABORTED'`. */
	readonly code: string;
	readonly reason: string;
}

/**
 * A record of the bundle layer's, or one this layer wrote for an archive the
 * bundle layer refused outright.
 *
 * The only difference is `reasonCode`, which for a refusal is a *stop* code -
 * `'shared-memory'`, `'entry-too-large'` - rather than one of the per-record
 * codes. Widening it here is what lets a refused archive be reported as the
 * failed record it is, instead of being dropped for want of a place to put its
 * name.
 */
export interface TransferImportRecord extends Omit<Bundle.ProjectTransferImportRecord, 'reasonCode'> {
	readonly reasonCode: string | null;
}

export interface TransferReceiveReport {
	/** The protocol's report, or null when the transfer stopped before one. */
	readonly report: Handshake.ProjectTransferReport | null;
	/** Every entry this origin actually saw, whether or not the run finished. */
	readonly records: readonly TransferImportRecord[];
	/** False when the protocol stopped before the last entry was acknowledged. */
	readonly completed: boolean;
	readonly stopped: TransferStop | null;
}

/**
 * Name the stop a mid-run error represents, or null when it is not one.
 *
 * The same rule the bundle layer applies one layer down: a transport failure
 * ends the run and is reported *on* the result, because the entries already
 * written to this origin are owed to the visitor either way, while anything
 * else is a defect in an injected seam and keeps propagating.
 *
 * The protocol error is recognised by name rather than by `instanceof`: the
 * class lives in `project-transfer-handshake-wire.ts`, and importing it for a
 * value would make the whole protocol a static dependency of the transfer page,
 * including the download-only path that never opens a popup.
 */
function transferStop(
	error: unknown,
	signal: AbortSignal | null | undefined,
): TransferStop | null {
	const code = (error as { code?: unknown } | null)?.code;
	if (error instanceof Error && error.name === 'ProjectTransferProtocolError' && typeof code === 'string') {
		return Object.freeze({ code, reason: describeTransferError(error) });
	}
	if (signal?.aborted) {
		return Object.freeze({ code: 'ABORTED', reason: describeTransferError(error) });
	}
	return null;
}

export interface ReceiveTransferArchivesOptions extends TransferChannelOptions {
	readonly runtime: TransferRuntime;
	readonly store: Bundle.ProjectTransferImportStore;
	readonly sessionId: string;
	readonly onRecord?: (record: TransferImportRecord) => void;
}

/**
 * The record for an archive the import layer refused before writing anything.
 *
 * `importBundle()` refuses in two shapes: it *resolves* with a named stop and no
 * record for a refusal it took as a decision, and it *rejects* for one it took
 * as a broken request. A receiving page that lists only records is a page on
 * which either one makes an archive silently disappear - no row, no failure
 * counted, and a run still flagged complete - so both are written up as the
 * failed record they are, keeping the refusal's own name. This is also the last
 * point at which that name can be put on the wire home.
 */
function refusedImportRecord(
	entry: Handshake.ProjectTransferEntry,
	stopped: { readonly code: string; readonly reason: string } | null | undefined,
	index: number,
): TransferImportRecord {
	return Object.freeze({
		index,
		outcome: 'failed' as const,
		projectId: entry.entryId,
		title: transferArchiveTitle(entry.name),
		byteLength: entry.byteLength,
		reasonCode: stopped?.code ?? null,
		reason: stopped?.reason ?? 'The archive import reported no outcome for this entry.',
		// The refusal came before the write, so there is nothing to have left.
		residue: 'none' as const,
	});
}

/**
 * The name and prose to record for an import that rejected.
 *
 * A refusal thrown rather than returned still carries its name on the error -
 * `ProjectTransferRefusalError` and the protocol's own error both expose one -
 * and that name is the part the visitor on either origin can quote back. An
 * error that names nothing is still a refusal, so it gets a name of its own here
 * rather than crossing the wire as an anonymous failure.
 */
function rejectedImportRefusal(error: unknown): { code: string; reason: string } {
	const code = (error as { code?: unknown } | null)?.code;
	return {
		code: typeof code === 'string' && code ? code : 'import-rejected',
		reason: describeTransferError(error),
	};
}

/**
 * Accept the handshake and import each archive as it arrives.
 *
 * Each entry is imported on its own rather than streamed into one bundle run,
 * because the protocol acknowledges entries one at a time and the
 * acknowledgement has to answer exactly one question: **is this project now
 * present on this origin?**
 *
 *   - `imported` - it is. Acknowledged as stored.
 *   - `skipped` because a project with this identity is already here - it is.
 *     Acknowledged as stored, with the honest `skipped` outcome kept in the
 *     local record.
 *   - `skipped` for any other reason, `archive-read-only` above all - it is
 *     **not**. A `.scape` whose schema is newer than this build opens read-only
 *     and is never written, so acknowledging it as stored would tell the
 *     sending origin that a project crossed which never did. It is declined,
 *     and its reason travels back with it.
 *   - `failed` - it is not, and the reason travels back with it.
 *
 * Every named refusal is carried back by name (see `encodeTransferRefusal`),
 * and the records survive a protocol failure: an entry written to this origin
 * is written whether or not the wire lived long enough to say so.
 */
export async function receiveTransferArchives(
	options: ReceiveTransferArchivesOptions,
): Promise<TransferReceiveReport> {
	const { runtime, store } = requireTransferRuntime(options, 'receiving transfer archives');
	const records: TransferImportRecord[] = [];
	const signal = options.signal ?? null;
	const receive = runtime.receiveTransfer({
		sessionId: options.sessionId,
		// Buffered here as well as on the page: a message that arrives between
		// this port being built and the protocol subscribing to it is a message
		// the transfer would otherwise wait out its whole timeout for.
		port: bufferTransferPort(options.port),
		targetOrigin: options.targetOrigin,
		allowedOrigins: options.allowedOrigins,
		timeoutMilliseconds: options.timeoutMilliseconds ?? TRANSFER_ACKNOWLEDGEMENT_TIMEOUT_MILLISECONDS,
		clock: options.clock,
		signal,
		maxEntryBytes: TRANSFER_MAX_ARCHIVE_BYTES,
		acceptEntry: async (entry) => {
			let record: TransferImportRecord;
			try {
				const result = await runtime.importBundle({
					store,
					importProject: runtime.importProject,
					inspectProject: runtime.inspectProject,
					entries: [{
						projectId: entry.entryId,
						title: transferArchiveTitle(entry.name),
						bytes: entry.payload as Uint8Array<ArrayBuffer>,
					}],
					signal: signal ?? undefined,
				});
				record = result.entries[0] ?? refusedImportRecord(entry, result.stopped, records.length);
			} catch (error) {
				// The rejected sibling of the resolved refusal above. Reaching the
				// record-keeping on only one of the two shapes is how an archive
				// this origin certainly does not hold came to have no row, no
				// failure counted and no place in the total.
				record = refusedImportRecord(entry, rejectedImportRefusal(error), records.length);
			}
			// Renumbered by position in this receive run: each entry is imported
			// as its own one-entry bundle, so every record arrives as index 0 and
			// a page counting them would report "archive 1" for all of them.
			const numbered = Object.freeze({ ...record, index: records.length });
			records.push(numbered);
			options.onRecord?.(numbered);
			if (numbered.outcome === 'failed') {
				throw new Error(encodeTransferRefusal({
					code: numbered.reasonCode,
					text: numbered.reason ?? 'The archive could not be imported.',
				}));
			}
			if (numbered.outcome === 'skipped' && numbered.reasonCode !== 'already-present') {
				throw new TransferDeclinedError(
					numbered.reasonCode,
					numbered.reason || 'The archive was not written to this origin.',
				);
			}
		},
	});
	try {
		return Object.freeze({
			report: await receive,
			records: Object.freeze([...records]),
			completed: true,
			stopped: null,
		});
	} catch (error) {
		const stopped = transferStop(error, signal);
		if (!stopped) throw error;
		// Whatever landed before the wire died is on this origin now, and saying
		// so is the whole point of holding the records outside the try.
		return Object.freeze({
			report: null,
			records: Object.freeze([...records]),
			completed: false,
			stopped,
		});
	}
}

export interface TransferArchiveSource {
	readonly name: string;
	read(): Promise<Uint8Array>;
}

export interface ImportTransferArchiveFilesOptions {
	readonly runtime: TransferRuntime;
	readonly store: Bundle.ProjectTransferImportStore;
	readonly files: Iterable<TransferArchiveSource>;
	readonly maximumEntries?: number;
	readonly maximumEntryBytes?: number;
	readonly signal?: AbortSignal;
	readonly onProgress?: (progress: Bundle.ProjectTransferProgress) => void;
}

/**
 * The other half of the fallback: import archives the visitor downloaded.
 *
 * Files are read one at a time through an async iterable rather than up front,
 * so a folder of large archives never has to be resident at once.
 */
export async function importTransferArchiveFiles(
	options: ImportTransferArchiveFilesOptions,
): Promise<Bundle.ProjectTransferImportResult> {
	const { runtime, store } = requireTransferRuntime(options, 'importing transfer archives');
	const files = options.files;
	if (files === null || typeof files !== 'object' || typeof (files as Iterable<unknown>)[Symbol.iterator] !== 'function') {
		throw new TypeError('Importing transfer archives needs an iterable of files.');
	}
	async function* entries(): AsyncGenerator<unknown, void> {
		for (const file of files) {
			options.signal?.throwIfAborted();
			if (typeof file?.read !== 'function') {
				throw new TypeError('Every transfer archive file must expose a read() function.');
			}
			const bytes = await file.read();
			yield {
				title: transferArchiveTitle(file.name),
				bytes,
			};
		}
	}
	return runtime.importBundle({
		store,
		importProject: runtime.importProject,
		inspectProject: runtime.inspectProject,
		entries: entries(),
		maximumEntries: options.maximumEntries,
		maximumEntryBytes: options.maximumEntryBytes,
		signal: options.signal,
		onProgress: options.onProgress,
	});
}
