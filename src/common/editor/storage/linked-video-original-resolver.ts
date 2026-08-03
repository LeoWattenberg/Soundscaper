/* SPDX-License-Identifier: AGPL-3.0-only */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

import {
	LINKED_VIDEO_ORIGINAL_BINDING_SCHEMA_VERSION,
	normalizeLinkedVideoOriginalBindingInput,
	type LinkedVideoOriginalBinding,
	type LinkedVideoOriginalBindingInput,
	type LinkedVideoOriginalSourceShape,
} from './linked-video-original-binding.ts';
import type { LinkedVideoOriginalLocatorReference, LinkedVideoOriginalRepository } from './linked-video-original-repository.ts';
import {
	canonicalMediaContentBlob,
	digestMediaContent,
	MEDIA_CONTENT_DIGEST_CHUNK_BYTES,
} from './media-content-digest.ts';

export const LINKED_VIDEO_ORIGINAL_STORAGE_TYPE = 'linked-video-original-v1' as const;
export const LINKED_VIDEO_PLAYBACK_VERIFY_CHUNK_BYTES = MEDIA_CONTENT_DIGEST_CHUNK_BYTES;

export interface LinkedVideoOriginalSource extends Readonly<Record<string, unknown>> {
	readonly kind: 'video';
	readonly id: string;
	readonly storageKey: string;
	readonly mimeType: string;
	readonly frameCount: number;
	readonly sampleRate: number;
	readonly width: number;
	readonly height: number;
	readonly frameRate: number;
	readonly videoCodec: string;
	readonly audioCodec: string | null;
	readonly hasAudio: boolean;
}

export interface LinkedVideoOriginalSnapshot {
	readonly blob: unknown;
	readonly locatorRevision: unknown;
}

export interface LinkedVideoOriginalPlaybackLease {
	readonly locatorRevision: string;
	readonly mediaUrl: string;
	readonly byteLength: number;
	readonly mimeType: string;
	readRange(request: Readonly<{
		offset: number;
		length: number;
		signal?: AbortSignal;
	}>): PromiseLike<Uint8Array> | Uint8Array;
	release(): PromiseLike<void> | void;
}

export interface LinkedVideoOriginalPort {
	load(
		locatorId: string,
		options: Readonly<{
			expectedRevision: string | null;
			signal?: AbortSignal;
		}>,
	): PromiseLike<LinkedVideoOriginalSnapshot | null> | LinkedVideoOriginalSnapshot | null;
	leasePlayback?(
		locatorId: string,
		options: Readonly<{
			expectedRevision: string;
			signal?: AbortSignal;
		}>,
	): PromiseLike<LinkedVideoOriginalPlaybackLease | null> | LinkedVideoOriginalPlaybackLease | null;
	reconcile?(
		references: readonly LinkedVideoOriginalLocatorReference[],
	): PromiseLike<number> | number;
	release?(reference: LinkedVideoOriginalLocatorReference): PromiseLike<boolean> | boolean;
}

export interface ResolvedLinkedVideoOriginal {
	readonly binding: LinkedVideoOriginalBinding;
	readonly blob: Blob;
	readonly metadata: Readonly<{
		readonly sourceId: string;
		readonly storage: typeof LINKED_VIDEO_ORIGINAL_STORAGE_TYPE;
		readonly path: null;
		readonly committedAt: string;
		readonly mimeType: string;
		readonly size: number;
		readonly sha256: string;
	}>;
}

export interface ResolvedLinkedVideoOriginalPlayback {
	readonly binding: LinkedVideoOriginalBinding;
	readonly mediaUrl: string;
	release(): Promise<void>;
}

export interface InspectedLinkedVideoOriginal {
	readonly binding: LinkedVideoOriginalBinding;
	readonly metadata: ResolvedLinkedVideoOriginal['metadata'];
}

export interface BindLinkedVideoOriginalOptions {
	readonly expectedBindingToken?: string | null;
	readonly expectedLocatorRevision?: string | null;
	readonly expectedSnapshot?: unknown;
	readonly assertCanPublish?: () => void;
	readonly signal?: AbortSignal;
}

const VALIDATION_DIGEST = '0'.repeat(64);
const VALIDATION_LOCATOR_REVISION = 'snapshot_validation_token';

/** Resolve local opaque link capabilities without placing their locators in project state. */
export class LinkedVideoOriginalResolver {
	readonly #bindings: LinkedVideoOriginalRepository;
	readonly #port: LinkedVideoOriginalPort;

