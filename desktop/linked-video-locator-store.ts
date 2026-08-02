/* SPDX-License-Identifier: AGPL-3.0-only */

import { randomBytes as nodeRandomBytes } from 'node:crypto';
import { stat as nodeStat } from 'node:fs/promises';
import { isAbsolute } from 'node:path';

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

type FileIdentity = PersistedLinkedVideoFileIdentity;

interface OwnerState {
	readonly owner: object;
	revoked: boolean;
}

interface LocatorEntry extends DesktopLinkedVideoLocator {
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
			owner: object;
			mimeType: string;
			displayName: string;
		}>,
	): Promise<Readonly<DesktopLinkedVideoLocator>> {
		await this.ready();
		this.#assertActive();
		const owner = requiredOwner(options?.owner);
		const absolutePath = absoluteFilePath(path);
		const mimeType = videoMimeType(options?.mimeType);
		const name = displayName(options?.displayName);
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
				locatorId,
				locatorRevision: this.#newToken(),
				name,
				size: identity.size,
				mimeType,
				lastModified: readTimestamp(identity.mtimeMs),
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
		}>,
	): Promise<Readonly<LoadedDesktopLinkedVideoLocator> | null> {
		return this.#load(locatorId, options, false);
	}

	async leasePlayback(
		locatorId: string,
		options: Readonly<{ owner: object; expectedRevision: string | null }>,
	): Promise<Readonly<LoadedDesktopLinkedVideoLocator> | null> {
		if (options?.expectedRevision === null) {
			throw new TypeError('Linked-video playback requires an exact locator revision.');
		}
		return this.#load(locatorId, options, true);
	}

	async #load(
		locatorId: string,
		options: Readonly<{ owner: object; expectedRevision: string | null }>,
		playback: boolean,
	): Promise<Readonly<LoadedDesktopLinkedVideoLocator> | null> {
		await this.ready();
		this.#assertActive();
		const id = opaqueToken(locatorId, 'Invalid linked-video locator identifier.');
		const owner = requiredOwner(options?.owner);
		const expectedRevision = nullableRevision(options?.expectedRevision);
		const state = this.#ownerState(owner);
		const entry = this.#entries.get(id);
		if (!entry || state.revoked
			|| expectedRevision !== null && entry.locatorRevision !== expectedRevision) return null;
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

	async release(locatorId: string, options: Readonly<{ owner: object }>): Promise<boolean> {
		await this.ready();
		const id = opaqueToken(locatorId, 'Invalid linked-video locator identifier.');
		const owner = requiredOwner(options?.owner);
		const state = this.#ownerState(owner);
		return this.#mutate(async () => {
			if (state.revoked) return false;
			const entry = this.#entries.get(id);
			if (!entry) return false;
			this.#drop(entry);
			try {
				await this.#persist();
			} catch (error) {
				this.#add(entry);
				throw error;
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
		const owner = requiredOwner(options?.owner);
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
		const owner = requiredOwner(ownerValue);
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

function boundedLimit(value: number, maximum: number, label: string): number {
	if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
		throw new RangeError(`${label} must be a positive integer no greater than ${maximum}.`);
	}
	return value;
}

function requiredOwner(value: unknown): object {
	if ((typeof value !== 'object' || value === null) && typeof value !== 'function') {
		throw new TypeError('A linked-video locator owner is required.');
	}
	return value as object;
}

function absoluteFilePath(value: unknown): string {
	if (typeof value !== 'string' || !isAbsolute(value)) {
		throw new TypeError('A linked-video locator requires an absolute file path.');
	}
	return value;
}

function videoMimeType(value: unknown): string {
	if (typeof value !== 'string' || value.length > 128
		|| !/^video\/[a-z0-9][a-z0-9!#$&^_.+-]*$/u.test(value)) {
		throw new TypeError('A linked-video locator requires a canonical video MIME type.');
	}
	return value;
}

function displayName(value: unknown): string {
	if (typeof value !== 'string' || !value || value !== value.trim()
		|| value.length > 255 || value === '.' || value === '..'
		|| value.includes('/') || value.includes('\\') || /[\u0000-\u001f]/u.test(value)) {
		throw new TypeError('A linked-video locator display name is invalid.');
	}
	return value;
}

function opaqueToken(value: unknown, message: string): string {
	if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) throw new TypeError(message);
	return value;
}

function nullableRevision(value: unknown): string | null {
	return value === null
		? null
		: opaqueToken(value, 'Invalid linked-video locator revision.');
}

function locatorReferences(value: unknown): readonly DesktopLinkedVideoLocatorReference[] {
	if (!Array.isArray(value) || value.length > MAX_LINKED_VIDEO_LOCATORS) {
		throw new RangeError('Linked-video reconciliation reference count exceeds its limit.');
	}
	const identifiers = new Set<string>();
	return Object.freeze(value.map((item) => {
		if (!item || typeof item !== 'object' || Array.isArray(item)) {
			throw new TypeError('A linked-video reconciliation reference must be an object.');
		}
		const keys = Reflect.ownKeys(item);
		if (keys.length !== 2 || !keys.includes('locatorId') || !keys.includes('locatorRevision')) {
			throw new TypeError('A linked-video reconciliation reference contains an unsupported field.');
		}
		const candidate = item as Readonly<Record<string, unknown>>;
		for (const key of ['locatorId', 'locatorRevision']) {
			const descriptor = Object.getOwnPropertyDescriptor(item, key);
			if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
				throw new TypeError(`Linked-video reconciliation ${key} must be an enumerable data field.`);
			}
		}
		const locatorId = opaqueToken(candidate.locatorId, 'Invalid linked-video locator identifier.');
		if (identifiers.has(locatorId)) {
			throw new Error('Linked-video reconciliation references duplicate locator identifiers.');
		}
		identifiers.add(locatorId);
		return Object.freeze({
			locatorId,
			locatorRevision: opaqueToken(
				candidate.locatorRevision,
				'Invalid linked-video locator revision.',
			),
		});
	}));
}

function readTimestamp(value: number): number {
	const timestamp = Math.max(0, Math.trunc(value));
	if (!Number.isSafeInteger(timestamp)) throw new RangeError('Linked-video modification time is invalid.');
	return timestamp;
}
