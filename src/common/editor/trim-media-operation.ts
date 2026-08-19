/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Running a trim-media plan: writing the trimmed copies the plan proved.
 *
 * The plan decides which frames survive and where they land; this writes them
 * and verifies that what came out is what was promised. Two rules shape it, and
 * both are structural rather than written down and trusted.
 *
 * **A linked original is never rewritten.** Trimming external media would mean
 * editing a file the user owns and did not hand over, and the
 * `m2-linked-media-lifecycle` acceptance forbids it outright. Such a source is
 * refused with the reason rather than trimmed in place, which is also the
 * slice's "refuse where undo cannot be honest": there is no honest undo for
 * bytes that were somebody else's.
 *
 * **Nothing is deleted.** A trim writes a new managed copy and rebinds to it;
 * the pre-trim bytes stay where they are, which is what makes an undo possible
 * at all. Reclaiming them is a separate decision a caller has to take
 * deliberately, and there is no port here that could take it by accident.
 *
 * Verification is against the plan, not against the writer's own account of
 * itself: a trimmed copy whose frame count differs from the frames the plan
 * retained is refused, because that is precisely the case where a referenced
 * frame went missing.
 */

import {
	type DeliveryReport,
	addDeliveryReportItem,
	createDeliveryReport,
	sealDeliveryReport,
} from './delivery-report.ts';
import {
	trimMediaRangesCover,
	trimMediaRetainedRuns,
	trimMediaRunsFromRanges,
	type TrimMediaPlan,
	type TrimMediaRange,
	type TrimMediaRetainedRun,
	type TrimMediaSourcePlan,
} from './trim-media-plan.ts';

export type TrimMediaOutcome =
	| 'trimmed'
	| 'whole-source-retained'
	| 'unreferenced'
	| 'linked-original-refused'
	| 'frame-count-mismatch'
	| 'rebind-superseded'
	| 'write-failed';

export interface TrimMediaSourceResult {
	readonly sourceId: string;
	readonly outcome: TrimMediaOutcome;
	readonly storageKey: string | null;
	readonly retainedFrames: number;
	readonly discardedFrames: number;
	/** The runs the trimmed copy contains, and where each begins in it. */
	readonly runs: readonly TrimMediaRetainedRun[];
	/**
	 * How long the copy actually is, which is what the document must be told.
	 * Never less than `retainedFrames`, and more wherever a run had to widen.
	 * Null when nothing was written.
	 */
	readonly writtenFrames: number | null;
	readonly byteLength: number | null;
}

export interface TrimMediaRunResult {
	readonly sources: readonly TrimMediaSourceResult[];
	readonly trimmedSources: number;
	readonly discardedFrames: number;
	/**
	 * True while every pre-trim copy is still in place, which is the only state
	 * in which an undo would restore what was there.
	 */
	readonly undoable: boolean;
	readonly report: DeliveryReport;
}

export interface TrimMediaWrittenCopy {
	readonly storageKey: string;
	/** What the writer actually produced, checked against what the plan retained. */
	readonly frameCount: number;
	readonly byteLength: number;
	/**
	 * The runs the copy actually holds.
	 *
	 * A lossless cut may only begin at a keyframe, so a writer is allowed to
	 * come back with wider runs than it was asked for — and then the document
	 * has to be remapped against what was written rather than what was
	 * requested, or every reference after the first widened run lands in the
	 * wrong place. A writer with nothing to widen may leave this out, and is
	 * then held to the runs it was given.
	 */
	readonly runs?: readonly TrimMediaRange[];
}

export interface TrimMediaOperationOptions {
	readonly signal?: AbortSignal;
	readonly assertCurrent?: () => void;
	readonly onProgress?: (progress: Readonly<{ completed: number; total: number }>) => void;
}

/** Everything this operation may do. Nothing here removes or rewrites media. */
export interface TrimMediaPorts {
	/** Write a new managed copy containing exactly these runs, in order. */
	writeTrimmedCopy(
		source: TrimMediaSourcePlan,
		runs: readonly TrimMediaRetainedRun[],
		options: Readonly<{ signal?: AbortSignal }>,
	): Promise<TrimMediaWrittenCopy>;
	/** Rebind the source to its trimmed copy. */
	rebind(
		request: Readonly<{
			sourceId: string;
			storageKey: string;
			frameCount: number;
			byteLength: number;
			runs: readonly TrimMediaRetainedRun[];
		}>,
		options: Readonly<{ signal?: AbortSignal }>,
	): Promise<boolean>;
	/** Drop a trimmed copy that must not be kept. */
	discardTrimmedCopy(
		storageKey: string,
		options: Readonly<{ signal?: AbortSignal }>,
	): Promise<void>;
}