	constructor(bindings: LinkedVideoOriginalRepository, port: LinkedVideoOriginalPort) {
		if (!port || typeof port !== 'object' || typeof port.load !== 'function') {
			throw new TypeError('A linked video original platform port is required.');
		}
		this.#bindings = bindings;
		this.#port = port;
	}
	async bind(
		projectId: string,
		source: LinkedVideoOriginalSource,
		locatorId: string,
		options: BindLinkedVideoOriginalOptions = {},
	): Promise<LinkedVideoOriginalBinding> {
		const expectedLocatorRevision = options.expectedLocatorRevision ?? null;
		const base = bindingInput(projectId, source, {
			locatorId,
			locatorRevision: expectedLocatorRevision ?? VALIDATION_LOCATOR_REVISION,
			byteLength: 1,
			sha256: VALIDATION_DIGEST,
		});
		let expectedContent: Readonly<{ byteLength: number; sha256: string }> | null = null;
		if (Object.hasOwn(options, 'expectedSnapshot')) {
			const expectedBlob = canonicalMediaContentBlob(options.expectedSnapshot);
			if (expectedBlob.size < 1) throw new Error('The expected linked video original is empty.');
			expectedContent = Object.freeze({
				byteLength: expectedBlob.size,
				sha256: await digestMediaContent(expectedBlob, { signal: options.signal }),
			});
		}
		throwIfAborted(options.signal);
		const snapshot = await this.#port.load(base.locatorId, {
			expectedRevision: expectedLocatorRevision,
			signal: options.signal,
		});
		throwIfAborted(options.signal);
		const loaded = snapshotValue(snapshot);
		if (expectedLocatorRevision !== null && loaded.locatorRevision !== expectedLocatorRevision) {
			throw new Error('The linked video original locator changed before binding.');
		}
		const blob = canonicalMediaContentBlob(loaded.blob);
		if (blob.size < 1) throw new Error('The linked video original is empty.');
		if (expectedContent && blob.size !== expectedContent.byteLength) {
			throw new Error('The linked video original changed byte length after selection.');
		}
		const sha256 = await digestMediaContent(blob, { signal: options.signal });
		throwIfAborted(options.signal);
		if (expectedContent && sha256 !== expectedContent.sha256) {
			throw new Error('The linked video original changed content after selection.');
		}
		const input = bindingInput(projectId, source, {
			locatorId: base.locatorId,
			locatorRevision: loaded.locatorRevision,
			byteLength: blob.size,
			sha256,
		});
		const published = await this.#bindings.putIfCurrent(
			input,
			options.expectedBindingToken ?? null,
			options.assertCanPublish,
		);
		if (!published) throw new Error('The linked video original binding changed before publication.');
		return published;
	}

	async resolve(
		projectId: string,
		source: LinkedVideoOriginalSource,
		options: Readonly<{ signal?: AbortSignal }> = {},
	): Promise<ResolvedLinkedVideoOriginal | null> {
		const inspected = await this.inspect(projectId, source, options);
		if (!inspected) return null;
		const { binding } = inspected;
		const snapshot = await this.#port.load(binding.locatorId, {
			expectedRevision: binding.locatorRevision,
			signal: options.signal,
		});
		throwIfAborted(options.signal);
		if (snapshot === null) throw new Error('The linked video original is unavailable or changed.');
		const loaded = snapshotValue(snapshot);
		if (loaded.locatorRevision !== binding.locatorRevision) {
			throw new Error('The linked video original locator changed during resolution.');
		}
		const blob = canonicalMediaContentBlob(loaded.blob);
		if (blob.size !== binding.byteLength) {
			throw new Error('The linked video original changed byte length.');
		}
		const sha256 = await digestMediaContent(blob, { signal: options.signal });
		throwIfAborted(options.signal);
		if (sha256 !== binding.sha256) throw new Error('The linked video original failed SHA-256 verification.');
		await this.assertBindingCurrent(projectId, source, binding, options);
		return Object.freeze({
			binding,
			blob,
			metadata: inspected.metadata,
		});
	}
	async leasePlayback(
		projectId: string,
		source: LinkedVideoOriginalSource,
		options: Readonly<{ signal?: AbortSignal }> = {},
	): Promise<ResolvedLinkedVideoOriginalPlayback | null> {
		const inspected = await this.inspect(projectId, source, options);
		if (!inspected || typeof this.#port.leasePlayback !== 'function') return null;
		const { binding } = inspected;
		const rawLease = await this.#port.leasePlayback(binding.locatorId, {
			expectedRevision: binding.locatorRevision,
			signal: options.signal,
		});
		const rawRelease = possiblePlaybackRelease(rawLease);
		let release = rawRelease ? oneShotRelease(rawRelease) : null;
		try {
			throwIfAborted(options.signal);
			if (rawLease === null) {
				throw new Error('The linked video original is unavailable or changed.');
			}
			const lease = playbackLeaseValue(rawLease);
			release ??= oneShotRelease(() => lease.release());
			if (lease.locatorRevision !== binding.locatorRevision) {
				throw new Error('The linked video original locator changed during playback admission.');
			}
			if (lease.byteLength !== binding.byteLength) {
				throw new Error('The linked video original changed byte length before playback.');
			}
			if (lease.mimeType !== binding.mimeType) {
				throw new Error('The linked video original changed MIME type before playback.');
			}
			await verifyPlaybackBytes(lease, binding.sha256, options.signal);
			await this.assertBindingCurrent(projectId, source, binding, options);
			return Object.freeze({ binding, mediaUrl: lease.mediaUrl, release });
		} catch (error) {
			if (release) return failPlaybackLease(error, release);
			throw error;
		}
	}

	async inspect(
		projectId: string,
		source: LinkedVideoOriginalSource,
		options: Readonly<{ signal?: AbortSignal }> = {},
	): Promise<InspectedLinkedVideoOriginal | null> {
		throwIfAborted(options.signal);
		const binding = await this.#bindings.get(projectId, source.id);
		throwIfAborted(options.signal);
		if (!binding) return null;
		assertSourceBinding(binding, projectId, source);
		return Object.freeze({ binding, metadata: linkedMetadata(binding) });
	}

	async assertBindingCurrent(
		projectId: string,
		source: LinkedVideoOriginalSource,
		binding: LinkedVideoOriginalBinding,
		options: Readonly<{ signal?: AbortSignal }> = {},
	): Promise<void> {
		assertSourceBinding(binding, projectId, source);
		throwIfAborted(options.signal);
		const current = await this.#bindings.get(projectId, source.id);
		throwIfAborted(options.signal);
		if (!current || !sameBinding(current, binding)) {
			throw new Error('The linked video original binding changed during resolution.');
		}
	}

	async metadata(
		projectId: string,
		source: LinkedVideoOriginalSource,
	): Promise<ResolvedLinkedVideoOriginal['metadata'] | null> {
		return (await this.inspect(projectId, source))?.metadata ?? null;
	}

	unlink(
		projectId: string,
		sourceId: string,
		expectedBindingToken: string,
	): Promise<boolean> {
		return this.#bindings.deleteIfCurrent(projectId, sourceId, expectedBindingToken);
	}

	canReleaseLocators(): boolean {
		return typeof this.#port.release === 'function';
	}

	validateLocatorReference(value: unknown): Readonly<LinkedVideoOriginalLocatorReference> {
		return locatorReference(value);
	}

	async release(referenceValue: LinkedVideoOriginalLocatorReference): Promise<boolean> {
		const reference = locatorReference(referenceValue);
		if (typeof this.#port.release !== 'function') return false;
		const released = await this.#port.release(reference);
		if (released !== true && released !== false) {
			throw new TypeError('Linked video locator release returned an invalid result.');
		}
		return released;
	}

	async reconcileLocators(canonicalProjectIds: readonly string[]): Promise<number | null> {
		if (!this.canReconcileLocators()) return null;
		const references = await this.#bindings.reconcileDurableLocatorReferences(canonicalProjectIds);
		if (references === null) return null;
		return this.reconcileLocatorReferences(references);
	}

	canReconcileLocators(): boolean { return typeof this.#port.reconcile === 'function'; }
	async reconcileLocatorReferences(references: readonly LinkedVideoOriginalLocatorReference[]): Promise<number | null> {
		if (typeof this.#port.reconcile !== 'function') return null;
		const removed = await this.#port.reconcile(references);
		if (!Number.isSafeInteger(removed) || Number(removed) < 0)
			throw new RangeError('Linked video locator reconciliation returned an invalid removal count.');
		return Number(removed);
	}
}

function bindingInput(
	projectId: string,
	source: LinkedVideoOriginalSource,
	content: Readonly<Pick<LinkedVideoOriginalBindingInput,
		'locatorId' | 'locatorRevision' | 'byteLength' | 'sha256'>>,
): LinkedVideoOriginalBindingInput {
	if (!source || typeof source !== 'object' || source.kind !== 'video') {
		throw new TypeError('A video project source is required for a linked original.');
	}
	return normalizeLinkedVideoOriginalBindingInput({
		schemaVersion: LINKED_VIDEO_ORIGINAL_BINDING_SCHEMA_VERSION,
		projectId,
		sourceId: source.id,
		storageKey: source.storageKey,
		mimeType: source.mimeType,
		...content,
		sourceShape: sourceShape(source),
	});
}

function sourceShape(source: LinkedVideoOriginalSource): LinkedVideoOriginalSourceShape {
	return {
		frameCount: source.frameCount,
		sampleRate: source.sampleRate,
		width: source.width,
		height: source.height,
		frameRate: source.frameRate,
		videoCodec: source.videoCodec,
		audioCodec: source.audioCodec,
		hasAudio: source.hasAudio,
	};
}

function assertSourceBinding(
	binding: LinkedVideoOriginalBinding,
	projectId: string,
	source: LinkedVideoOriginalSource,
): void {
	const expected = bindingInput(projectId, source, {
		locatorId: binding.locatorId,
		locatorRevision: binding.locatorRevision,
		byteLength: binding.byteLength,
		sha256: binding.sha256,
	});
	const actual = bindingInput(binding.projectId, {
		...source,
		id: binding.sourceId,
		storageKey: binding.storageKey,
		mimeType: binding.mimeType,
		...binding.sourceShape,
	}, {
		locatorId: binding.locatorId,
		locatorRevision: binding.locatorRevision,
		byteLength: binding.byteLength,
		sha256: binding.sha256,
	});
	if (JSON.stringify(expected) !== JSON.stringify(actual)) {
		throw new Error('The linked video original binding does not match its project source.');
	}
}

function snapshotValue(value: LinkedVideoOriginalSnapshot | null): Readonly<{
	blob: unknown;
	locatorRevision: string;
}> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error('The linked video original is unavailable or changed.');
	}
	const keys = Reflect.ownKeys(value);
	if (keys.length !== 2 || !keys.includes('blob') || !keys.includes('locatorRevision')) {
		throw new TypeError('A linked video original snapshot must be a closed object.');
	}
	for (const key of keys) {
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError('A linked video original snapshot must use data fields.');
		}
	}
	const candidate = value as unknown as Readonly<Record<string, unknown>>;
	const locatorRevision = locatorRevisionValue(candidate.locatorRevision);
	return Object.freeze({
		blob: candidate.blob,
		locatorRevision,
	});
}

