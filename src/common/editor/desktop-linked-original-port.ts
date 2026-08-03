/* SPDX-License-Identifier: AGPL-3.0-only */

import type { DesktopReadFetch } from './desktop-read-materialization.ts';
import {
	admitDesktopLinkedAudioRange,
	type DesktopReadRelease,
} from './desktop-linked-audio-range-adapter.ts';

export type LinkedOriginalKind = 'audio' | 'video';

export interface LinkedOriginalReference {
	readonly kind: LinkedOriginalKind;
	readonly locatorId: string;
	readonly locatorRevision: string;
}

export interface LinkedOriginalSnapshot {
	readonly blob: Blob & Readonly<{ readonly name?: string }>;
	readonly locatorRevision: string;
}

export interface LinkedOriginalRangeLease {
	readonly locatorRevision: string;
	readonly byteLength: number;
	readonly mimeType: string;
	readRange(request: Readonly<{
		readonly offset: number;
		readonly length: number;
		readonly signal?: AbortSignal;
	}>): Promise<Uint8Array>;
	release(): Promise<void>;
}

export interface DesktopLinkedOriginalPort {
	load(
		kind: LinkedOriginalKind,
		locatorId: string,
		request: Readonly<{ expectedRevision: string | null; signal?: AbortSignal }>,
	): Promise<Readonly<LinkedOriginalSnapshot> | null>;
	leaseRange?(
		kind: LinkedOriginalKind,
		locatorId: string,
		request: Readonly<{ expectedRevision: string; signal?: AbortSignal }>,
	): Promise<Readonly<LinkedOriginalRangeLease> | null>;
	reconcile(references: readonly LinkedOriginalReference[]): Promise<number>;
	release(reference: LinkedOriginalReference): Promise<boolean>;
}

export interface DesktopLinkedAudioOriginalChoice {
	readonly locatorId: string;
	readonly locatorRevision: string;
	readonly name: string;
	readonly size: number;
	readonly mimeType: 'audio/aiff' | 'audio/rf64' | 'audio/wav';
	readonly lastModified: number;
	readonly file: Blob & Readonly<{ readonly name?: string }>;
}

interface MaterializedVideoPort {
	load(
		locatorId: string,
		request: Readonly<{ expectedRevision: string | null; signal?: AbortSignal }>,
	): PromiseLike<LinkedOriginalSnapshot | null> | LinkedOriginalSnapshot | null;
	leasePlayback?(
		locatorId: string,
		request: Readonly<{ expectedRevision: string; signal?: AbortSignal }>,
	): PromiseLike<LinkedOriginalRangeLease | null> | LinkedOriginalRangeLease | null;
}

interface DesktopLinkedOriginalBridge {
	chooseLinkedAudioOriginal?(): PromiseLike<unknown> | unknown;
	loadLinkedAudioOriginal?(request: Readonly<{
		locatorId: string;
		expectedRevision: string | null;
		range: boolean;
	}>): PromiseLike<unknown> | unknown;
	reconcileLinkedOriginals?(references: readonly LinkedOriginalReference[]): PromiseLike<unknown> | unknown;
	releaseLinkedOriginal?(reference: LinkedOriginalReference): PromiseLike<unknown> | unknown;
	releaseRead?(id: string): PromiseLike<unknown> | unknown;
}

interface DesktopLinkedOriginalAccessOptions {
	readonly bridge: DesktopLinkedOriginalBridge | null;
	readonly fetch?: DesktopReadFetch | null;
	readonly videoPort: MaterializedVideoPort | null;
	readonly openReadDescriptor: (
		descriptor: unknown,
		request?: Readonly<{ signal?: AbortSignal }>,
	) => Promise<Blob & Readonly<{ readonly name?: string }>>;
}

export interface DesktopLinkedOriginalAccess {
	readonly available: boolean;
	readonly audioAvailable: boolean;
	readonly port: DesktopLinkedOriginalPort | null;
	chooseAudio(
		request?: Readonly<{ signal?: AbortSignal }>,
	): Promise<Readonly<DesktopLinkedAudioOriginalChoice> | null>;
	releaseAudio(reference: Readonly<{
		locatorId: string;
		locatorRevision: string;
	}>): Promise<boolean>;
}

