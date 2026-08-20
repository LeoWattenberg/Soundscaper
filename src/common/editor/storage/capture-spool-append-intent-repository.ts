/* SPDX-License-Identifier: AGPL-3.0-only */

const KEY_PREFIX = 'framescaper-capture-spool-append-intent-v1:';

export type CaptureSpoolAppendStorageKind = 'encoded-media' | 'raw-pcm';

export interface CaptureSpoolAppendIdentity {
	readonly storageKind: CaptureSpoolAppendStorageKind;
	readonly projectId: string;
	readonly spoolId: string;
	readonly spoolToken: string;
	readonly sourceId: string | null;
}

export interface CaptureSpoolAppendIntent<Snapshot> extends CaptureSpoolAppendIdentity {
	readonly version: 1;
	readonly kind: 'framescaper-capture-spool-append-intent';
	readonly operationId: string;
	readonly firstIndex: number;
	readonly previous: Snapshot;
	readonly next: Snapshot;
}

export interface CaptureSpoolAppendIntentValues {
	get(key: string): PromiseLike<unknown> | unknown;
	putIfAbsentWhenCurrent?(
		fenceKey: string, expectedFence: unknown, key: string, value: unknown,
	): PromiseLike<boolean> | boolean;
	replaceIfCurrentWhenCurrent?(
		fenceKey: string, expectedFence: unknown,
		key: string, expected: unknown, replacement: unknown,
	): PromiseLike<boolean> | boolean;
	deleteIfCurrent(key: string, expected: unknown): PromiseLike<boolean> | boolean;
}

export async function prepareCaptureSpoolAppendIntent<Snapshot>(
	values: CaptureSpoolAppendIntentValues,
	identityValue: CaptureSpoolAppendIdentity,
	firstIndexValue: number,
	metadataKey: string,
	currentMetadata: unknown,
	previous: Snapshot,
	next: Snapshot,
	normalizeSnapshot: (value: unknown) => Snapshot,
): Promise<CaptureSpoolAppendIntent<Snapshot>> {
	const identity = normalizeIdentity(identityValue);
	const intent = freezeIntent(identity, createId(), firstIndexValue, previous, next);
	const put = values.putIfAbsentWhenCurrent;
	if (typeof put !== 'function') {
		throw new Error('Capture spool pre-write append fencing requires atomic conditional intent creation.');
	}
	try {
		if (await put.call(values, metadataKey, currentMetadata, appendIntentKey(identity), intent)) return intent;
	} catch (error) {
		const observed = await loadCaptureSpoolAppendIntent(values, identity, normalizeSnapshot);
		if (observed && sameData(observed, intent) && sameData(await values.get(metadataKey), currentMetadata)) {
			return observed;
		}
		throw error;
	}
	await loadCaptureSpoolAppendIntent(values, identity, normalizeSnapshot);
	throw new Error('Capture spool changed before its pre-write append intent was durable.');
}

export async function loadCaptureSpoolAppendIntent<Snapshot>(
	values: Pick<CaptureSpoolAppendIntentValues, 'get'>,
	identityValue: CaptureSpoolAppendIdentity,
	normalizeSnapshot: (value: unknown) => Snapshot,
): Promise<CaptureSpoolAppendIntent<Snapshot> | null> {
	const identity = normalizeIdentity(identityValue);
	const value = await values.get(appendIntentKey(identity));
	if (value === undefined || value === null) return null;
	const record = exactDataRecord(value, [
		'version', 'kind', 'operationId', 'storageKind', 'projectId', 'spoolId', 'spoolToken', 'sourceId',
		'firstIndex', 'previous', 'next',
	], 'capture spool append intent');
	if (record.version !== 1 || record.kind !== 'framescaper-capture-spool-append-intent') {
		throw new Error('Capture spool append intent version or kind is invalid.');
	}
	const observedIdentity = normalizeIdentity(record as unknown as CaptureSpoolAppendIdentity);
	if (!sameData(observedIdentity, identity)) throw new Error('Capture spool append intent ownership changed.');
	assertCanonicalData(record.previous, 'capture spool append previous snapshot');
	assertCanonicalData(record.next, 'capture spool append next snapshot');
	return freezeIntent(
		observedIdentity,
		stableId(record.operationId, 'capture spool append operationId'),
		nonNegativeInteger(record.firstIndex, 'capture spool append first index'),
		normalizeSnapshot(record.previous),
		normalizeSnapshot(record.next),
	);
}