export interface TrimMediaRunRequest {
	readonly plan: TrimMediaPlan;
	/**
	 * Sources whose bytes are external files. Refused rather than trimmed, so
	 * the caller has to say which they are rather than this guessing.
	 */
	readonly linkedSourceIds?: Iterable<string>;
}

export async function runTrimMedia(
	request: TrimMediaRunRequest,
	ports: TrimMediaPorts,
	options: TrimMediaOperationOptions = {},
): Promise<TrimMediaRunResult> {
	const plan = request?.plan;
	if (!plan || typeof plan !== 'object') throw new TypeError('A trim-media run requires a plan.');
	const linked = new Set(request.linkedSourceIds ?? []);
	const draft = createDeliveryReport({
		format: 'trim-media', container: null, codec: null,
		sampleRate: null, channelCount: null, lossless: null,
	});
	const candidates = plan.sources.filter((source) => (
		source.referenceCount > 0 && !source.wholeSourceRetained
	));
	const results: TrimMediaSourceResult[] = [];
	let completed = 0;
	let trimmedSources = 0;
	let discardedFrames = 0;

	for (const source of plan.sources) {
		assertReady(options);
		if (source.referenceCount === 0) {
			results.push(result(source, 'unreferenced', null, []));
			addDeliveryReportItem(draft, {
				code: 'trim.source-unreferenced',
				disposition: 'omitted',
				severity: 'warning',
				scope: { kind: 'source', id: source.sourceId },
				data: { frameCount: source.frameCount },
				message: 'No clip references this source, so nothing was written and nothing was removed.',
			});
			continue;
		}
		if (source.wholeSourceRetained) {
			results.push(result(source, 'whole-source-retained', null, trimMediaRetainedRuns(source)));
			addDeliveryReportItem(draft, {
				code: 'trim.source-whole',
				disposition: 'preserved',
				severity: 'info',
				scope: { kind: 'source', id: source.sourceId },
				data: { frameCount: source.frameCount },
				message: 'Every frame is referenced, so rewriting this source would only copy it.',
			});
			continue;
		}
		if (linked.has(source.sourceId)) {
			results.push(result(source, 'linked-original-refused', null, trimMediaRetainedRuns(source)));
			addDeliveryReportItem(draft, {
				code: 'trim.linked-original-refused',
				disposition: 'omitted',
				severity: 'warning',
				scope: { kind: 'source', id: source.sourceId },
				data: { discardedFrames: source.discardedFrames },
				message: 'This source is an external file, which is never rewritten; consolidate it first to trim it.',
			});
			completed += 1;
			options.onProgress?.(Object.freeze({ completed, total: candidates.length }));
			continue;
		}

		// One source failing is a finding about that source, not the end of the
		// run: a storage error partway through must not undo the sources already
		// trimmed and rebound.
		let outcome: TrimMediaSourceResult;
		try {
			outcome = (await trimOne(source, ports, options, draft)).result;
		} catch (error) {
			// Cancellation is not a per-source failure: the user stopped the run.
			assertReady(options);
			outcome = result(source, 'write-failed', null, trimMediaRetainedRuns(source));
			addDeliveryReportItem(draft, {
				code: 'trim.write-failed',
				disposition: 'missing',
				severity: 'error',
				scope: { kind: 'source', id: source.sourceId },
				data: { reason: errorText(error) },
				message: 'This source could not be trimmed, so it is unchanged.',
			});
		}
		results.push(outcome);
		if (outcome.outcome === 'trimmed') {
			trimmedSources += 1;
			discardedFrames += source.discardedFrames;
		}
		completed += 1;
		options.onProgress?.(Object.freeze({ completed, total: candidates.length }));
	}

	return Object.freeze({
		sources: Object.freeze(results),
		trimmedSources,
		discardedFrames,
		// Nothing here removes the pre-trim bytes, so an undo still has something
		// to restore. A caller that later reclaims them owns that statement.
		undoable: true,
		report: sealDeliveryReport(draft),
	});
}