const CHOICE_FIELDS = Object.freeze([
	'locatorId', 'locatorRevision', 'name', 'size', 'mimeType', 'lastModified',
]);
const LOAD_FIELDS = Object.freeze(['locatorRevision', 'descriptor']);
const DESCRIPTOR_FIELDS = Object.freeze([
	'id', 'url', 'name', 'size', 'mimeType', 'readProfile', 'lastModified',
]);
const MAXIMUM_MATERIALIZED_BYTES = 512 * 1024 ** 2;
const MAXIMUM_REFERENCES = 128;

/** Kind-aware materialized originals and owner-scoped platform range leases. */
export function createDesktopLinkedOriginalAccess(
	options: DesktopLinkedOriginalAccessOptions,
): Readonly<DesktopLinkedOriginalAccess> {
	const bridge = options?.bridge;
	const releaseRead = bridge ? ownedReleaseRead(bridge) : null;
	const available = Boolean(options?.videoPort
		&& typeof bridge?.loadLinkedAudioOriginal === 'function'
		&& typeof bridge.reconcileLinkedOriginals === 'function'
		&& typeof bridge.releaseLinkedOriginal === 'function'
		&& typeof bridge.releaseRead === 'function');
	const audioAvailable = available && typeof bridge?.chooseLinkedAudioOriginal === 'function';
	const port: DesktopLinkedOriginalPort | null = available
		? Object.freeze(typeof options.fetch === 'function' && releaseRead
			? { leaseRange, load, reconcile, release }
			: { load, reconcile, release })
		: null;
	return Object.freeze({ available, audioAvailable, port, chooseAudio, releaseAudio });

	async function chooseAudio(
		request: Readonly<{ signal?: AbortSignal }> = {},
	): Promise<Readonly<DesktopLinkedAudioOriginalChoice> | null> {
		if (!audioAvailable || !port) return null;
		throwIfAborted(request.signal);
		const rawChoice = await bridge?.chooseLinkedAudioOriginal?.();
		if (rawChoice === null) return null;
		const cleanupReference = possibleAudioReference(rawChoice);
		try {
			throwIfAborted(request.signal);
			const choice = audioChoice(rawChoice);
			const snapshot = await load('audio', choice.locatorId, {
				expectedRevision: choice.locatorRevision,
				signal: request.signal,
			});
			if (!snapshot) throw new Error('The selected linked-audio original is unavailable or changed.');
			assertChoiceSnapshot(choice, snapshot);
			return Object.freeze({ ...choice, file: snapshot.blob });
		} catch (error) {
			try {
				if (cleanupReference && !await release(cleanupReference)) {
					throw new Error('The linked-audio locator cleanup was not acknowledged.');
				}
			} catch (cleanupError) {
				throw new AggregateError(
					[error, cleanupError],
					'The linked-audio selection failed and its locator cleanup was incomplete.',
					{ cause: error },
				);
			}
			throw error;
		}
	}

	async function load(
		kindValue: LinkedOriginalKind,
		locatorIdValue: string,
		request: Readonly<{ expectedRevision: string | null; signal?: AbortSignal }>,
	): Promise<Readonly<LinkedOriginalSnapshot> | null> {
		const kind = linkedOriginalKind(kindValue);
		const locatorId = locatorToken(locatorIdValue, 'locator identifier');
		const expectedRevision = request?.expectedRevision === null
			? null
			: locatorToken(request?.expectedRevision, 'expected locator revision');
		throwIfAborted(request?.signal);
		if (kind === 'video') {
			const snapshot = await options.videoPort?.load(locatorId, {
				expectedRevision, signal: request?.signal,
			});
			return snapshot ? Object.freeze(snapshot) : null;
		}
		const raw = await bridge?.loadLinkedAudioOriginal?.({
			locatorId,
			expectedRevision,
			range: false,
		});
		if (raw === null) {
			throwIfAborted(request?.signal);
			return null;
		}
		const cleanupId = possibleReadId(raw);
		let delegated = false;
		try {
			const response = closedRecord(raw, LOAD_FIELDS, 'Linked-audio load response');
			const locatorRevision = locatorToken(response.locatorRevision, 'locator revision');
			const descriptor = audioDescriptor(response.descriptor);
			const opening = options.openReadDescriptor(descriptor, { signal: request?.signal });
			delegated = true;
			const blob = await opening;
			throwIfAborted(request?.signal);
			return Object.freeze({ blob, locatorRevision });
		} catch (error) {
			if (!delegated && cleanupId) await cleanupRead(error, cleanupId, bridge);
			throw error;
		}
	}

	async function leaseRange(
		kindValue: LinkedOriginalKind,
		locatorIdValue: string,
		request: Readonly<{ expectedRevision: string; signal?: AbortSignal }>,
	): Promise<Readonly<LinkedOriginalRangeLease> | null> {
		const kind = linkedOriginalKind(kindValue);
		const locatorId = locatorToken(locatorIdValue, 'locator identifier');
		const expectedRevision = locatorToken(request?.expectedRevision, 'expected locator revision');
		throwIfAborted(request?.signal);
		if (kind === 'video') {
			const playback = await options.videoPort?.leasePlayback?.(locatorId, {
				expectedRevision,
				signal: request?.signal,
			});
			if (!playback) {
				throwIfAborted(request?.signal);
				return null;
			}
			try {
				throwIfAborted(request?.signal);
				return closeRangeLease(playback);
			} catch (error) {
				return failDelegatedRangeLease(error, playback);
			}
		}
		if (typeof options.fetch !== 'function' || !releaseRead) return null;
		let raw: unknown;
		try {
			raw = await bridge?.loadLinkedAudioOriginal?.({
				locatorId,
				expectedRevision,
				range: true,
			});
		} catch (error) {
			throwIfAborted(request?.signal);
			throw error;
		}
		if (raw === null) {
			throwIfAborted(request?.signal);
			return null;
		}
		return admitDesktopLinkedAudioRange(raw, expectedRevision, {
			fetch: options.fetch,
			releaseRead,
			signal: request?.signal,
		});
	}

	async function reconcile(referencesValue: readonly LinkedOriginalReference[]): Promise<number> {
		const references = linkedOriginalReferences(referencesValue);
		const removed = await bridge?.reconcileLinkedOriginals?.(references);
		if (!Number.isSafeInteger(removed) || Number(removed) < 0) {
			throw new RangeError('Linked-original reconciliation returned an invalid removal count.');
		}
		return Number(removed);
	}

	async function release(referenceValue: LinkedOriginalReference): Promise<boolean> {
		const reference = linkedOriginalReferences([referenceValue])[0] as LinkedOriginalReference;
		return (await bridge?.releaseLinkedOriginal?.(reference)) === true;
	}

	async function releaseAudio(reference: Readonly<{
		locatorId: string;
		locatorRevision: string;
	}>): Promise<boolean> {
		if (!port) return false;
		return release({ kind: 'audio', ...reference });
	}
}