function locatorRevisionValue(locatorRevision: unknown): string {
	const normalized = normalizeLinkedVideoOriginalBindingInput({
		schemaVersion: 1,
		projectId: 'validation-project',
		sourceId: 'validation-source',
		storageKey: 'validation-storage',
		locatorId: 'locator_validation_token',
		locatorRevision,
		mimeType: 'video/validation',
		byteLength: 1,
		sha256: VALIDATION_DIGEST,
		sourceShape: {
			frameCount: 1,
			sampleRate: 1,
			width: 1,
			height: 1,
			frameRate: 1,
			videoCodec: 'validation',
			audioCodec: null,
			hasAudio: false,
		},
	});
	return normalized.locatorRevision;
}

function playbackLeaseValue(value: LinkedVideoOriginalPlaybackLease): LinkedVideoOriginalPlaybackLease {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('A linked video original playback lease is required.');
	}
	const fields = ['locatorRevision', 'mediaUrl', 'byteLength', 'mimeType', 'readRange', 'release'];
	const keys = Reflect.ownKeys(value);
	if (keys.length !== fields.length || keys.some((key) => !fields.includes(String(key)))) {
		throw new TypeError('A linked video original playback lease must be a closed object.');
	}
	for (const field of fields) {
		const descriptor = Object.getOwnPropertyDescriptor(value, field);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError('A linked video original playback lease must use enumerable data fields.');
		}
	}
	if (typeof value.mediaUrl !== 'string' || !value.mediaUrl) {
		throw new TypeError('A linked video original playback lease requires a media URL.');
	}
	if (!Number.isSafeInteger(value.byteLength) || value.byteLength < 1) {
		throw new RangeError('A linked video original playback lease requires a positive byte length.');
	}
	if (typeof value.mimeType !== 'string'
		|| !/^video\/[a-z0-9][a-z0-9!#$&^_.+-]*$/u.test(value.mimeType)) {
		throw new TypeError('A linked video original playback lease requires a video MIME type.');
	}
	if (typeof value.readRange !== 'function' || typeof value.release !== 'function') {
		throw new TypeError('A linked video original playback lease requires owned range operations.');
	}
	const readRange = value.readRange;
	const release = value.release;
	return Object.freeze({
		locatorRevision: locatorRevisionValue(value.locatorRevision),
		mediaUrl: value.mediaUrl,
		byteLength: value.byteLength,
		mimeType: value.mimeType,
		readRange: (request: Parameters<LinkedVideoOriginalPlaybackLease['readRange']>[0]) => (
			Reflect.apply(readRange, value, [request]) as ReturnType<LinkedVideoOriginalPlaybackLease['readRange']>
		),
		release: () => Reflect.apply(
			release,
			value,
			[],
		) as ReturnType<LinkedVideoOriginalPlaybackLease['release']>,
	});
}

