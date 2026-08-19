/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Running a consolidate plan: copying linked originals into managed storage.
 *
 * The plan decides what to copy; this decides nothing and only carries it out,
 * in the one order that is safe to be interrupted in. Every source is copied,
 * then verified, then rebound — never rebound first — because a process that
 * dies between the copy and the rebind leaves a project still pointing at its
 * original and an unreferenced managed copy behind it. That is garbage to
 * collect, never a project that lost its media. The reverse order would put a
 * rebind in front of bytes that might not be there.
 *
 * Verification is end to end and deliberately doubled. The original is digested
 * as it streams past, and the managed copy is read back and digested again:
 * the first catches an original that has changed since it was bound, the second
 * catches storage that accepted bytes and returned different ones. Either is a
 * refusal to rebind, not a warning beside a rebind that happened anyway.
 *
 * There is no port here that could delete an original. The
 * `m2-linked-media-lifecycle` acceptance is binding, so rather than writing the
 * rule down and trusting callers, this module simply has no way to express it.
 */

import {
	type DeliveryReport,
	addDeliveryReportItem,
	createDeliveryReport,
	sealDeliveryReport,
} from './delivery-report.ts';
import type { ConsolidatePlan, ConsolidateSourcePlan } from './consolidate-plan.ts';
import { createScapeDigest, scapeHex } from './scape-archive-media.ts';

export type ConsolidateOutcome =
	| 'copied'
	| 'original-changed'
	| 'copy-corrupt'
	| 'rebind-superseded'
	| 'copy-failed'
	| 'unreachable';

export interface ConsolidateSourceResult {
	readonly sourceId: string;
	readonly outcome: ConsolidateOutcome;
	/** The managed key the bytes now live under, or null when nothing was kept. */
	readonly storageKey: string | null;
	readonly byteLength: number;
	readonly sha256: string | null;
}

export interface ConsolidateRunResult {
	/** True only when every planned copy was verified and rebound. */
	readonly complete: boolean;
	readonly sources: readonly ConsolidateSourceResult[];
	readonly copiedByteLength: number;
	readonly report: DeliveryReport;
}

export interface ConsolidateManagedCopy {
	readonly storageKey: string;
	readonly byteLength: number;
}

export interface ConsolidateOperationOptions {
	readonly signal?: AbortSignal;
	readonly assertCurrent?: () => void;
	readonly onProgress?: (progress: Readonly<{ completed: number; total: number }>) => void;
}

/**
 * Everything this operation is allowed to do to the outside world.
 *
 * Notably absent: any way to remove, move, or rewrite a linked original.
 */
export interface ConsolidatePorts {
	/** Stream a linked original's bytes in bounded chunks. */
	readOriginal(
		source: ConsolidateSourcePlan,
		options: Readonly<{ signal?: AbortSignal }>,
	): AsyncIterable<Uint8Array>;
	/** Write those chunks into managed storage and answer where they landed. */
	writeManaged(
		source: ConsolidateSourcePlan,
		chunks: AsyncIterable<Uint8Array>,
		options: Readonly<{ signal?: AbortSignal }>,
	): Promise<ConsolidateManagedCopy>;
	/** Read a managed copy back, so the verification is of stored bytes. */
	readManaged(
		storageKey: string,
		options: Readonly<{ signal?: AbortSignal }>,
	): AsyncIterable<Uint8Array>;
	/** Rebind the source, presenting the compare-and-swap fence the plan carries. */
	rebind(
		request: Readonly<{
			sourceId: string;
			storageKey: string;
			byteLength: number;
			sha256: string;
			expectedBindingToken: string;
		}>,
		options: Readonly<{ signal?: AbortSignal }>,
	): Promise<boolean>;
	/** Drop a managed copy that must not be kept. Never touches the original. */
	discardManaged(
		storageKey: string,
		options: Readonly<{ signal?: AbortSignal }>,
	): Promise<void>;
}

