/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Turn the three report shapes into one list of rows the page can render.
 *
 * Kept pure and DOM-free so the honesty of the reporting is testable. The rule
 * these functions encode: **partial success is reported as partial success.**
 * Every project that was selected appears exactly once, a project that did not
 * cross says why in words the visitor can act on, and the summary line counts
 * failures even when they happened in a different layer than the successes.
 * A transfer page that says "done" over a silently dropped project is the one
 * failure mode that loses work.
 */

import {
	decodeTransferRefusal,
	transferArchiveTitle,
	type TransferDownloadReport,
	type TransferExportFailure,
	type TransferImportRecord,
	type TransferSendReport,
} from './transfer-session.ts';
import type { CrossProductHandoffConversionReportV1 } from
	'./cross-product-handoff-conversion.ts';

export type TransferRowOutcome = 'ok' | 'skipped' | 'failed';

export interface TransferResultRow {
	readonly label: string;
	readonly detail: string;
	readonly outcome: TransferRowOutcome;
}

export interface TransferResultReport {
	readonly rows: readonly TransferResultRow[];
	readonly summary: string;
	readonly complete: boolean;
}

/** Attach the conversion ledger to the ordinary transport result without hiding either layer. */
export function withCrossProductHandoffReports(
	report: TransferResultReport,
	conversions: readonly Readonly<CrossProductHandoffConversionReportV1>[],
): TransferResultReport {
	if (conversions.length === 0) return report;
	const rows = [
		...report.rows,
		...conversions.flatMap((conversion) => conversion.roots.map((root) => ({
			label: `${conversion.source.projectId} / ${root.root}`,
			detail: `${root.disposition}: ${root.reason} Source ${root.sourceSha256}`
				+ (root.destinationSha256 === null ? '' : `; destination ${root.destinationSha256}`),
			outcome: (root.disposition === 'refuse' ? 'failed'
				: root.disposition === 'omit-with-report' ? 'skipped' : 'ok') as TransferRowOutcome,
		}))),
	];
	const refused = conversions.some(({ refused }) => refused);
	return Object.freeze({
		rows: Object.freeze(rows),
		summary: `${report.summary} Conversion ledger: ${conversions.length} invocation`
			+ `${conversions.length === 1 ? '' : 's'}, ${rows.length - report.rows.length} classified roots.`,
		complete: report.complete && !refused,
	});
}

