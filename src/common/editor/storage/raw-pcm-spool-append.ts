/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	captureSpoolAppendIntentKey,
	loadCaptureSpoolAppendIntent,
	prepareCaptureSpoolAppendIntent,
	removeCaptureSpoolAppendIntent,
	type CaptureSpoolAppendIntent,
	type CaptureSpoolAppendIntentValues,
} from './capture-spool-append-intent-repository.ts';
import type { RawPcmSpoolRecord } from './raw-pcm-spool-repository.ts';
import { withCaptureSpoolOperationLock } from './capture-spool-operation-lock.ts';

type RawAppendValues = CaptureSpoolAppendIntentValues;

interface RawAppendChunks {
	deleteChunksFrom?(token: string, firstIndex: number): PromiseLike<void> | void;
}

export interface RawPcmAcknowledgedPrefix {
	readonly frameCount: number;
	readonly chunkCount: number;
}

export async function prepareRawPcmAppend(
	values: CaptureSpoolAppendIntentValues,
	previous: RawPcmSpoolRecord,
	next: RawPcmSpoolRecord,
	registryKey: string,
	currentRegistry: unknown,
	normalizeRecord: (value: unknown) => RawPcmSpoolRecord,
): Promise<CaptureSpoolAppendIntent<RawPcmSpoolRecord>> {
	await assertNoPendingRawPcmAppend(values, previous, normalizeRecord);
	if (typeof values.replaceIfCurrentWhenCurrent !== 'function') {
		throw new Error('Raw PCM append commit requires an atomic exact intent fence.');
	}
	return prepareCaptureSpoolAppendIntent(
		values, identity(previous), previous.chunkCount, registryKey, currentRegistry,
		previous, next, normalizeRecord,
	);
}

export async function commitRawPcmAppendMetadata(
	values: RawAppendValues,
	intent: CaptureSpoolAppendIntent<RawPcmSpoolRecord>,
	registryKey: string,
	currentRegistry: unknown,
	nextRegistry: unknown,
	next: RawPcmSpoolRecord,
	normalizeRecord: (value: unknown) => RawPcmSpoolRecord,
	loadRecord: (registryValue: unknown) => RawPcmSpoolRecord | null,
): Promise<void> {
	const replace = values.replaceIfCurrentWhenCurrent!;
	try {
		if (await replace.call(
			values, captureSpoolAppendIntentKey(intent), intent,
			registryKey, currentRegistry, nextRegistry,
		)) return;
	} catch (error) {
		if (await metadataCommitObserved(values, intent, registryKey, next, normalizeRecord, loadRecord)) return;
		throw error;
	}
	if (await metadataCommitObserved(values, intent, registryKey, next, normalizeRecord, loadRecord)) return;
	throw new Error('Raw PCM spool ownership changed after its chunk became an inventoried removable tail.');
}

/** Clean a stopped body write, but retain a registry-committed intent for manifest reconciliation. */
export async function recoverRawPcmAppendBeforeLoad(
	values: CaptureSpoolAppendIntentValues,
	chunks: RawAppendChunks,
	observed: RawPcmSpoolRecord,
	normalizeRecord: (value: unknown) => RawPcmSpoolRecord,
	loadCurrent: () => Promise<RawPcmSpoolRecord | null>,
	recoverTail: (current: RawPcmSpoolRecord) => Promise<void>,
): Promise<RawPcmSpoolRecord | null> {
	return withCaptureSpoolOperationLock(identity(observed), async () => {
		const current = await recoverRawPcmAppendWhileLocked(
			values, chunks, observed, normalizeRecord, loadCurrent,
		);
		if (current) await recoverTail(current);
		return current;
	});
}

export async function recoverRawPcmAppendWhileLocked(
	values: CaptureSpoolAppendIntentValues,
	chunks: RawAppendChunks,
	observed: RawPcmSpoolRecord,
	normalizeRecord: (value: unknown) => RawPcmSpoolRecord,
	loadCurrent: () => Promise<RawPcmSpoolRecord | null>,
): Promise<RawPcmSpoolRecord | null> {
	const current = await loadCurrent();
	if (!current) return null;
	assertSameOwnership(observed, current);
	const intent = await validatedIntent(values, current, normalizeRecord);
	if (!intent || sameRecord(current, intent.next)) return current;
	if (!sameRecord(current, intent.previous)) {
		throw new Error('Raw PCM append intent disagrees with durable spool metadata.');
	}
	if (!chunks.deleteChunksFrom) throw new Error('Raw PCM partial append cleanup is unavailable.');
	await chunks.deleteChunksFrom(current.spoolToken, intent.firstIndex);
	await removeCaptureSpoolAppendIntent(values, intent);
	return current;
}

