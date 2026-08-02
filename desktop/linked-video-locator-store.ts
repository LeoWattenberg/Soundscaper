/* SPDX-License-Identifier: AGPL-3.0-only */

import { randomBytes as nodeRandomBytes } from 'node:crypto';
import { stat as nodeStat } from 'node:fs/promises';
import { isAbsolute } from 'node:path';

export const MAX_LINKED_VIDEO_LOCATORS = 32;
export const MAX_LINKED_VIDEO_LOCATOR_BYTES = 512 * 1024 ** 2;

export interface DesktopLinkedVideoReadDescriptor extends Readonly<Record<string, unknown>> {
	readonly id: string;
	readonly name: string;
	readonly size: number;
	readonly mimeType: string;
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

interface FileStat {
	readonly dev: number;
	readonly ino: number;
	readonly size: number;
	readonly mtimeMs: number;
	readonly ctimeMs: number;
	isFile(): boolean;
}

interface FileIdentity {
	readonly dev: number;
	readonly ino: number;
	readonly size: number;
	readonly mtimeMs: number;
	readonly ctimeMs: number;
}

interface OwnerState {
	readonly owner: object;
	bytes: number;
	count: number;
	revoked: boolean;
}

interface LocatorEntry extends DesktopLinkedVideoLocator {
	readonly owner: object;
	readonly ownerState: OwnerState;
	readonly path: string;
	readonly identity: FileIdentity;
}

export interface DesktopLinkedVideoLocatorStoreOptions {
	readonly readCapabilities: DesktopLinkedVideoReadCapabilityStore;
	readonly maximumCount?: number;
	readonly maximumBytes?: number;
	readonly randomBytes?: (size: number) => Uint8Array;
	readonly stat?: (path: string) => PromiseLike<FileStat> | FileStat;
}

/** Main-process, renderer-owner-scoped grants for point-in-time video originals. */
export class DesktopLinkedVideoLocatorStore {
	readonly #entries = new Map<string, LocatorEntry>();
	readonly #maximumBytes: number;
	readonly #maximumCount: number;
	readonly #ownerStates = new WeakMap<object, OwnerState>();
	readonly #randomBytes: (size: number) => Uint8Array;
	readonly #readCapabilities: DesktopLinkedVideoReadCapabilityStore;
	readonly #stat: (path: string) => PromiseLike<FileStat> | FileStat;
	#bytes = 0;
	#count = 0;
	#disposed = false;

