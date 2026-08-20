/* SPDX-License-Identifier: AGPL-3.0-only */

const KEY_PREFIX = 'capture-spool-tail-cleanup-v1:';

export interface CaptureSpoolTailCleanupIdentity {
	readonly storageKind: 'encoded-media' | 'raw-pcm';
	readonly projectId: string;
	readonly spoolId: string;
	readonly spoolToken: string;
	readonly sourceId: string | null;
	readonly firstIndex: number;
}

interface CaptureSpoolTailCleanupV1 extends CaptureSpoolTailCleanupIdentity {
	readonly version: 1;
	readonly kind: 'capture-spool-tail-cleanup';
}

interface CaptureSpoolTailCleanupKeyValuePort {
	get(key: string): PromiseLike<unknown> | unknown;
	putIfAbsent(key: string, value: unknown): PromiseLike<boolean> | boolean;
	replaceIfCurrentAndPutIfAbsent?(
		key: string, expected: unknown, replacement: unknown, intentKey: string, intent: unknown,
	): PromiseLike<boolean> | boolean;
	deleteIfCurrent(key: string, expected: unknown): PromiseLike<boolean> | boolean;
}

/** Atomically move spool metadata backward while publishing the exact physical-tail retry intent. */
export async function prepareCaptureSpoolTailCleanup(
	values: CaptureSpoolTailCleanupKeyValuePort,
	identityValue: CaptureSpoolTailCleanupIdentity,
	metadataKeyValue: string,
	expectedMetadata: unknown,
	replacementMetadata: unknown,
): Promise<boolean> {
	const intent = tailCleanup(identityValue);
	const metadataKey = stableText(metadataKeyValue, 'capture spool metadata key', 1_024);
	const intentKey = tailCleanupKey(intent);
	if (metadataKey === intentKey) throw new Error('Capture spool tail cleanup needs a distinct metadata key.');
	const prepare = values.replaceIfCurrentAndPutIfAbsent;
	if (typeof prepare !== 'function') throw new TypeError('Capture spool tail cleanup requires atomic durable intent.');
	try {
		if (await prepare.call(
			values, metadataKey, expectedMetadata, replacementMetadata, intentKey, intent,
		)) return true;
	} catch (error) {
		if (!await tailPrepared(values, metadataKey, replacementMetadata, intent)) throw error;
		return true;
	}
	if (await tailPrepared(values, metadataKey, replacementMetadata, intent)) return true;
	if (!sameData(await values.get(metadataKey), replacementMetadata)) return false;
	try {
		if (await values.putIfAbsent(intentKey, intent)) return true;
	} catch (error) {
		if (!sameData(await values.get(intentKey), intent)) throw error;
		return true;
	}
	return sameData(await values.get(intentKey), intent);
}

/** Drain and retire one exact durable tail intent; missing intent is an idempotent success. */
export async function recoverCaptureSpoolTailCleanup(
	values: CaptureSpoolTailCleanupKeyValuePort,
	identityValue: CaptureSpoolTailCleanupIdentity,
	deleteTail: (firstIndex: number) => Promise<void>,
): Promise<void> {
	const expected = tailCleanup(identityValue);
	const key = tailCleanupKey(expected);
	const value = await values.get(key);
	if (value == null) return;
	const current = normalizeTailCleanup(value);
	if (!sameData(current, expected)) throw new Error('Capture spool tail cleanup ownership changed.');
	await deleteTail(current.firstIndex);
	try {
		if (await values.deleteIfCurrent(key, current)) return;
	} catch (error) {
		if (await values.get(key) != null) throw error;
		return;
	}
	if (await values.get(key) != null) throw new Error('Capture spool tail cleanup changed before retirement.');
}

async function tailPrepared(
	values: CaptureSpoolTailCleanupKeyValuePort,
	metadataKey: string,
	replacementMetadata: unknown,
	intent: CaptureSpoolTailCleanupV1,
): Promise<boolean> {
	return sameData(await values.get(metadataKey), replacementMetadata)
		&& sameData(await values.get(tailCleanupKey(intent)), intent);
}

function tailCleanup(value: CaptureSpoolTailCleanupIdentity): CaptureSpoolTailCleanupV1 {
	return Object.freeze({
		version: 1,
		kind: 'capture-spool-tail-cleanup',
		storageKind: value.storageKind,
		projectId: stableText(value.projectId, 'capture spool tail projectId', 256),
		spoolId: stableText(value.spoolId, 'capture spool tail spoolId', 256),
		spoolToken: stableText(value.spoolToken, 'capture spool tail token', 512),
		sourceId: value.sourceId === null ? null : stableText(value.sourceId, 'capture spool tail sourceId', 256),
		firstIndex: nonNegativeInteger(value.firstIndex, 'capture spool tail index'),
	});
}

function normalizeTailCleanup(value: unknown): CaptureSpoolTailCleanupV1 {
	const keys = ['version', 'kind', 'storageKind', 'projectId', 'spoolId', 'spoolToken', 'sourceId', 'firstIndex'];
	const record = closedDataRecord(value, keys, 'capture spool tail cleanup');
	if (record.version !== 1 || record.kind !== 'capture-spool-tail-cleanup'
		|| (record.storageKind !== 'encoded-media' && record.storageKind !== 'raw-pcm')) {
		throw new Error('Capture spool tail cleanup is invalid.');
	}
	return tailCleanup(record as unknown as CaptureSpoolTailCleanupIdentity);
}

function tailCleanupKey(value: CaptureSpoolTailCleanupIdentity): string {
	return `${KEY_PREFIX}${value.storageKind}:${encodeURIComponent(value.projectId)}:${encodeURIComponent(value.spoolId)}`;
}

function closedDataRecord(value: unknown, keys: readonly string[], name: string): Readonly<Record<string, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
		|| Reflect.ownKeys(value).length !== keys.length) throw new TypeError(`${name} must be a closed data record.`);
	const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
	for (const key of Reflect.ownKeys(value)) {
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (typeof key !== 'string' || !keys.includes(key) || !descriptor?.enumerable
			|| !Object.hasOwn(descriptor, 'value')) throw new TypeError(`${name} has an invalid closed shape.`);
		result[key] = descriptor.value;
	}
	if (keys.some((key) => !Object.hasOwn(result, key))) throw new TypeError(`${name} has an invalid closed shape.`);
	return Object.freeze(result);
}

function stableText(value: unknown, name: string, maximumLength: number): string {
	if (typeof value !== 'string' || !value.length || value !== value.trim()
		|| value !== value.normalize('NFC') || value.length > maximumLength
		|| /[\u0000-\u001f\u007f]/u.test(value)) throw new TypeError(`${name} is invalid.`);
	return value;
}

function nonNegativeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) throw new RangeError(`${name} must be non-negative.`);
	return Number(value);
}

function sameData(left: unknown, right: unknown): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}
