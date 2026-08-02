/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	LINKED_VIDEO_ORIGINAL_BINDING_SCHEMA_VERSION,
	normalizeLinkedVideoOriginalBindingInput,
	type LinkedVideoOriginalBinding,
	type LinkedVideoOriginalBindingInput,
	type LinkedVideoOriginalSourceShape,
} from './linked-video-original-binding.ts';
import type { LinkedVideoOriginalRepository } from './linked-video-original-repository.ts';
import {
	canonicalMediaContentBlob,
	digestMediaContent,
} from './media-content-digest.ts';

export const LINKED_VIDEO_ORIGINAL_STORAGE_TYPE = 'linked-video-original-v1' as const;

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

export interface LinkedVideoOriginalPort {
	load(
		locatorId: string,
		options: Readonly<{
			expectedRevision: string | null;
			signal?: AbortSignal;
		}>,
	): PromiseLike<LinkedVideoOriginalSnapshot | null> | LinkedVideoOriginalSnapshot | null;
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

export interface BindLinkedVideoOriginalOptions {
	readonly expectedBindingToken?: string | null;
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
		const base = bindingInput(projectId, source, {
			locatorId,
			locatorRevision: VALIDATION_LOCATOR_REVISION,
			byteLength: 1,
			sha256: VALIDATION_DIGEST,
		});
		throwIfAborted(options.signal);
		const snapshot = await this.#port.load(base.locatorId, {
			expectedRevision: null,
			signal: options.signal,
		});
		throwIfAborted(options.signal);
		const loaded = snapshotValue(snapshot);
		const blob = canonicalMediaContentBlob(loaded.blob);
		if (blob.size < 1) throw new Error('The linked video original is empty.');
		const sha256 = await digestMediaContent(blob, { signal: options.signal });
		throwIfAborted(options.signal);
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
		if (!published) throw new Error('The linked video original binding changed before publication.');
		return published;
	}

	async resolve(
		projectId: string,
		source: LinkedVideoOriginalSource,
		options: Readonly<{ signal?: AbortSignal }> = {},
	): Promise<ResolvedLinkedVideoOriginal | null> {
		throwIfAborted(options.signal);
		const binding = await this.#bindings.get(projectId, source.id);
		throwIfAborted(options.signal);
		if (!binding) return null;
		assertSourceBinding(binding, projectId, source);
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
		const current = await this.#bindings.get(projectId, source.id);
		throwIfAborted(options.signal);
		if (!current || !sameBinding(current, binding)) {
			throw new Error('The linked video original binding changed during resolution.');
		}
		return Object.freeze({
			binding,
			blob,
			metadata: linkedMetadata(binding),
		});
	}

	async metadata(
		projectId: string,
		source: LinkedVideoOriginalSource,
	): Promise<ResolvedLinkedVideoOriginal['metadata'] | null> {
		const binding = await this.#bindings.get(projectId, source.id);
		if (!binding) return null;
		assertSourceBinding(binding, projectId, source);
		return linkedMetadata(binding);
	}

	unlink(
		projectId: string,
		sourceId: string,
		expectedBindingToken: string,
	): Promise<boolean> {
		return this.#bindings.deleteIfCurrent(projectId, sourceId, expectedBindingToken);
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
	const locatorRevision = candidate.locatorRevision;
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
	return Object.freeze({
		blob: candidate.blob,
		locatorRevision: normalized.locatorRevision,
	});
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

function throwIfAborted(signal?: AbortSignal): void {
	if (!signal?.aborted) return;
	if (signal.reason !== undefined) throw signal.reason;
	if (typeof DOMException === 'function') throw new DOMException('Linked video original access was cancelled.', 'AbortError');
	const error = new Error('Linked video original access was cancelled.');
	error.name = 'AbortError';
	throw error;
}