export async function runConsolidate(
	plan: ConsolidatePlan,
	ports: ConsolidatePorts,
	options: ConsolidateOperationOptions = {},
): Promise<ConsolidateRunResult> {
	if (!plan || typeof plan !== 'object') throw new TypeError('A consolidate run requires a plan.');
	const draft = createDeliveryReport({
		format: 'consolidate', container: null, codec: null,
		sampleRate: null, channelCount: null, lossless: null,
	});
	const results: ConsolidateSourceResult[] = [];
	const total = plan.copy.length;
	let completed = 0;
	let copiedByteLength = 0;

	for (const source of plan.unreachable) {
		results.push(Object.freeze({
			sourceId: source.sourceId,
			outcome: 'unreachable' as const,
			storageKey: null,
			byteLength: 0,
			sha256: null,
		}));
		addDeliveryReportItem(draft, {
			code: 'consolidate.original-unreachable',
			disposition: 'missing',
			severity: 'error',
			scope: { kind: 'source', id: source.sourceId },
			data: { byteLength: source.byteLength },
			message: 'The linked original could not be read, so this source was not consolidated.',
		});
	}

	for (const source of plan.copy) {
		assertReady(options);
		// One source failing is a finding about that source, not the end of the
		// run. The plan already consolidates what it can reach and itemises the
		// rest; a storage error partway through must be itemised the same way,
		// or a single unreadable file would undo everything already copied.
		let result: ConsolidateSourceResult;
		try {
			result = await consolidateOne(source, ports, options, draft);
		} catch (error) {
			// Cancellation is not a per-source failure: the user stopped the run.
			assertReady(options);
			result = frozen(source.sourceId, 'copy-failed', null, 0, null);
			addDeliveryReportItem(draft, {
				code: 'consolidate.copy-failed',
				disposition: 'missing',
				severity: 'error',
				scope: { kind: 'source', id: source.sourceId },
				data: { reason: errorText(error) },
				message: 'This source could not be copied into managed storage.',
			});
		}
		results.push(result);
		if (result.outcome === 'copied') copiedByteLength += result.byteLength;
		completed += 1;
		options.onProgress?.(Object.freeze({ completed, total }));
	}

	const complete = plan.complete && results.every((result) => result.outcome === 'copied');
	if (!complete) {
		addDeliveryReportItem(draft, {
			code: 'consolidate.incomplete',
			disposition: 'missing',
			severity: 'error',
			data: {
				copied: results.filter((result) => result.outcome === 'copied').length,
				failed: results.filter((result) => result.outcome !== 'copied').length,
			},
			message: 'Some sources were not consolidated, so this project is not fully self-contained.',
		});
	}
	return Object.freeze({
		complete,
		sources: Object.freeze(results),
		copiedByteLength,
		report: sealDeliveryReport(draft),
	});
}