	constructor(options: DesktopLinkedVideoLocatorStoreOptions) {
		if (!options?.readCapabilities
			|| typeof options.readCapabilities.registerMaterializedPath !== 'function'
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
		this.#stat = options.stat ?? nodeStat;
	}

	async registerPath(
		path: string,
		options: Readonly<{
			owner: object;
			mimeType: string;
			displayName: string;
		}>,
	): Promise<Readonly<DesktopLinkedVideoLocator>> {
		this.#assertActive();
		const owner = requiredOwner(options?.owner);
		const absolutePath = absoluteFilePath(path);
		const mimeType = videoMimeType(options?.mimeType);
		const name = displayName(options?.displayName);
		const identity = fileIdentity(await this.#stat(absolutePath));
		if (identity.size < 1) throw new RangeError('A linked-video locator cannot reference an empty file.');
		if (identity.size > this.#maximumBytes) {
			throw new RangeError('Linked-video locator bytes exceed the admission limit.');
		}
		const state = this.#ownerState(owner);
		if (state.revoked) throw new Error('The linked-video locator owner was revoked.');
		if (this.#count >= this.#maximumCount || state.count >= this.#maximumCount) {
			throw new RangeError('Linked-video locator count exceeds the admission limit.');
		}
		if (identity.size > this.#maximumBytes - this.#bytes
			|| identity.size > this.#maximumBytes - state.bytes) {
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
			owner,
			ownerState: state,
			path: absolutePath,
			identity,
		});
		this.#entries.set(locatorId, entry);
		this.#count += 1;
		this.#bytes += entry.size;
		state.count += 1;
		state.bytes += entry.size;
		return publicLocator(entry);
	}

	async load(
		locatorId: string,
		options: Readonly<{
			owner: object;
			expectedRevision: string | null;
		}>,
	): Promise<Readonly<LoadedDesktopLinkedVideoLocator> | null> {
		this.#assertActive();
		const id = opaqueToken(locatorId, 'Invalid linked-video locator identifier.');
		const owner = requiredOwner(options?.owner);
		const expectedRevision = nullableRevision(options?.expectedRevision);
		const entry = this.#entries.get(id);
		if (!entry || entry.owner !== owner || entry.ownerState.revoked
			|| expectedRevision !== null && entry.locatorRevision !== expectedRevision) return null;
		const before = await this.#currentIdentity(entry.path);
		if (!before || !sameFileIdentity(before, entry.identity)
			|| this.#entries.get(id) !== entry) return null;
		const descriptor = await this.#readCapabilities.registerMaterializedPath(entry.path, {
			owner,
			mimeType: entry.mimeType,
			displayName: entry.name,
		});
		try {
			assertDescriptorMatches(descriptor, entry);
			const after = await this.#currentIdentity(entry.path);
			if (!after || !sameFileIdentity(after, entry.identity)
				|| this.#entries.get(id) !== entry || entry.ownerState.revoked) {
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

	release(locatorId: string, options: Readonly<{ owner: object }>): boolean {
		const id = opaqueToken(locatorId, 'Invalid linked-video locator identifier.');
		const owner = requiredOwner(options?.owner);
		const entry = this.#entries.get(id);
		if (!entry || entry.owner !== owner) return false;
		this.#drop(entry);
		return true;
	}

	revokeOwner(ownerValue: object): number {
		const owner = requiredOwner(ownerValue);
		const state = this.#ownerState(owner);
		state.revoked = true;
		let removed = 0;
		for (const entry of [...this.#entries.values()]) {
			if (entry.owner !== owner) continue;
			this.#drop(entry);
			removed += 1;
		}
		return removed;
	}

	dispose(): number {
		if (this.#disposed) return 0;
		this.#disposed = true;
		const removed = this.#entries.size;
		this.#entries.clear();
		this.#count = 0;
		this.#bytes = 0;
		return removed;
	}

	async #currentIdentity(path: string): Promise<FileIdentity | null> {
		try {
			return fileIdentity(await this.#stat(path));
		} catch {
			return null;
		}
	}

	#drop(entry: LocatorEntry): void {
		if (this.#entries.get(entry.locatorId) !== entry) return;
		this.#entries.delete(entry.locatorId);
		this.#count -= 1;
		this.#bytes -= entry.size;
		entry.ownerState.count -= 1;
		entry.ownerState.bytes -= entry.size;
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
			state = { owner, bytes: 0, count: 0, revoked: false };
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

function fileIdentity(value: FileStat): Readonly<FileIdentity> {
	if (!value?.isFile()) throw new TypeError('A linked-video locator requires a regular file.');
	if (!Number.isSafeInteger(value.size) || value.size < 0) {
		throw new RangeError('Linked-video file size is invalid.');
	}
	for (const field of ['dev', 'ino', 'mtimeMs', 'ctimeMs'] as const) {
		if (typeof value[field] !== 'number' || !Number.isFinite(value[field]) || value[field] < 0) {
			throw new RangeError(`Linked-video file ${field} is invalid.`);
		}
	}
	return Object.freeze({
		dev: value.dev,
		ino: value.ino,
		size: value.size,
		mtimeMs: value.mtimeMs,
		ctimeMs: value.ctimeMs,
	});
}

function sameFileIdentity(left: FileIdentity, right: FileIdentity): boolean {
	return left.dev === right.dev
		&& left.ino === right.ino
		&& left.size === right.size
		&& left.mtimeMs === right.mtimeMs
		&& left.ctimeMs === right.ctimeMs;
}

function assertDescriptorMatches(
	descriptor: DesktopLinkedVideoReadDescriptor,
	entry: LocatorEntry,
): void {
	if (!descriptor || typeof descriptor !== 'object'
		|| !/^[a-f0-9]{64}$/u.test(descriptor.id)
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

function readTimestamp(value: number): number {
	const timestamp = Math.max(0, Math.trunc(value));
	if (!Number.isSafeInteger(timestamp)) throw new RangeError('Linked-video modification time is invalid.');
	return timestamp;
}
