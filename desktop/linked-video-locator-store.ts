/* SPDX-License-Identifier: AGPL-3.0-only */

import { randomBytes as nodeRandomBytes } from 'node:crypto';
import { stat as nodeStat } from 'node:fs/promises';

import {
	MAX_PERSISTED_LINKED_VIDEO_BYTES,
	MAX_PERSISTED_LINKED_VIDEO_FILE_BYTES,
	MAX_PERSISTED_LINKED_VIDEO_LOCATORS,
	normalizePersistedLinkedVideoLocator,
	persistedLinkedVideoFileIdentityFromStat,
	samePersistedLinkedVideoFileIdentity,
	type DesktopLinkedVideoLocatorRegistry,
	type LinkedVideoFileStat,
	type PersistedLinkedVideoFileIdentity,
	type PersistedLinkedVideoLocator,
} from './linked-video-locator-registry.ts';
import {
	absoluteLinkedOriginalPath,
	boundedLimit,
	linkedOriginalDisplayName,
	linkedOriginalMediaKind,
	linkedOriginalMimeType,
	linkedOriginalOpaqueToken,
	linkedOriginalReadTimestamp,
	nullableLocatorRevision,
	requiredLocatorOwner,
	type LinkedOriginalMediaKind,
} from './linked-original-locator-validation.ts';

export const MAX_LINKED_VIDEO_LOCATORS = MAX_PERSISTED_LINKED_VIDEO_LOCATORS;
export const MAX_LINKED_VIDEO_LOCATOR_BYTES = MAX_PERSISTED_LINKED_VIDEO_BYTES;
export const MAX_LINKED_VIDEO_FILE_BYTES = MAX_PERSISTED_LINKED_VIDEO_FILE_BYTES;

export interface DesktopLinkedVideoReadDescriptor extends Readonly<Record<string, unknown>> {
	readonly id: string;
	readonly url: string;
	readonly name: string;
	readonly size: number;
	readonly mimeType: string;
	readonly readProfile: string;
	readonly lastModified: number;
}

export interface DesktopLinkedVideoReadCapabilityStore {
	registerMaterializedPath(
		path: string,
		options: Readonly<{
			owner: object;
			mimeType: string;
			displayName: string;
		}>,
	): PromiseLike<DesktopLinkedVideoReadDescriptor> | DesktopLinkedVideoReadDescriptor;
	registerLinkedVideoPlaybackPath(
		path: string,
		options: Readonly<{
			owner: object;
			mimeType: string;
			displayName: string;
			expectedIdentity: PersistedLinkedVideoFileIdentity;
		}>,
	): PromiseLike<DesktopLinkedVideoReadDescriptor> | DesktopLinkedVideoReadDescriptor;
	release(
		id: string,
		options: Readonly<{ owner: object }>,
	): PromiseLike<boolean> | boolean;
}

export interface DesktopLinkedVideoLocator {
	readonly locatorId: string;
	readonly locatorRevision: string;
	readonly name: string;
	readonly size: number;
	readonly mimeType: string;
	readonly lastModified: number;
}

export interface LoadedDesktopLinkedVideoLocator {
	readonly locatorRevision: string;
	readonly descriptor: DesktopLinkedVideoReadDescriptor;
}

export interface DesktopLinkedVideoLocatorReference {
	readonly locatorId: string;
	readonly locatorRevision: string;
}

export interface DesktopLinkedOriginalLocatorReference extends DesktopLinkedVideoLocatorReference {
	readonly kind: LinkedOriginalMediaKind;
}

type FileIdentity = PersistedLinkedVideoFileIdentity;

interface OwnerState {
	readonly owner: object;
	revoked: boolean;
}

interface LocatorEntry extends DesktopLinkedVideoLocator {
	readonly kind: LinkedOriginalMediaKind;
	readonly path: string;
	readonly identity: FileIdentity;
}

export interface DesktopLinkedVideoLocatorStoreOptions {
	readonly readCapabilities: DesktopLinkedVideoReadCapabilityStore;
	readonly maximumCount?: number;
	readonly maximumBytes?: number;
	readonly randomBytes?: (size: number) => Uint8Array;
	readonly registry?: DesktopLinkedVideoLocatorRegistry | null;
	readonly stat?: (path: string) => PromiseLike<LinkedVideoFileStat> | LinkedVideoFileStat;
}