function ownedReleaseRead(bridge: DesktopLinkedOriginalBridge): DesktopReadRelease | null {
	const operation = bridge.releaseRead;
	return typeof operation === 'function'
		? (id: string): unknown => Reflect.apply(operation, bridge, [id]) as unknown
		: null;
}

function closeRangeLease(
	lease: LinkedOriginalRangeLease,
): LinkedOriginalRangeLease {
	return Object.freeze({
		locatorRevision: lease.locatorRevision,
		byteLength: lease.byteLength,
		mimeType: lease.mimeType,
		readRange: (request: Parameters<LinkedOriginalRangeLease['readRange']>[0]) => (
			lease.readRange(request)
		),
		release: () => lease.release(),
	});
}

async function failDelegatedRangeLease(
	error: unknown,
	lease: LinkedOriginalRangeLease,
): Promise<never> {
	try {
		await lease.release();
	} catch (cleanupError) {
		throw new AggregateError(
			[error, cleanupError],
			'Linked-original range handoff and cleanup both failed.',
			{ cause: error },
		);
	}
	throw error;
}

function audioChoice(value: unknown): Omit<DesktopLinkedAudioOriginalChoice, 'file'> {
	const candidate = closedRecord(value, CHOICE_FIELDS, 'Linked-audio locator choice');
	const name = audioName(candidate.name);
	const size = positiveMaterializedSize(candidate.size, 'Linked-audio locator choice size');
	const mimeType = audioMimeType(candidate.mimeType, name);
	const lastModified = nonnegativeSafeInteger(candidate.lastModified, 'Linked-audio modification time');
	return Object.freeze({
		locatorId: locatorToken(candidate.locatorId, 'locator identifier'),
		locatorRevision: locatorToken(candidate.locatorRevision, 'locator revision'),
		name, size, mimeType, lastModified,
	});
}

