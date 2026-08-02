/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	LINKED_ORIGINAL_BINDING_SCHEMA_VERSION,
	normalizeLinkedOriginalBindingInput,
	type LinkedAudioOriginalSourceShape,
	type LinkedOriginalBinding,
	type LinkedOriginalBindingInput,
	type LinkedOriginalKind,
	type LinkedVideoOriginalSourceShape,
} from './linked-original-binding.ts';
import type {
	LinkedOriginalLocatorReference,
	LinkedOriginalRepository,
} from './linked-original-repository.ts';
import {
	canonicalMediaContentBlob,
	digestMediaContent,
} from './media-content-digest.ts';

export const LINKED_ORIGINAL_STORAGE_TYPE = 'linked-original-v2' as const;

interface LinkedOriginalSourceBase extends Readonly<Record<string, unknown>> {
	readonly id: string;
	readonly storageKey: string;
	readonly mimeType: string;
}

export interface LinkedAudioOriginalSource extends LinkedOriginalSourceBase,
	LinkedAudioOriginalSourceShape {
	readonly kind: 'audio';
}

export interface LinkedVideoOriginalSourceV2 extends LinkedOriginalSourceBase,
	LinkedVideoOriginalSourceShape {
	readonly kind: 'video';
}

export type LinkedOriginalSource = LinkedAudioOriginalSource | LinkedVideoOriginalSourceV2;

export interface LinkedOriginalSnapshot {
	readonly blob: unknown;
	readonly locatorRevision: unknown;
}

export interface LinkedOriginalPort {
	load(
		kind: LinkedOriginalKind,
		locatorId: string,
		options: Readonly<{
			expectedRevision: string | null;
			signal?: AbortSignal;
		}>,
	): PromiseLike<LinkedOriginalSnapshot | null> | LinkedOriginalSnapshot | null;
	reconcile?(
		references: readonly LinkedOriginalLocatorReference[],
	): PromiseLike<number> | number;
	release?(
		reference: LinkedOriginalLocatorReference,
	): PromiseLike<boolean> | boolean;
}

export interface ResolvedLinkedOriginal {
	readonly binding: LinkedOriginalBinding;
	readonly blob: Blob;
	readonly metadata: LinkedOriginalMetadata;
}

export interface LinkedOriginalMetadata {
	readonly sourceId: string;
	readonly storage: typeof LINKED_ORIGINAL_STORAGE_TYPE;
	readonly path: null;
	readonly committedAt: string;
	readonly kind: LinkedOriginalKind;
	readonly mimeType: string;
	readonly size: number;
	readonly sha256: string;
}

export interface InspectedLinkedOriginal {
	readonly binding: LinkedOriginalBinding;
	readonly metadata: LinkedOriginalMetadata;
}

export interface BindLinkedOriginalOptions {
	readonly expectedBindingToken?: string | null;
	readonly expectedLocatorRevision?: string | null;
	readonly expectedSnapshot?: unknown;
	readonly signal?: AbortSignal;
}

const VALIDATION_DIGEST = '0'.repeat(64);
const VALIDATION_LOCATOR_REVISION = 'snapshot_validation_token';
const OPAQUE_TOKEN_PATTERN = /^[a-z0-9][a-z0-9_-]{15,127}$/iu;

/** Resolve kind-scoped local capabilities without placing locators in project state. */
export class LinkedOriginalResolver {
	readonly #bindings: LinkedOriginalRepository;
	readonly #port: LinkedOriginalPort;

	constructor(bindings: LinkedOriginalRepository, port: LinkedOriginalPort) {
		if (!bindings || typeof bindings !== 'object'
			|| typeof bindings.get !== 'function' || typeof bindings.putIfCurrent !== 'function') {
			throw new TypeError('A linked original binding repository is required.');
		}
		if (!port || typeof port !== 'object' || typeof port.load !== 'function') {
			throw new TypeError('A linked original platform port is required.');
		}
		this.#bindings = bindings;
		this.#port = port;
	}