export async function removeCaptureSpoolAppendIntent<Snapshot>(
	values: CaptureSpoolAppendIntentValues,
	intent: CaptureSpoolAppendIntent<Snapshot>,
): Promise<void> {
	const key = appendIntentKey(intent);
	try {
		if (await values.deleteIfCurrent(key, intent)) return;
	} catch (error) {
		if (await values.get(key) == null) return;
		throw error;
	}
	if (await values.get(key) == null) return;
	throw new Error('Capture spool append intent ownership changed before retirement.');
}

export function captureSpoolAppendIntentKey(value: CaptureSpoolAppendIdentity): string {
	return appendIntentKey(normalizeIdentity(value));
}

function freezeIntent<Snapshot>(
	identity: CaptureSpoolAppendIdentity,
	operationIdValue: string,
	firstIndexValue: number,
	previous: Snapshot,
	next: Snapshot,
): CaptureSpoolAppendIntent<Snapshot> {
	return Object.freeze({
		version: 1,
		kind: 'framescaper-capture-spool-append-intent',
		...identity,
		operationId: stableId(operationIdValue, 'capture spool append operationId'),
		firstIndex: nonNegativeInteger(firstIndexValue, 'capture spool append first index'),
		previous,
		next,
	});
}

function normalizeIdentity(value: CaptureSpoolAppendIdentity): CaptureSpoolAppendIdentity {
	const storageKind = value?.storageKind;
	if (storageKind !== 'encoded-media' && storageKind !== 'raw-pcm') {
		throw new TypeError('Capture spool append storage kind is invalid.');
	}
	const sourceId = value.sourceId === null ? null : stableId(value.sourceId, 'capture spool append sourceId');
	if ((storageKind === 'encoded-media') !== (sourceId !== null)) {
		throw new Error('Capture spool append source ownership is invalid.');
	}
	return Object.freeze({
		storageKind,
		projectId: stableId(value.projectId, 'capture spool append projectId'),
		spoolId: stableId(value.spoolId, 'capture spool append spoolId'),
		spoolToken: stableText(value.spoolToken, 'capture spool append token', 512),
		sourceId,
	});
}

function appendIntentKey(value: CaptureSpoolAppendIdentity): string {
	return `${KEY_PREFIX}${value.storageKind}:${encodeURIComponent(value.projectId)}:${encodeURIComponent(value.spoolId)}`;
}

function exactDataRecord(value: unknown, keys: readonly string[], name: string): Readonly<Record<string, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
		throw new TypeError(`${name} must be a data record.`);
	}
	const record = value as Readonly<Record<string, unknown>>;
	const descriptors = Object.getOwnPropertyDescriptors(record);
	const observed = Reflect.ownKeys(descriptors);
	if (observed.some((key) => typeof key !== 'string')
		|| observed.length !== keys.length || keys.some((key) => {
			const descriptor = descriptors[key];
			return !descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value');
		})) {
		throw new Error(`${name} schema is invalid.`);
	}
	return record;
}

function assertCanonicalData(value: unknown, name: string): void {
	if (value === null || typeof value === 'string' || typeof value === 'boolean'
		|| (typeof value === 'number' && Number.isFinite(value))) return;
	if (Array.isArray(value)) {
		const descriptors = Object.getOwnPropertyDescriptors(value);
		const keys = Reflect.ownKeys(descriptors);
		if (keys.length !== value.length + 1 || !Object.hasOwn(descriptors, 'length')) {
			throw new Error(`${name} contains non-canonical array properties.`);
		}
		for (let index = 0; index < value.length; index += 1) {
			const descriptor = descriptors[String(index)];
			if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
				throw new Error(`${name} contains a sparse or non-data array element.`);
			}
			assertCanonicalData(descriptor.value, name);
		}
		return;
	}
	if (!value || typeof value !== 'object'
		|| (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
		throw new TypeError(`${name} contains non-canonical data.`);
	}
	const descriptors = Object.getOwnPropertyDescriptors(value);
	for (const key of Reflect.ownKeys(descriptors)) {
		if (typeof key !== 'string') throw new Error(`${name} contains a non-data property.`);
		const descriptor = descriptors[key];
		if (!descriptor || descriptor.enumerable !== true
			|| !Object.hasOwn(descriptor, 'value')) throw new Error(`${name} contains a non-data property.`);
		assertCanonicalData(descriptor.value, name);
	}
}

function stableId(value: unknown, name: string): string { return stableText(value, name, 256); }
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
function sameData(left: unknown, right: unknown): boolean { return JSON.stringify(left) === JSON.stringify(right); }
function createId(): string {
	return globalThis.crypto?.randomUUID?.()
		?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