function possiblePlaybackRelease(value: unknown): (() => PromiseLike<void> | void) | null {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
	const descriptor = Object.getOwnPropertyDescriptor(value, 'release');
	return descriptor?.enumerable && Object.hasOwn(descriptor, 'value')
		&& typeof descriptor.value === 'function'
		? () => Reflect.apply(descriptor.value, value, []) as PromiseLike<void> | void
		: null;
}

async function verifyPlaybackBytes(
	lease: LinkedVideoOriginalPlaybackLease,
	expectedSha256: string,
	signal?: AbortSignal,
): Promise<void> {
	const digest = sha256.create();
	for (let offset = 0; offset < lease.byteLength;) {
		throwIfAborted(signal);
		const length = Math.min(
			LINKED_VIDEO_PLAYBACK_VERIFY_CHUNK_BYTES,
			lease.byteLength - offset,
		);
		let bytes: Uint8Array;
		try {
			bytes = await lease.readRange({ offset, length, ...(signal ? { signal } : {}) });
		} catch (error) {
			throwIfAborted(signal);
			throw error;
		}
		throwIfAborted(signal);
		if (!(bytes instanceof Uint8Array) || bytes.byteLength !== length) {
			throw new Error('The linked video original playback range returned inexact bytes.');
		}
		digest.update(bytes);
		offset += length;
	}
	if (bytesToHex(digest.digest()) !== expectedSha256) {
		throw new Error('The linked video original playback lease failed SHA-256 verification.');
	}
}