	async bind(
		projectId: string,
		source: LinkedOriginalSource,
		locatorId: string,
		options: BindLinkedOriginalOptions = {},
	): Promise<LinkedOriginalBinding> {
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
			if (expectedBlob.size < 1) throw new Error('The expected linked original is empty.');
			expectedContent = Object.freeze({
				byteLength: expectedBlob.size,
				sha256: await digestMediaContent(expectedBlob, { signal: options.signal }),
			});
		}
		throwIfAborted(options.signal);
		const snapshot = await this.#port.load(base.kind, base.locatorId, {
			expectedRevision: expectedLocatorRevision,
			...(options.signal ? { signal: options.signal } : {}),
		});
		throwIfAborted(options.signal);
		const loaded = snapshotValue(snapshot);
		if (expectedLocatorRevision !== null && loaded.locatorRevision !== expectedLocatorRevision) {
			throw new Error('The linked original locator changed before binding.');
		}
		const blob = canonicalMediaContentBlob(loaded.blob);
		if (blob.size < 1) throw new Error('The linked original is empty.');
		if (expectedContent && blob.size !== expectedContent.byteLength) {
			throw new Error('The linked original changed byte length after selection.');
		}
		const sha256 = await digestMediaContent(blob, { signal: options.signal });
		throwIfAborted(options.signal);
		if (expectedContent && sha256 !== expectedContent.sha256) {
			throw new Error('The linked original changed content after selection.');
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
		);
		if (!published) throw new Error('The linked original binding changed before publication.');
		return published;
	}

	async resolve(
		projectId: string,
		source: LinkedOriginalSource,
		options: Readonly<{ signal?: AbortSignal }> = {},
	): Promise<ResolvedLinkedOriginal | null> {
		const inspected = await this.inspect(projectId, source, options);
		if (!inspected) return null;
		const { binding } = inspected;
		const snapshot = await this.#port.load(binding.kind, binding.locatorId, {
			expectedRevision: binding.locatorRevision,
			...(options.signal ? { signal: options.signal } : {}),
		});
		throwIfAborted(options.signal);
		if (snapshot === null) throw new Error('The linked original is unavailable or changed.');
		const loaded = snapshotValue(snapshot);
		if (loaded.locatorRevision !== binding.locatorRevision) {
			throw new Error('The linked original locator changed during resolution.');
		}
		const blob = canonicalMediaContentBlob(loaded.blob);
		if (blob.size !== binding.byteLength) {
			throw new Error('The linked original changed byte length.');
		}
		const sha256 = await digestMediaContent(blob, { signal: options.signal });
		throwIfAborted(options.signal);
		if (sha256 !== binding.sha256) throw new Error('The linked original failed SHA-256 verification.');
		await this.assertBindingCurrent(projectId, source, binding, options);
		return Object.freeze({ binding, blob, metadata: inspected.metadata });
	}

	async inspect(
		projectId: string,
		source: LinkedOriginalSource,
		options: Readonly<{ signal?: AbortSignal }> = {},
	): Promise<InspectedLinkedOriginal | null> {
		throwIfAborted(options.signal);
		const binding = await this.#bindings.get(projectId, source.id);
		throwIfAborted(options.signal);
		if (!binding) return null;
		assertSourceBinding(binding, projectId, source);
		return Object.freeze({ binding, metadata: linkedMetadata(binding) });
	}

	async assertBindingCurrent(
		projectId: string,
		source: LinkedOriginalSource,
		binding: LinkedOriginalBinding,
		options: Readonly<{ signal?: AbortSignal }> = {},
	): Promise<void> {
		assertSourceBinding(binding, projectId, source);
		throwIfAborted(options.signal);
		const current = await this.#bindings.get(projectId, source.id);
		throwIfAborted(options.signal);
		if (!current || !sameBinding(current, binding)) {
			throw new Error('The linked original binding changed during resolution.');
		}
	}

	async metadata(
		projectId: string,
		source: LinkedOriginalSource,
	): Promise<LinkedOriginalMetadata | null> {
		return (await this.inspect(projectId, source))?.metadata ?? null;
	}

	unlink(projectId: string, sourceId: string, expectedBindingToken: string): Promise<boolean> {
		return this.#bindings.deleteIfCurrent(projectId, sourceId, expectedBindingToken);
	}

	canReleaseLocators(): boolean {
		return typeof this.#port.release === 'function';
	}

	validateLocatorReference(value: unknown): Readonly<LinkedOriginalLocatorReference> {
		return locatorReference(value);
	}

	async release(referenceValue: LinkedOriginalLocatorReference): Promise<boolean> {
		const reference = locatorReference(referenceValue);
		if (typeof this.#port.release !== 'function') return false;
		const released = await this.#port.release(reference);
		if (released !== true && released !== false) {
			throw new TypeError('Linked original locator release returned an invalid result.');
		}
		return released;
	}

	async reconcileLocators(canonicalProjectIds: readonly string[]): Promise<number | null> {
		if (typeof this.#port.reconcile !== 'function') return null;
		const references = await this.#bindings.reconcileDurableLocatorReferences(canonicalProjectIds);
		if (references === null) return null;
		const removed = await this.#port.reconcile(references);
		if (!Number.isSafeInteger(removed) || Number(removed) < 0) {
			throw new RangeError('Linked original locator reconciliation returned an invalid removal count.');
		}
		return Number(removed);
	}
}

function bindingInput(
	projectId: string,
	source: LinkedOriginalSource,
	content: Readonly<Pick<LinkedOriginalBindingInput,
		'locatorId' | 'locatorRevision' | 'byteLength' | 'sha256'>>,
): LinkedOriginalBindingInput {
	if (!source || typeof source !== 'object'
		|| (source.kind !== 'audio' && source.kind !== 'video')) {
		throw new TypeError('An audio or video project source is required for a linked original.');
	}
	return normalizeLinkedOriginalBindingInput({
		schemaVersion: LINKED_ORIGINAL_BINDING_SCHEMA_VERSION,
		kind: source.kind,
		projectId,
		sourceId: source.id,
		storageKey: source.storageKey,
		mimeType: source.mimeType,
		...content,
		sourceShape: sourceShape(source),
	});
}

function sourceShape(source: LinkedOriginalSource): LinkedOriginalBinding['sourceShape'] {
	return source.kind === 'audio'
		? {
			frameCount: source.frameCount,
			channelCount: source.channelCount,
			sampleRate: source.sampleRate,
			originalSampleRate: source.originalSampleRate,
			sampleFormat: source.sampleFormat,
			chunkFrames: source.chunkFrames,
		}
		: {
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
	binding: LinkedOriginalBinding,
	projectId: string,
	source: LinkedOriginalSource,
): void {
	const expected = bindingInput(projectId, source, {
		locatorId: binding.locatorId,
		locatorRevision: binding.locatorRevision,
		byteLength: binding.byteLength,
		sha256: binding.sha256,
	});
	const { bindingToken: _bindingToken, boundAt: _boundAt, ...actual } = binding;
	if (JSON.stringify(expected) !== JSON.stringify(actual)) {
		throw new Error('The linked original binding does not match its project source.');
	}
}

function snapshotValue(value: LinkedOriginalSnapshot | null): Readonly<{
	blob: unknown;
	locatorRevision: string;
}> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error('The linked original is unavailable or changed.');
	}
	const keys = Reflect.ownKeys(value);
	if (keys.length !== 2 || !keys.includes('blob') || !keys.includes('locatorRevision')) {
		throw new TypeError('A linked original snapshot must be a closed object.');
	}
	for (const key of keys) {
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError('A linked original snapshot must use enumerable data fields.');
		}
	}
	return Object.freeze({
		blob: value.blob,
		locatorRevision: opaqueToken(value.locatorRevision, 'locator revision'),
	});
}