function audioDescriptor(value: unknown): Readonly<Record<string, unknown>> {
	const descriptor = closedRecord(value, DESCRIPTOR_FIELDS, 'Linked-audio read descriptor');
	if (descriptor.readProfile !== 'materialized-v1') {
		throw new TypeError('Linked-audio reads require a materialized-v1 descriptor.');
	}
	const name = audioName(descriptor.name);
	return Object.freeze({
		id: locatorToken(descriptor.id, 'read identifier'),
		url: requiredString(descriptor.url, 'Linked-audio read URL'),
		name,
		size: positiveMaterializedSize(descriptor.size, 'Linked-audio read size'),
		mimeType: audioMimeType(descriptor.mimeType, name),
		readProfile: 'materialized-v1',
		lastModified: nonnegativeSafeInteger(descriptor.lastModified, 'Linked-audio modification time'),
	});
}

function linkedOriginalReferences(value: unknown): readonly LinkedOriginalReference[] {
	if (!Array.isArray(value) || value.length > MAXIMUM_REFERENCES) {
		throw new RangeError('Linked-original reference count exceeds its limit.');
	}
	const identifiers = new Set<string>();
	return Object.freeze(value.map((item) => {
		const candidate = closedRecord(
			item,
			['kind', 'locatorId', 'locatorRevision'],
			'Linked-original reference',
		);
		const locatorId = locatorToken(candidate.locatorId, 'locator identifier');
		if (identifiers.has(locatorId)) throw new Error('Linked-original references contain a duplicate locator.');
		identifiers.add(locatorId);
		return Object.freeze({
			kind: linkedOriginalKind(candidate.kind),
			locatorId,
			locatorRevision: locatorToken(candidate.locatorRevision, 'locator revision'),
		});
	}));
}

function assertChoiceSnapshot(
	choice: Omit<DesktopLinkedAudioOriginalChoice, 'file'>,
	snapshot: LinkedOriginalSnapshot,
): void {
	if (snapshot.locatorRevision !== choice.locatorRevision
		|| snapshot.blob.size !== choice.size
		|| snapshot.blob.type !== choice.mimeType
		|| snapshot.blob.name !== choice.name) {
		throw new Error('The selected linked-audio original changed before materialization.');
	}
}

function possibleAudioReference(value: unknown): LinkedOriginalReference | null {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
	const record = value as Readonly<Record<string, unknown>>;
	for (const field of ['locatorId', 'locatorRevision']) {
		const descriptor = Object.getOwnPropertyDescriptor(value, field);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')
			|| typeof descriptor.value !== 'string' || !/^[a-f0-9]{64}$/u.test(descriptor.value)) return null;
	}
	return Object.freeze({
		kind: 'audio',
		locatorId: String(record.locatorId),
		locatorRevision: String(record.locatorRevision),
	});
}