function oneShotRelease(operation: () => PromiseLike<void> | void): () => Promise<void> {
	let result: Promise<void> | null = null;
	return () => {
		result ??= Promise.resolve().then(operation);
		return result;
	};
}

async function failPlaybackLease(
	error: unknown,
	release: () => Promise<void>,
): Promise<never> {
	try {
		await release();
	} catch (cleanupError) {
		throw new AggregateError(
			[error, cleanupError],
			'Linked video playback verification and cleanup both failed.',
			{ cause: cleanupError },
		);
	}
	throw error;
}

function linkedMetadata(binding: LinkedVideoOriginalBinding): ResolvedLinkedVideoOriginal['metadata'] {
	return Object.freeze({
		sourceId: binding.storageKey,
		storage: LINKED_VIDEO_ORIGINAL_STORAGE_TYPE,
		path: null,
		committedAt: binding.boundAt,
		mimeType: binding.mimeType,
		size: binding.byteLength,
		sha256: binding.sha256,
	});
}

function sameBinding(left: LinkedVideoOriginalBinding, right: LinkedVideoOriginalBinding): boolean {
	return left.bindingToken === right.bindingToken && JSON.stringify(left) === JSON.stringify(right);
}

function locatorReference(value: unknown): Readonly<LinkedVideoOriginalLocatorReference> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('A linked video locator reference is required.');
	}
	const fields = ['locatorId', 'locatorRevision'];
	const keys = Reflect.ownKeys(value);
	if (keys.length !== fields.length || keys.some((key) => !fields.includes(String(key)))) {
		throw new TypeError('A linked video locator reference contains an unsupported field.');
	}
	const output: Record<string, string> = Object.create(null) as Record<string, string>;
	for (const field of fields) {
		const descriptor = Object.getOwnPropertyDescriptor(value, field);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')
			|| typeof descriptor.value !== 'string'
			|| !/^[a-z0-9][a-z0-9_-]{15,127}$/iu.test(descriptor.value)) {
			throw new TypeError(`Linked video ${field} is invalid.`);
		}
		output[field] = descriptor.value;
	}
	return Object.freeze({
		locatorId: output.locatorId as string,
		locatorRevision: output.locatorRevision as string,
	});
}

function throwIfAborted(signal?: AbortSignal): void {
	if (!signal?.aborted) return;
	if (signal.reason !== undefined) throw signal.reason;
	if (typeof DOMException === 'function') throw new DOMException('Linked video original access was cancelled.', 'AbortError');
	const error = new Error('Linked video original access was cancelled.');
	error.name = 'AbortError';
	throw error;
}