async function trimOne(
	source: TrimMediaSourcePlan,
	ports: TrimMediaPorts,
	options: TrimMediaOperationOptions,
	draft: ReturnType<typeof createDeliveryReport>,
): Promise<Readonly<{ result: TrimMediaSourceResult }>> {
	const signalOptions = Object.freeze(options.signal ? { signal: options.signal } : {});
	const requested = trimMediaRetainedRuns(source);
	const copy = await ports.writeTrimmedCopy(source, requested, signalOptions);
	assertReady(options);

	// What the copy holds, which may legitimately be more than was asked for.
	const written = copy.runs && copy.runs.length > 0 ? copy.runs : requested;
	const runs = trimMediaRunsFromRanges(written);
	const writtenFrames = runs.reduce((sum, run) => sum + (run.endFrame - run.startFrame), 0);

	// The one thing that must never happen quietly: a frame the plan proved was
	// referenced is not in the copy. Keeping more than was asked for is fine and
	// is what a keyframe-aligned cut does; keeping less is the failure. The
	// frame count is checked against what the copy says it holds, because a
	// writer that widened one run and dropped another would otherwise present a
	// plausible total.
	if (copy.frameCount !== writtenFrames || !trimMediaRangesCover(written, source.retained)) {
		await ports.discardTrimmedCopy(copy.storageKey, signalOptions);
		addDeliveryReportItem(draft, {
			code: 'trim.frame-count-mismatch',
			disposition: 'missing',
			severity: 'error',
			scope: { kind: 'source', id: source.sourceId },
			data: { expectedFrames: writtenFrames, actualFrames: copy.frameCount, retainedFrames: source.retainedFrames },
			message: 'The trimmed copy does not contain the frames the plan retained, so it was discarded.',
		});
		return Object.freeze({ result: result(source, 'frame-count-mismatch', null, requested) });
	}

	const rebound = await ports.rebind(Object.freeze({
		sourceId: source.sourceId,
		storageKey: copy.storageKey,
		frameCount: copy.frameCount,
		byteLength: copy.byteLength,
		runs,
	}), signalOptions);
	if (!rebound) {
		await ports.discardTrimmedCopy(copy.storageKey, signalOptions);
		addDeliveryReportItem(draft, {
			code: 'trim.rebind-superseded',
			disposition: 'omitted',
			severity: 'warning',
			scope: { kind: 'source', id: source.sourceId },
			data: {},
			message: 'The source changed while it was being trimmed, so the trimmed copy was discarded.',
		});
		return Object.freeze({ result: result(source, 'rebind-superseded', null, runs) });
	}

	addDeliveryReportItem(draft, {
		code: 'trim.source-trimmed',
		disposition: 'converted',
		severity: 'info',
		scope: { kind: 'source', id: source.sourceId },
		data: {
			retainedFrames: source.retainedFrames,
			discardedFrames: source.discardedFrames,
			ranges: runs.length,
			byteLength: copy.byteLength,
		},
		message: 'Only the referenced ranges, plus handles, were written; the pre-trim copy is left in place.',
	});
	return Object.freeze({
		result: result(source, 'trimmed', copy.storageKey, runs, copy),
	});
}

function result(
	source: TrimMediaSourcePlan,
	outcome: TrimMediaOutcome,
	storageKey: string | null,
	runs: readonly TrimMediaRetainedRun[],
	copy: Readonly<{ frameCount: number; byteLength: number }> | null = null,
): TrimMediaSourceResult {
	return Object.freeze({
		sourceId: source.sourceId,
		outcome,
		storageKey,
		retainedFrames: source.retainedFrames,
		discardedFrames: source.discardedFrames,
		runs,
		writtenFrames: copy?.frameCount ?? null,
		byteLength: copy?.byteLength ?? null,
	});
}

function errorText(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function assertReady(options: TrimMediaOperationOptions): void {
	if (options.signal?.aborted) throw options.signal.reason ?? abortError();
	options.assertCurrent?.();
}

function abortError(): Error {
	return typeof DOMException === 'function'
		? new DOMException('The operation was aborted.', 'AbortError')
		: Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' });
}