function linkedMetadata(binding: LinkedOriginalBinding): LinkedOriginalMetadata {
	return Object.freeze({
		sourceId: binding.storageKey,
		storage: LINKED_ORIGINAL_STORAGE_TYPE,
		path: null,
		committedAt: binding.boundAt,
		kind: binding.kind,
		mimeType: binding.mimeType,
		size: binding.byteLength,
		sha256: binding.sha256,
	});
}

function sameBinding(left: LinkedOriginalBinding, right: LinkedOriginalBinding): boolean {
	return left.bindingToken === right.bindingToken && JSON.stringify(left) === JSON.stringify(right);
}

function locatorReference(value: unknown): Readonly<LinkedOriginalLocatorReference> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('A linked original locator reference is required.');
	}
	const fields = ['kind', 'locatorId', 'locatorRevision'];
	const keys = Reflect.ownKeys(value);
	if (keys.length !== fields.length || keys.some((key) => !fields.includes(String(key)))) {
		throw new TypeError('A linked original locator reference contains an unsupported field.');
	}
	const record = value as Readonly<Record<string, unknown>>;
	for (const field of fields) {
		const descriptor = Object.getOwnPropertyDescriptor(value, field);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`Linked original ${field} must be an enumerable data field.`);
		}
	}
	if (record.kind !== 'audio' && record.kind !== 'video') {
		throw new TypeError('Linked original kind must be audio or video.');
	}
	return Object.freeze({
		kind: record.kind,
		locatorId: opaqueToken(record.locatorId, 'locator identifier'),
		locatorRevision: opaqueToken(record.locatorRevision, 'locator revision'),
	});
}

function opaqueToken(value: unknown, label: string): string {
	if (typeof value !== 'string' || !OPAQUE_TOKEN_PATTERN.test(value)) {
		throw new TypeError(`Linked original ${label} is invalid.`);
	}
	return value;
}

function throwIfAborted(signal?: AbortSignal): void {
	if (!signal?.aborted) return;
	if (signal.reason !== undefined) throw signal.reason;
	if (typeof DOMException === 'function') {
		throw new DOMException('Linked original access was cancelled.', 'AbortError');
	}
	const error = new Error('Linked original access was cancelled.');
	error.name = 'AbortError';
	throw error;
}