export async function reconcileRawPcmAppend(
	values: CaptureSpoolAppendIntentValues,
	observed: RawPcmSpoolRecord,
	prefix: RawPcmAcknowledgedPrefix,
	normalizeRecord: (value: unknown) => RawPcmSpoolRecord,
	loadCurrent: () => Promise<RawPcmSpoolRecord | null>,
	rollback: (current: RawPcmSpoolRecord, previous: RawPcmSpoolRecord) => Promise<RawPcmSpoolRecord>,
): Promise<RawPcmSpoolRecord> {
	const decision = await withCaptureSpoolOperationLock(identity(observed), async () => {
		const current = await loadCurrent();
		if (!current) throw new Error('Raw PCM spool disappeared during append reconciliation.');
		assertSameOwnership(observed, current);
		const intent = await validatedIntent(values, current, normalizeRecord);
		if (!intent) {
			if (!prefixMatches(current, prefix)) {
				throw new Error('Raw PCM spool does not match its durable manifest prefix.');
			}
			return Object.freeze({ current, previous: null });
		}
		if (!sameRecord(current, intent.next)) {
			throw new Error('Raw PCM append intent was not cleaned before manifest reconciliation.');
		}
		if (prefixMatches(intent.next, prefix)) {
			await removeCaptureSpoolAppendIntent(values, intent);
			return Object.freeze({ current, previous: null });
		}
		if (prefixMatches(intent.previous, prefix)) {
			return Object.freeze({ current, previous: intent.previous });
		}
		throw new Error('Raw PCM manifest is outside the exact append-intent transition.');
	});
	if (!decision.previous) return decision.current;
	const restored = await rollback(decision.current, decision.previous);
	if (!sameRecord(restored, decision.previous)) throw new Error('Raw PCM append rollback changed evidence.');
	return restored;
}

export async function assertNoPendingRawPcmAppend(
	values: CaptureSpoolAppendIntentValues,
	current: RawPcmSpoolRecord,
	normalizeRecord: (value: unknown) => RawPcmSpoolRecord,
): Promise<void> {
	const intent = await validatedIntent(values, current, normalizeRecord);
	if (!intent) return;
	throw new Error('A raw PCM append remains pending durable manifest reconciliation.');
}

async function metadataCommitObserved(
	values: RawAppendValues,
	intent: CaptureSpoolAppendIntent<RawPcmSpoolRecord>,
	registryKey: string,
	next: RawPcmSpoolRecord,
	normalizeRecord: (value: unknown) => RawPcmSpoolRecord,
	loadRecord: (registryValue: unknown) => RawPcmSpoolRecord | null,
): Promise<boolean> {
	if (!sameObservedRecord(await values.get(registryKey), next, loadRecord)) return false;
	const observed = await loadCaptureSpoolAppendIntent(values, identity(next), normalizeRecord);
	return observed !== null && observed.operationId === intent.operationId
		&& sameRecord(observed.previous, intent.previous) && sameRecord(observed.next, intent.next);
}

async function validatedIntent(
	values: Pick<CaptureSpoolAppendIntentValues, 'get'>,
	current: RawPcmSpoolRecord,
	normalizeRecord: (value: unknown) => RawPcmSpoolRecord,
): Promise<CaptureSpoolAppendIntent<RawPcmSpoolRecord> | null> {
	const intent = await loadCaptureSpoolAppendIntent(values, identity(current), normalizeRecord);
	if (!intent) return null;
	assertSameOwnership(intent.previous, intent.next);
	assertSameOwnership(current, intent.previous);
	if (intent.firstIndex !== intent.previous.chunkCount
		|| intent.previous.state !== 'capturing' || intent.next.state !== 'capturing'
		|| intent.next.chunkCount !== intent.previous.chunkCount + 1
		|| intent.next.frameCount <= intent.previous.frameCount
		|| intent.next.frameCount > intent.previous.frameCount + intent.previous.chunkFrames) {
		throw new Error('Raw PCM append intent geometry is invalid.');
	}
	return intent;
}

function identity(record: RawPcmSpoolRecord) {
	return Object.freeze({
		storageKind: 'raw-pcm' as const,
		projectId: record.projectId,
		spoolId: record.spoolId,
		spoolToken: record.spoolToken,
		sourceId: null,
	});
}
function prefixMatches(record: RawPcmSpoolRecord, prefix: RawPcmAcknowledgedPrefix): boolean {
	return record.frameCount === prefix.frameCount && record.chunkCount === prefix.chunkCount;
}
function assertSameOwnership(left: RawPcmSpoolRecord, right: RawPcmSpoolRecord): void {
	for (const key of [
		'version', 'projectId', 'spoolId', 'spoolToken', 'sampleRate', 'channelCount', 'chunkFrames', 'appendProtocol',
	] as const) {
		if (left[key] !== right[key]) throw new Error(`Raw PCM append intent changed ${key}.`);
	}
}
function sameObservedRecord(
	value: unknown,
	expected: RawPcmSpoolRecord,
	loadRecord: (registryValue: unknown) => RawPcmSpoolRecord | null,
): boolean {
	if (value === undefined || value === null) return false;
	try {
		const observed = loadRecord(value);
		return observed !== null && sameRecord(observed, expected);
	} catch { return false; }
}
function sameRecord(left: RawPcmSpoolRecord, right: RawPcmSpoolRecord): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}