export function formatTransferBytes(byteLength: unknown): string {
	const bytes = typeof byteLength === 'number' && Number.isFinite(byteLength) && byteLength >= 0
		? byteLength
		: 0;
	if (bytes < 1024) return `${bytes} B`;
	const units = ['KiB', 'MiB', 'GiB', 'TiB'];
	let value = bytes / 1024;
	let unit = 0;
	while (value >= 1024 && unit < units.length - 1) {
		value /= 1024;
		unit += 1;
	}
	return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

function exportFailureRows(failures: readonly TransferExportFailure[]): TransferResultRow[] {
	return failures.map((failure) => ({
		label: failure.title || failure.projectId,
		detail: `Could not be exported: ${failure.reason}`,
		outcome: 'failed' as const,
	}));
}

export function describeTransferDownload(
	report: TransferDownloadReport,
	failures: readonly TransferExportFailure[] = report.exportFailures ?? [],
): TransferResultReport {
	const rows: TransferResultRow[] = [
		...report.records.map((record) => ({
			label: record.title || record.projectId,
			detail: record.outcome === 'saved'
				? `Saved as ${record.fileName} (${formatTransferBytes(record.byteLength)})`
					+ (record.conversionReportFileName
						? ` with ${record.conversionReportFileName}` : '')
				: record.outcome === 'partial'
					? `Saved archive as ${record.fileName} (${formatTransferBytes(record.byteLength)}),`
						+ ` but not its complete companion set: ${record.reason ?? 'no reason reported'}`
					: `Could not be saved: ${record.reason ?? 'no reason reported'}`,
			outcome: (record.outcome === 'saved' ? 'ok' : 'failed') as TransferRowOutcome,
		})),
		...exportFailureRows(failures),
	];
	const partial = report.partial ?? 0;
	const failed = report.failed + failures.length;
	// Nothing reached the saver and nothing failed on the way, so the run never
	// had a project in it. "Downloaded 0 of 0 projects." is true by arithmetic
	// and reads as a completed transfer, which is the one thing a visitor about
	// to abandon this origin must not be told over a run that moved nothing.
	const empty = report.records.length === 0 && failures.length === 0;
	return Object.freeze({
		rows: Object.freeze(rows),
		summary: empty
			? 'No projects were downloaded: nothing in this run reached the exporter.'
				+ ' Nothing on this origin was changed.'
			: failed === 0 && partial === 0
				? `Downloaded ${report.saved} of ${report.saved} projects. Nothing on this origin was changed.`
				: `Downloaded ${report.saved} complete project${report.saved === 1 ? '' : 's'};`
					+ (partial ? ` ${partial} left an archive without its confirmed companion;` : '')
					+ (failed ? ` ${failed} could not be downloaded.` : '')
					+ ' Nothing on this origin was changed.',
		complete: failed === 0 && partial === 0 && !empty,
	});
}

/**
 * The sender's view of what the other origin did with each archive.
 *
 * Three outcomes, not two. The wire only carries `stored` and `failed`, but a
 * receiver that declined an entry without storing it marks its reason (see
 * `TRANSFER_SKIPPED_REASON_PREFIX`), and that distinction has to survive into
 * what the visitor reads. "The other origin skipped it: the archive was written
 * by a newer build" names a project they still have to move by hand, and it
 * must not be counted or worded as if it had crossed.
 *
 * Two more states sit underneath those three, and both only appear when the
 * protocol died mid-run. They are worded apart because they are not the same
 * fact:
 *
 *   - **Posted, never acknowledged.** The sending origin genuinely does not know
 *     what became of it - the peer may have stored it and lost the wire before
 *     saying so - so it is neither counted as sent nor reported as failed, and
 *     the not-knowing is said out loud. A visitor about to abandon this origin
 *     has to check that one by hand rather than trust either guess.
 *   - **Never posted.** The transfer stopped before this archive reached the
 *     wire, and the sender knows exactly which archives it posted. Lending it the
 *     uncertain wording would be a page claiming ignorance about work it knows it
 *     never started: it sends the visitor hunting the other origin for an archive
 *     that never got there, and it buries the genuinely unknown ones among
 *     archives whose fate is perfectly well known.
 *
 * Rows are labelled with the project's title rather than its archive file name,
 * because the receiving page labels its own rows that way and one project must
 * not be named two things across the two reports a visitor is holding. The title
 * is read from `report.titles`, which the transport carried beside the archives -
 * *not* derived back out of the file name, which is a sanitized projection of the
 * title and cannot be inverted (see `sendRowLabel()`).
 */
export function describeTransferSend(report: TransferSendReport): TransferResultReport {
	const stopped = report.stopped ?? null;
	const unanswered = report.unanswered ?? [];
	const unsent = report.unsent ?? [];
	const rows: TransferResultRow[] = [
		...report.outcomes.map((outcome) => {
			if (outcome.status === 'stored') {
				return {
					label: sendRowLabel(report, outcome),
					detail: `Stored on the other origin (${formatTransferBytes(outcome.byteLength)})`,
					outcome: 'ok' as TransferRowOutcome,
				};
			}
			// The name the refusing layer gave it is shown alongside the prose:
			// it is the one part of a refusal a visitor can quote back, search
			// for, or hand to whoever maintains the other origin.
			const refusal = decodeTransferRefusal(outcome.reason);
			const reason = refusal.text || 'no reason reported';
			const named = refusal.code ? `${reason} (${refusal.code})` : reason;
			return {
				label: sendRowLabel(report, outcome),
				detail: refusal.skipped
					? `Not stored - the other origin skipped it: ${named}`
					: `Not stored: ${named}`,
				outcome: (refusal.skipped ? 'skipped' : 'failed') as TransferRowOutcome,
			};
		}),
		...unanswered.map((entry) => ({
			label: sendRowLabel(report, entry),
			detail: 'Not acknowledged - this archive was sent, but the transfer stopped before the other origin'
				+ ' answered for it, so this page cannot say whether it crossed. Check the other origin for it,'
				+ ' or download it here.',
			outcome: 'failed' as TransferRowOutcome,
		})),
		...unsent.map((entry) => ({
			label: sendRowLabel(report, entry),
			detail: 'Never sent - the transfer stopped before this archive was offered, so it is not on the'
				+ ' other origin. Download it here, or try the transfer again.',
			outcome: 'failed' as TransferRowOutcome,
		})),
		...exportFailureRows(report.exportFailures),
	];
	const skipped = report.skipped ?? 0;
	const failed = report.failed;
	// `total === 0` is the send-side twin of the empty download above: a run that
	// offered nothing satisfies `stored === total` and would otherwise render
	// "Sent 0 of 0 projects." as a transfer that finished.
	const complete = report.completed !== false
		&& failed === 0 && skipped === 0 && report.total > 0 && report.stored === report.total;
	const counted = [
		failed ? `${failed} did not cross` : '',
		skipped ? `${skipped} skipped` : '',
	].filter(Boolean).join(', ');
	const kept = ' Everything is still stored here, so you can try again or download the archives.';
	return Object.freeze({
		rows: Object.freeze(rows),
		summary: stopped
			// Deliberately not "Sent N of M": the run never reached the end, so
			// M - N is not a count of projects that failed to cross, and the
			// unacknowledged ones are not known to have failed at all.
			? `The transfer stopped after ${report.stored} of ${report.total} projects: ${stopped.reason}`
				+ ` (${stopped.code}).${pendingSentence(unanswered.length)}${unsentSentence(unsent.length)}${kept}`
			: complete
				? `Sent ${report.stored} of ${report.total} projects.`
					+ ' They are still stored here too - nothing was removed.'
				: `Sent ${report.stored} of ${report.total} projects; ${counted || 'some did not cross'}.${kept}`,
		complete,
	});
}

/**
 * What to call one archive of a send, on the sending page.
 *
 * The title the transport carried, when it has one for this entry. A file name
 * is not a second-best title, it is a lossy projection of one: the sanitizer
 * behind `projectTransferFileName()` replaces everything outside
 * `\p{L}\p{N} ._-` with a space, collapses the runs, strips trailing dots and
 * truncates - so `Rushes: 12/03 «take 2»...` becomes `Rushes 12 03 take 2`, and
 * `transferArchiveTitle()` can only hand that mangling back. The receiving page
 * reads the real title out of the archive it inspected, and the sender's own
 * download report reads it off the exported entry, so a sending page that
 * reconstructs it from the name is the one report of the three that names the
 * project wrong.
 *
 * The fall-back is kept for the reports that legitimately have no title map -
 * one built by hand, or one recovered from an older shape - because a
 * recognisable stem is still better than an entry id or an empty row. It is a
 * fall-back, never the path a live transfer takes.
 */
function sendRowLabel(
	report: TransferSendReport,
	entry: Readonly<{ entryId: string; name: string }>,
): string {
	return report.titles?.get(entry.entryId) || transferArchiveTitle(entry.name);
}

/** The archives whose fate the sending origin genuinely cannot determine. */
function pendingSentence(count: number): string {
	if (count === 0) return '';
	return ` ${count} archive${count === 1 ? ' was' : 's were'} sent but never acknowledged,`
		+ ` so this page cannot say whether ${count === 1 ? 'it' : 'they'} crossed.`;
}

/** And the ones it can: these never reached the wire. */
function unsentSentence(count: number): string {
	if (count === 0) return '';
	return ` ${count} archive${count === 1 ? ' was' : 's were'} never sent,`
		+ ` so ${count === 1 ? 'it is' : 'they are'} not on the other origin.`;
}

/** One ticked row this page refused before any transport saw it. */
export interface TransferRefusedChoice {
	readonly label: string;
	/** The refusal the selection layer already wrote for this row. */
	readonly reason: string;
}

/**
 * Fold the ticked rows that never reached a transport into that run's report.
 *
 * The sending page offers rows it knows cannot cross - one this origin listed
 * without a usable project id, the older of two copies sharing one id, a store
 * that could not be read at all - because a row the page hides is a project the
 * visitor never learns about. Ticking one is therefore possible, and the
 * exporter is deliberately never given it: its selection key matches no project,
 * so it simply fell out of the run. The report then listed every row *except*
 * the ones the visitor was owed the clearest answer about, and a run made
 * entirely of them rendered as a transfer that finished with nothing to do.
 *
 * So they are put back here, at the one point that holds both the transport's
 * report and the selection it was built from. Each keeps the refusal the
 * selection layer already wrote, and their presence costs the report its
 * `complete` flag: something the visitor ticked did not cross.
 *
 * `report` is null when the run never reached a transport at all, because every
 * ticked row was one of these. There is no transport report to fold them into,
 * and inventing an empty one is what puts "Sent 0 of 0 projects" back on the
 * page.
 */
export function withRefusedTransferChoices(
	report: TransferResultReport | null,
	refused: readonly TransferRefusedChoice[],
): TransferResultReport {
	if (refused.length === 0) {
		return report ?? Object.freeze({
			rows: Object.freeze([]),
			summary: 'Nothing was transferred. Nothing on this origin was changed.',
			complete: false,
		});
	}
	const rows: TransferResultRow[] = [
		...report?.rows ?? [],
		...refused.map((choice) => ({
			label: choice.label,
			detail: `Not transferred - this page never offered it: ${choice.reason}`,
			outcome: 'failed' as TransferRowOutcome,
		})),
	];
	const one = refused.length === 1;
	const counted = `${refused.length} ticked ${one ? 'row' : 'rows'} could not be transferred at all;`
		+ ` ${one ? 'it says' : 'each says'} why below.`;
	return Object.freeze({
		rows: Object.freeze(rows),
		summary: report
			? `${report.summary} ${counted}`
			: `Nothing was transferred. ${counted} Nothing on this origin was changed.`,
		complete: false,
	});
}

/**
 * What `describeTransferImport()` needs from an import, structurally.
 *
 * `ProjectTransferImportResult` satisfies it, and so does the receiving
 * page's own tally of a handshake - whose stop codes come from the protocol
 * rather than from the bundle layer's refusal vocabulary. Widening `code` to a
 * string is what lets one honest renderer serve both without either caller
 * having to launder its stop through a cast.
 */
export interface TransferImportOutcome {
	readonly entries: readonly TransferImportRecord[];
	readonly total: number;
	readonly imported: number;
	readonly skipped: number;
	readonly failed: number;
	/** False when the run stopped before every offered archive was seen. */
	readonly completed: boolean;
	readonly stopped: Readonly<{ code: string; index: number; reason: string }> | null;
}

/**
 * The receiving origin's view of an import - including the one it never
 * finished.
 *
 * `total` is however many archives the caller can vouch for: the number the
 * peer announced, when a handshake got that far, and otherwise only the ones
 * this run actually read - a run the import layer refused up front never learns
 * how many there were. Either way it is a denominator that cannot describe a
 * truncated run on its own: "Imported 0 of 0 archives." over a refusal is true
 * by arithmetic and a lie in every way that matters. So a stop gets its own
 * sentence, its own row, and costs the report its `complete` flag even when
 * nothing failed.
 */
export function describeTransferImport(result: TransferImportOutcome): TransferResultReport {
	const stopped = result.stopped ?? null;
	const rows: TransferResultRow[] = result.entries.map((record) => ({
		label: record.title || record.projectId || `Archive ${record.index + 1}`,
		detail: describeImportRecord(record),
		outcome: importRowOutcome(record.outcome),
	}));
	if (stopped) {
		rows.push({
			label: `Archive ${stopped.index + 1}`,
			detail: `Not read - the import stopped here: ${stopped.reason} (${stopped.code})`,
			outcome: 'failed',
		});
	}
	// A skip is not a failure, but most skips still mean the project is *not*
	// here: `already-present` is the only one that leaves it present, because it
	// is the only one over a project this origin already held. The sending page
	// calls any skip an incomplete transfer - a skip is what the wire carries for
	// an archive this build refused to write - so a receiving page that calls the
	// same run complete has the two origins telling one visitor opposite things.
	const absent = result.entries.filter(
		(record) => record.outcome === 'skipped' && record.reasonCode !== 'already-present',
	).length;
	const counted = `Imported ${result.imported} of ${result.total} archive${result.total === 1 ? '' : 's'}`
		+ `${result.skipped ? `, skipped ${result.skipped}` : ''}`
		+ `${result.failed ? `, ${result.failed} failed` : ''}.`;
	const base = Object.freeze({
		rows: Object.freeze(rows),
		summary: stopped
			? `${counted} The import stopped at archive ${stopped.index + 1} and the rest were not read:`
				+ ` ${stopped.reason} (${stopped.code})`
			: counted,
		complete: result.completed && result.failed === 0 && absent === 0,
	});
	const conversions = result.entries.flatMap((record) => {
		const recognized = record.outcome === 'imported'
			|| (record.outcome === 'skipped' && record.reasonCode === 'already-present');
		return recognized && record.conversionReport ? [record.conversionReport] : [];
	});
	return withCrossProductHandoffReports(base, conversions);
}

function importRowOutcome(outcome: TransferImportRecord['outcome']): TransferRowOutcome {
	if (outcome === 'imported') return 'ok';
	return outcome === 'skipped' ? 'skipped' : 'failed';
}

/**
 * One failed archive, and what it left on this origin.
 *
 * The residue sentence is the line a visitor reads to answer one question:
 * *is my data at risk?* It used to answer "yes" unconditionally - every
 * `retained` rendered as "A partial copy could not be removed." - and under the
 * authorship rules the import layer now follows that is usually false.
 * `retained` is what a transfer reports when it declined to delete: because it
 * cannot prove it wrote the project sitting at that identity, because the row
 * was replaced by another writer, or because the store offers no exact-current
 * delete. In every one of those a project someone else's work depends on was
 * deliberately left alone, and calling it a partial copy tells them their own
 * project is debris.
 *
 * So the two cases are worded apart, and neither claims more than the record
 * proves. The record carries no authorship field, only `residue`, so what is
 * asserted here is exactly what `residue` means - whether this transfer removed
 * what it wrote - while the import layer's own note, already carried in
 * `reason`, says which of the retained cases this one was.
 */
function describeImportRecord(record: TransferImportRecord): string {
	const size = formatTransferBytes(record.byteLength);
	if (record.outcome === 'imported') return `Imported (${size})`;
	// The name the refusing layer gave it travels with the prose, for the same
	// reason it does on the sending side: it is the one part of a refusal a
	// visitor can quote back, search for, or hand to whoever maintains a build.
	const plain = record.reason || 'no reason reported';
	const reason = record.reasonCode ? `${plain} (${record.reasonCode})` : plain;
	if (record.outcome === 'skipped') return `Skipped: ${reason}`;
	const residue = record.residue === 'retained'
		? ' Nothing here was deleted: whatever is stored under this project\'s identity was left as it is.'
		: record.residue === 'cleared'
			? ' Nothing this transfer wrote was left behind.'
			: '';
	return `Failed: ${reason}${residue}`;
}