/** Main-process, renderer-owner-scoped grants for point-in-time video originals. */
export class DesktopLinkedVideoLocatorStore {
	readonly #entries = new Map<string, LocatorEntry>();
	readonly #maximumBytes: number;
	readonly #maximumCount: number;
	readonly #ownerStates = new WeakMap<object, OwnerState>();
	readonly #randomBytes: (size: number) => Uint8Array;
	readonly #readCapabilities: DesktopLinkedVideoReadCapabilityStore;
	readonly #registry: DesktopLinkedVideoLocatorRegistry | null;
	readonly #stat: (path: string) => PromiseLike<LinkedVideoFileStat> | LinkedVideoFileStat;
	readonly #startupEntries = new Map<string, LocatorEntry>();
	#bytes = 0;
	#count = 0;
	#disposed = false;
	#mutationTail: Promise<void> = Promise.resolve();
	#readyPromise: Promise<void> | null = null;
	#startupReconciled = false;

	constructor(options: DesktopLinkedVideoLocatorStoreOptions) {
		if (!options?.readCapabilities
			|| typeof options.readCapabilities.registerMaterializedPath !== 'function'
			|| typeof options.readCapabilities.registerLinkedVideoPlaybackPath !== 'function'
			|| typeof options.readCapabilities.release !== 'function') {
			throw new TypeError('A linked-video read capability store is required.');
		}
		this.#readCapabilities = options.readCapabilities;
		this.#maximumCount = boundedLimit(
			options.maximumCount ?? MAX_LINKED_VIDEO_LOCATORS,
			MAX_LINKED_VIDEO_LOCATORS,
			'Linked-video locator count',
		);
		this.#maximumBytes = boundedLimit(
			options.maximumBytes ?? MAX_LINKED_VIDEO_LOCATOR_BYTES,
			MAX_LINKED_VIDEO_LOCATOR_BYTES,
			'Linked-video locator bytes',
		);
		this.#randomBytes = options.randomBytes ?? nodeRandomBytes;
		this.#registry = options.registry ?? null;
		this.#stat = options.stat ?? nodeStat;
	}

	ready(): Promise<void> {
		if (this.#readyPromise) return this.#readyPromise;
		this.#readyPromise = this.#initialize();
		return this.#readyPromise;
	}

	async registerPath(
		path: string,
		options: Readonly<{
			kind?: LinkedOriginalMediaKind;
			owner: object;
			mimeType: string;
			displayName: string;
		}>,
	): Promise<Readonly<DesktopLinkedVideoLocator>> {
		await this.ready();
		this.#assertActive();
		const owner = requiredLocatorOwner(options?.owner);
		const absolutePath = absoluteLinkedOriginalPath(path);
		const kind = linkedOriginalMediaKind(options?.kind, 'video');
		const name = linkedOriginalDisplayName(options?.displayName);
		const mimeType = linkedOriginalMimeType(kind, options?.mimeType, name);
		const identity = persistedLinkedVideoFileIdentityFromStat(await this.#stat(absolutePath));
		if (identity.size < 1) throw new RangeError('A linked-video locator cannot reference an empty file.');
		if (identity.size > MAX_LINKED_VIDEO_FILE_BYTES || identity.size > this.#maximumBytes) {
			throw new RangeError('Linked-video file bytes exceed the admission limit.');
		}
		const state = this.#ownerState(owner);
		return this.#mutate(async () => {
			this.#assertActive();
			if (state.revoked) throw new Error('The linked-video locator owner was revoked.');
			if (this.#count >= this.#maximumCount) {
				throw new RangeError('Linked-video locator count exceeds the admission limit.');
			}
			if (identity.size > this.#maximumBytes - this.#bytes) {
				throw new RangeError('Linked-video locator bytes exceed the admission limit.');
			}
			const locatorId = this.#newToken();
			const entry: LocatorEntry = Object.freeze({
				kind,
				locatorId,
				locatorRevision: this.#newToken(),
				name,
				size: identity.size,
				mimeType,
				lastModified: linkedOriginalReadTimestamp(identity.mtimeMs),
				path: absolutePath,
				identity,
			});
			this.#add(entry);
			try {
				await this.#persist();
			} catch (error) {
				this.#drop(entry);
				throw error;
			}
			if (state.revoked) {
				this.#drop(entry);
				const error = new Error('The linked-video locator owner was revoked before publication.');
				try {
					await this.#persist();
				} catch (cleanupError) {
					throw new AggregateError(
						[error, cleanupError],
						'Linked-video locator revocation cleanup failed.',
						{ cause: error },
					);
				}
				throw error;
			}
			return publicLocator(entry);
		});
	}

	async load(
		locatorId: string,
		options: Readonly<{
			owner: object;
			expectedRevision: string | null;
			expectedKind?: LinkedOriginalMediaKind;
		}>,
	): Promise<Readonly<LoadedDesktopLinkedVideoLocator> | null> {
		return this.#load(
			locatorId,
			options,
			linkedOriginalMediaKind(options?.expectedKind, 'video'),
			false,
		);
	}

	async leasePlayback(
		locatorId: string,
		options: Readonly<{ owner: object; expectedRevision: string | null }>,
	): Promise<Readonly<LoadedDesktopLinkedVideoLocator> | null> {
		if (options?.expectedRevision === null) {
			throw new TypeError('Linked-video playback requires an exact locator revision.');
		}
		return this.#load(locatorId, options, 'video', true);
	}

	async #load(
		locatorId: string,
		options: Readonly<{ owner: object; expectedRevision: string | null }>,
		expectedKind: LinkedOriginalMediaKind,
		playback: boolean,
	): Promise<Readonly<LoadedDesktopLinkedVideoLocator> | null> {
		await this.ready();
		this.#assertActive();
		const id = linkedOriginalOpaqueToken(locatorId, 'Invalid linked-video locator identifier.');
		const owner = requiredLocatorOwner(options?.owner);
		const expectedRevision = nullableLocatorRevision(options?.expectedRevision);
		const state = this.#ownerState(owner);
		const entry = this.#entries.get(id);
		if (!entry || state.revoked
			|| expectedRevision !== null && entry.locatorRevision !== expectedRevision) return null;
		if (entry.kind !== expectedKind) {
			throw new Error(`A linked-${entry.kind} locator cannot be loaded as linked-${expectedKind}.`);
		}
		const before = await this.#currentIdentity(entry.path);
		if (!before || !samePersistedLinkedVideoFileIdentity(before, entry.identity)
			|| this.#entries.get(id) !== entry) return null;
		const descriptor = await (playback
			? this.#readCapabilities.registerLinkedVideoPlaybackPath(entry.path, {
				owner, mimeType: entry.mimeType, displayName: entry.name,
				expectedIdentity: entry.identity,
			})
			: this.#readCapabilities.registerMaterializedPath(entry.path, {
				owner, mimeType: entry.mimeType, displayName: entry.name,
			}));
		try {
			assertDescriptorMatches(
				descriptor, entry, playback ? 'linked-video-range-v1' : 'materialized-v1',
			);
			const after = playback ? entry.identity : await this.#currentIdentity(entry.path);
			if (!after || !samePersistedLinkedVideoFileIdentity(after, entry.identity)
				|| this.#entries.get(id) !== entry || state.revoked) {
				await this.#readCapabilities.release(descriptor.id, { owner });
				return null;
			}
			return Object.freeze({
				locatorRevision: entry.locatorRevision,
				descriptor: Object.freeze(descriptor),
			});
		} catch (error) {
			try {
				await this.#readCapabilities.release(descriptor.id, { owner });
			} catch (cleanupError) {
				throw new AggregateError(
					[error, cleanupError],
					'Linked-video read admission and cleanup both failed.',
					{ cause: cleanupError },
				);
			}
			throw error;
		}
	}

	async release(locatorId: string, options: Readonly<{
		owner: object; expectedRevision: string; expectedKind?: LinkedOriginalMediaKind;
	}>): Promise<boolean> {
		await this.ready();
		const id = linkedOriginalOpaqueToken(locatorId, 'Invalid linked-video locator identifier.');
		const owner = requiredLocatorOwner(options?.owner);
		const expectedRevision = linkedOriginalOpaqueToken(
			options?.expectedRevision,
			'Invalid linked-video locator revision.',
		);
		const expectedKind = linkedOriginalMediaKind(options?.expectedKind, 'video');
		const state = this.#ownerState(owner);
		return this.#mutate(async () => {
			if (state.revoked) return false;
			const entry = this.#entries.get(id);
			if (!entry || entry.locatorRevision !== expectedRevision) return false;
			if (entry.kind !== expectedKind) {
				throw new Error(`A linked-${entry.kind} locator cannot be released as linked-${expectedKind}.`);
			}
			this.#drop(entry);
			try {
				await this.#persist();
			} catch (error) {
				this.#add(entry);
				throw error;
			}
			if (state.revoked) {
				this.#add(entry);
				const error = new Error('The linked-video locator owner was revoked during release.');
				try {
					await this.#persist();
				} catch (cleanupError) {
					throw new AggregateError(
						[error, cleanupError],
						'Linked-video locator release revocation rollback failed.',
						{ cause: error },
					);
				}
				return false;
			}
			return true;
		});
	}

	/** Remove only startup-loaded metadata absent from one complete durable binding inventory. */
	async reconcileStartup(
		referencesValue: unknown,
		options: Readonly<{ owner: object }>,
	): Promise<number> {
		await this.ready();
		this.#assertActive();
		const references = locatorReferences(referencesValue);
		const owner = requiredLocatorOwner(options?.owner);
		const state = this.#ownerState(owner);
		return this.#mutate(async () => {
			this.#assertActive();
			if (state.revoked) throw new Error('The linked-video locator owner was revoked.');
			if (this.#startupReconciled) return 0;
			const referencedRevisions = new Map<string, string>();
			for (const reference of references) {
				const entry = this.#entries.get(reference.locatorId);
				if (!entry) throw new Error('Linked-video reconciliation references an unknown locator.');
				if (entry.locatorRevision !== reference.locatorRevision) {
					throw new Error('Linked-video reconciliation references a stale locator revision.');
				}
				const referenceKind = 'kind' in reference ? reference.kind : 'video';
				if (entry.kind !== referenceKind) {
					throw new Error('Linked-original reconciliation references the wrong media kind.');
				}
				referencedRevisions.set(reference.locatorId, reference.locatorRevision);
			}
			const removed: LocatorEntry[] = [];
			for (const entry of this.#startupEntries.values()) {
				if (this.#entries.get(entry.locatorId) !== entry
					|| referencedRevisions.get(entry.locatorId) === entry.locatorRevision) continue;
				this.#drop(entry);
				removed.push(entry);
			}
			try {
				if (removed.length) await this.#persist();
			} catch (error) {
				for (const entry of removed) this.#add(entry);
				throw error;
			}
			if (state.revoked) {
				const error = new Error('The linked-video locator owner was revoked during reconciliation.');
				for (const entry of removed) this.#add(entry);
				try {
					if (removed.length) await this.#persist();
				} catch (cleanupError) {
					throw new AggregateError(
						[error, cleanupError],
						'Linked-video reconciliation revocation rollback failed.',
						{ cause: error },
					);
				}
				throw error;
			}
			this.#startupReconciled = true;
			this.#startupEntries.clear();
			return removed.length;
		});
	}

	revokeOwner(ownerValue: object): void {
		const owner = requiredLocatorOwner(ownerValue);
		const state = this.#ownerState(owner);
		state.revoked = true;
	}

	async dispose(): Promise<number> {
		if (this.#disposed) return 0;
		await this.ready();
		await this.#mutationTail;
		this.#disposed = true;
		const removed = this.#entries.size;
		this.#entries.clear();
		this.#startupEntries.clear();
		this.#count = 0;
		this.#bytes = 0;
		return removed;
	}

	async #initialize(): Promise<void> {
		if (!this.#registry) return;
		const records = await this.#registry.read();
		if (!Array.isArray(records)) throw new TypeError('Linked-video locator registry returned invalid entries.');
		for (const record of records) {
			const entry = normalizePersistedLinkedVideoLocator(record) as LocatorEntry;
			if (this.#entries.has(entry.locatorId)) {
				throw new Error('Linked-video locator registry returned duplicate identifiers.');
			}
			if (this.#count >= this.#maximumCount || entry.size > this.#maximumBytes - this.#bytes) {
				throw new RangeError('Persisted linked-video locator admission exceeds configured limits.');
			}
			this.#add(entry);
			this.#startupEntries.set(entry.locatorId, entry);
		}
	}

	async #currentIdentity(path: string): Promise<FileIdentity | null> {
		try {
			return persistedLinkedVideoFileIdentityFromStat(await this.#stat(path));
		} catch {
			return null;
		}
	}

	#drop(entry: LocatorEntry): void {
		if (this.#entries.get(entry.locatorId) !== entry) return;
		this.#entries.delete(entry.locatorId);
		this.#count -= 1;
		this.#bytes -= entry.size;
	}

	#add(entry: LocatorEntry): void {
		this.#entries.set(entry.locatorId, entry);
		this.#count += 1;
		this.#bytes += entry.size;
	}

	#mutate<Value>(operation: () => Promise<Value>): Promise<Value> {
		const result = this.#mutationTail.then(operation);
		this.#mutationTail = result.then(() => undefined, () => undefined);
		return result;
	}

	#persist(): PromiseLike<void> | void {
		return this.#registry?.write([...this.#entries.values()].map(persistedEntry));
	}

	#newToken(): string {
		for (let attempt = 0; attempt < 8; attempt += 1) {
			const bytes = this.#randomBytes(32);
			if (!(bytes instanceof Uint8Array) || bytes.byteLength !== 32) {
				throw new Error('Secure linked-video locator token generation failed.');
			}
			const token = Buffer.from(bytes).toString('hex');
			if (!this.#entries.has(token)) return token;
		}
		throw new Error('Could not allocate a unique linked-video locator token.');
	}

	#ownerState(owner: object): OwnerState {
		let state = this.#ownerStates.get(owner);
		if (!state) {
			state = { owner, revoked: false };
			this.#ownerStates.set(owner, state);
		}
		return state;
	}

	#assertActive(): void {
		if (this.#disposed) throw new Error('The linked-video locator store is disposed.');
	}
}