function possibleReadId(value: unknown): string | null {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
	const descriptorProperty = Object.getOwnPropertyDescriptor(value, 'descriptor');
	const descriptor = descriptorProperty?.value;
	if (!descriptorProperty?.enumerable || !Object.hasOwn(descriptorProperty, 'value')
		|| !descriptor || typeof descriptor !== 'object' || Array.isArray(descriptor)) return null;
	const idProperty = Object.getOwnPropertyDescriptor(descriptor, 'id');
	return idProperty?.enumerable && Object.hasOwn(idProperty, 'value')
		&& typeof idProperty.value === 'string' && /^[a-f0-9]{64}$/u.test(idProperty.value)
		? idProperty.value
		: null;
}

async function cleanupRead(
	error: unknown,
	id: string,
	bridge: DesktopLinkedOriginalBridge | null,
): Promise<never> {
	try {
		const released = await bridge?.releaseRead?.(id);
		if (released !== true && released !== false) {
			throw new TypeError('Linked-audio read cleanup returned an invalid result.');
		}
	} catch (cleanupError) {
		throw new AggregateError(
			[error, cleanupError],
			'Linked-audio read validation and cleanup both failed.',
			{ cause: cleanupError },
		);
	}
	throw error;
}

function closedRecord(
	value: unknown,
	fields: readonly string[],
	label: string,
): Readonly<Record<string, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`${label} must be an object.`);
	}
	const keys = Reflect.ownKeys(value);
	if (keys.length !== fields.length
		|| keys.some((key) => typeof key !== 'string' || !fields.includes(key))) {
		throw new TypeError(`${label} contains an unsupported field.`);
	}
	const output: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
	for (const field of fields) {
		const descriptor = Object.getOwnPropertyDescriptor(value, field);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`${label} ${field} must be an enumerable data field.`);
		}
		output[field] = descriptor.value;
	}
	return output;
}

function linkedOriginalKind(value: unknown): LinkedOriginalKind {
	if (value !== 'audio' && value !== 'video') {
		throw new TypeError('A linked-original kind must be audio or video.');
	}
	return value;
}

function locatorToken(value: unknown, label: string): string {
	if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) {
		throw new TypeError(`Linked-original ${label} is invalid.`);
	}
	return value;
}

function audioName(value: unknown): string {
	if (typeof value !== 'string' || !value || value !== value.trim()
		|| value.length > 255 || value === '.' || value === '..'
		|| value.includes('/') || value.includes('\\') || /[\u0000-\u001f]/u.test(value)
		|| !/\.(?:aif|aiff|rf64|wav)$/iu.test(value)) {
		throw new TypeError('Linked-audio name must identify an AIFF, WAV, or RF64 file.');
	}
	return value;
}

function audioMimeType(value: unknown, name: string): 'audio/aiff' | 'audio/rf64' | 'audio/wav' {
	if (/\.aiff?$/iu.test(name) && value === 'audio/aiff') return value;
	if (/\.wav$/iu.test(name) && value === 'audio/wav') return value;
	if (/\.rf64$/iu.test(name) && value === 'audio/rf64') return value;
	throw new TypeError('Linked-audio AIFF/WAV MIME type is invalid.');
}

function positiveMaterializedSize(value: unknown, label: string): number {
	const size = nonnegativeSafeInteger(value, label);
	if (size < 1 || size > MAXIMUM_MATERIALIZED_BYTES) {
		throw new RangeError(`${label} exceeds its materialized read limit.`);
	}
	return size;
}

function nonnegativeSafeInteger(value: unknown, label: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) throw new RangeError(`${label} is invalid.`);
	return Number(value);
}

function requiredString(value: unknown, label: string): string {
	if (typeof value !== 'string' || !value) throw new TypeError(`${label} is invalid.`);
	return value;
}

function throwIfAborted(signal?: AbortSignal): void {
	if (!signal?.aborted) return;
	if (signal.reason !== undefined) throw signal.reason;
	if (typeof DOMException === 'function') throw new DOMException('Linked-original access was cancelled.', 'AbortError');
	const error = new Error('Linked-original access was cancelled.');
	error.name = 'AbortError';
	throw error;
}