async function consolidateOne(
	source: ConsolidateSourcePlan,
	ports: ConsolidatePorts,
	options: ConsolidateOperationOptions,
	draft: ReturnType<typeof createDeliveryReport>,
): Promise<ConsolidateSourceResult> {
	const expectedDigest = source.sha256;
	const expectedToken = source.bindingToken;
	if (!expectedDigest || !expectedToken) {
		throw new TypeError(`Consolidating ${source.sourceId} requires its recorded digest and binding token.`);
	}
	const signalOptions = Object.freeze(options.signal ? { signal: options.signal } : {});
	const originalDigest = createScapeDigest();
	let originalByteLength = 0;
	const witnessed = async function* (): AsyncIterable<Uint8Array> {
		for await (const chunk of ports.readOriginal(source, signalOptions)) {
			assertReady(options);
			originalDigest.update(chunk);
			originalByteLength += chunk.byteLength;
			yield chunk;
		}
	};
	const copy = await ports.writeManaged(source, witnessed(), signalOptions);
	assertReady(options);
	const readDigest = scapeHex(originalDigest.digest());

	// The original changed after it was bound. Rebinding would quietly swap the
	// project's media for a different file, so nothing is kept and nothing moves.
	if (readDigest !== expectedDigest || originalByteLength !== source.byteLength) {
		await ports.discardManaged(copy.storageKey, signalOptions);
		addDeliveryReportItem(draft, {
			code: 'consolidate.original-changed',
			disposition: 'missing',
			severity: 'error',
			scope: { kind: 'source', id: source.sourceId },
			data: {
				expectedSha256: expectedDigest,
				actualSha256: readDigest,
				expectedByteLength: source.byteLength,
				actualByteLength: originalByteLength,
			},
			message: 'The linked original no longer matches what was recorded for it, so it was not consolidated.',
		});
		return frozen(source.sourceId, 'original-changed', null, 0, null);
	}

	// Read the stored bytes back rather than trusting the write. Storage that
	// accepts bytes and returns different ones is the failure a digest computed
	// on the way in cannot see.
	const storedDigest = createScapeDigest();
	let storedByteLength = 0;
	for await (const chunk of ports.readManaged(copy.storageKey, signalOptions)) {
		assertReady(options);
		storedDigest.update(chunk);
		storedByteLength += chunk.byteLength;
	}
	const storedHex = scapeHex(storedDigest.digest());
	if (storedHex !== expectedDigest || storedByteLength !== source.byteLength) {
		await ports.discardManaged(copy.storageKey, signalOptions);
		addDeliveryReportItem(draft, {
			code: 'consolidate.copy-corrupt',
			disposition: 'missing',
			severity: 'error',
			scope: { kind: 'source', id: source.sourceId },
			data: {
				expectedSha256: expectedDigest,
				actualSha256: storedHex,
				expectedByteLength: source.byteLength,
				actualByteLength: storedByteLength,
			},
			message: 'The managed copy did not read back as the bytes that were written, so it was discarded.',
		});
		return frozen(source.sourceId, 'copy-corrupt', null, 0, null);
	}

	const rebound = await ports.rebind(Object.freeze({
		sourceId: source.sourceId,
		storageKey: copy.storageKey,
		byteLength: source.byteLength,
		sha256: expectedDigest,
		expectedBindingToken: expectedToken,
	}), signalOptions);
	if (!rebound) {
		// Someone else rebound this source while the copy was being made. The
		// copy is sound but no longer the one the project should point at.
		await ports.discardManaged(copy.storageKey, signalOptions);
		addDeliveryReportItem(draft, {
			code: 'consolidate.rebind-superseded',
			disposition: 'omitted',
			severity: 'warning',
			scope: { kind: 'source', id: source.sourceId },
			data: {},
			message: 'The source was rebound elsewhere while it was being copied, so this copy was discarded.',
		});
		return frozen(source.sourceId, 'rebind-superseded', null, 0, null);
	}

	addDeliveryReportItem(draft, {
		code: 'consolidate.copied',
		disposition: 'converted',
		severity: 'info',
		scope: { kind: 'source', id: source.sourceId },
		data: { byteLength: source.byteLength, sha256: expectedDigest, kind: source.kind },
		message: 'The linked original was copied into managed storage; the original file is left in place.',
	});
	return frozen(source.sourceId, 'copied', copy.storageKey, source.byteLength, expectedDigest);
}

function frozen(
	sourceId: string,
	outcome: ConsolidateOutcome,
	storageKey: string | null,
	byteLength: number,
	sha256: string | null,
): ConsolidateSourceResult {
	return Object.freeze({ sourceId, outcome, storageKey, byteLength, sha256 });
}

function assertReady(options: ConsolidateOperationOptions): void {
	if (options.signal?.aborted) throw options.signal.reason ?? abortError();
	options.assertCurrent?.();
}

function errorText(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function abortError(): Error {
	return typeof DOMException === 'function'
		? new DOMException('The operation was aborted.', 'AbortError')
		: Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' });
}