function publicLocator(entry: LocatorEntry): Readonly<DesktopLinkedVideoLocator> {
	return Object.freeze({
		locatorId: entry.locatorId,
		locatorRevision: entry.locatorRevision,
		name: entry.name,
		size: entry.size,
		mimeType: entry.mimeType,
		lastModified: entry.lastModified,
	});
}

function persistedEntry(entry: LocatorEntry): Readonly<PersistedLinkedVideoLocator> {
	return normalizePersistedLinkedVideoLocator({
		kind: entry.kind,
		locatorId: entry.locatorId,
		locatorRevision: entry.locatorRevision,
		path: entry.path,
		name: entry.name,
		size: entry.size,
		mimeType: entry.mimeType,
		lastModified: entry.lastModified,
		identity: entry.identity,
	});
}

function assertDescriptorMatches(
	descriptor: DesktopLinkedVideoReadDescriptor,
	entry: LocatorEntry,
	expectedProfile: string,
): void {
	if (!descriptor || typeof descriptor !== 'object'
		|| !/^[a-f0-9]{64}$/u.test(descriptor.id)
		|| descriptor.readProfile !== expectedProfile
		|| descriptor.name !== entry.name
		|| descriptor.size !== entry.size
		|| descriptor.mimeType !== entry.mimeType
		|| descriptor.lastModified !== entry.lastModified) {
		throw new Error('The linked-video read descriptor does not match its locator snapshot.');
	}
}

function locatorReferences(
	value: unknown,
): readonly (DesktopLinkedVideoLocatorReference | DesktopLinkedOriginalLocatorReference)[] {
	if (!Array.isArray(value) || value.length > MAX_LINKED_VIDEO_LOCATORS) {
		throw new RangeError('Linked-video reconciliation reference count exceeds its limit.');
	}
	const identifiers = new Set<string>();
	return Object.freeze(value.map((item) => {
		if (!item || typeof item !== 'object' || Array.isArray(item)) {
			throw new TypeError('A linked-video reconciliation reference must be an object.');
		}
		const keys = Reflect.ownKeys(item);
		const hasKind = keys.includes('kind');
		const fields = hasKind ? ['kind', 'locatorId', 'locatorRevision'] : ['locatorId', 'locatorRevision'];
		if (keys.length !== fields.length || fields.some((field) => !keys.includes(field))) {
			throw new TypeError('A linked-video reconciliation reference contains an unsupported field.');
		}
		const candidate = item as Readonly<Record<string, unknown>>;
		for (const key of fields) {
			const descriptor = Object.getOwnPropertyDescriptor(item, key);
			if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
				throw new TypeError(`Linked-video reconciliation ${key} must be an enumerable data field.`);
			}
		}
		const locatorId = linkedOriginalOpaqueToken(candidate.locatorId, 'Invalid linked-video locator identifier.');
		if (identifiers.has(locatorId)) {
			throw new Error('Linked-video reconciliation references duplicate locator identifiers.');
		}
		identifiers.add(locatorId);
		return Object.freeze({
			...(hasKind ? { kind: linkedOriginalMediaKind(candidate.kind) } : {}),
			locatorId,
			locatorRevision: linkedOriginalOpaqueToken(
				candidate.locatorRevision,
				'Invalid linked-video locator revision.',
			),
		});
	}));
}
