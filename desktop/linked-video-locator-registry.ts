/* SPDX-License-Identifier: AGPL-3.0-only */

import { randomBytes as nodeRandomBytes } from 'node:crypto';
import {
	lstat,
	mkdir,
	open,
	readFile,
	rename,
	rm,
} from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';

import {
	linkedOriginalMediaKind,
	linkedOriginalMimeType,
	type LinkedOriginalMediaKind,
} from './linked-original-locator-validation.ts';

export const LINKED_VIDEO_LOCATOR_REGISTRY_SCHEMA_VERSION = 2;
export const MAX_PERSISTED_LINKED_VIDEO_LOCATORS = 128;
export const MAX_PERSISTED_LINKED_VIDEO_FILE_BYTES = 512 * 1024 ** 2;
export const MAX_PERSISTED_LINKED_VIDEO_BYTES = 64 * 1024 ** 3;
const MAX_REGISTRY_FILE_BYTES = 1024 * 1024;

export interface PersistedLinkedVideoFileIdentity {
	readonly dev: number;
	readonly ino: number;
	readonly size: number;
	readonly mtimeMs: number;
	readonly ctimeMs: number;
}

export interface LinkedVideoFileStat extends PersistedLinkedVideoFileIdentity {
	isFile(): boolean;
}

export function persistedLinkedVideoFileIdentityFromStat(
	value: LinkedVideoFileStat,
): Readonly<PersistedLinkedVideoFileIdentity> {
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

export function samePersistedLinkedVideoFileIdentity(
	left: PersistedLinkedVideoFileIdentity,
	right: PersistedLinkedVideoFileIdentity,
): boolean {
	return left.dev === right.dev && left.ino === right.ino && left.size === right.size
		&& left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs;
}

export interface PersistedLinkedVideoLocator {
	readonly kind: LinkedOriginalMediaKind;
	readonly locatorId: string;
	readonly locatorRevision: string;
	readonly path: string;
	readonly name: string;
	readonly size: number;
	readonly mimeType: string;
	readonly lastModified: number;
	readonly identity: PersistedLinkedVideoFileIdentity;
}

export interface DesktopLinkedVideoLocatorRegistry {
	read(): PromiseLike<readonly PersistedLinkedVideoLocator[]> | readonly PersistedLinkedVideoLocator[];
	write(
		entries: readonly PersistedLinkedVideoLocator[],
	): PromiseLike<void> | void;
}

export interface FileDesktopLinkedVideoLocatorRegistryOptions {
	readonly randomBytes?: (size: number) => Uint8Array;
}

/** Private, product-local atomic persistence for opaque locator metadata. */
export class FileDesktopLinkedVideoLocatorRegistry implements DesktopLinkedVideoLocatorRegistry {
	readonly #path: string;
	readonly #randomBytes: (size: number) => Uint8Array;

	constructor(path: string, options: FileDesktopLinkedVideoLocatorRegistryOptions = {}) {
		if (typeof path !== 'string' || !isAbsolute(path)) {
			throw new TypeError('The linked-video locator registry path must be absolute.');
		}
		this.#path = resolve(path);
		this.#randomBytes = options.randomBytes ?? nodeRandomBytes;
	}

	async read(): Promise<readonly PersistedLinkedVideoLocator[]> {
		let metadata;
		try {
			metadata = await lstat(this.#path);
		} catch (error) {
			if (errorCode(error) === 'ENOENT') return Object.freeze([]);
			throw error;
		}
		if (!metadata.isFile() || metadata.isSymbolicLink()) {
			throw new Error('The linked-video locator registry must be a regular non-symbolic file.');
		}
		if (!Number.isSafeInteger(metadata.size) || metadata.size < 1
			|| metadata.size > MAX_REGISTRY_FILE_BYTES) {
			throw new RangeError('The linked-video locator registry exceeds its byte limit.');
		}
		const bytes = await readFile(this.#path);
		if (bytes.byteLength !== metadata.size) {
			throw new Error('The linked-video locator registry changed while it was read.');
		}
		let parsed: unknown;
		try {
			parsed = JSON.parse(String(bytes));
		} catch (error) {
			throw new Error('The linked-video locator registry is not valid JSON.', { cause: error });
		}
		return normalizeRegistry(parsed);
	}

	async write(entries: readonly PersistedLinkedVideoLocator[]): Promise<void> {
		const normalized = normalizeEntries(entries, false);
		const document = Object.freeze({
			schemaVersion: LINKED_VIDEO_LOCATOR_REGISTRY_SCHEMA_VERSION,
			entries: normalized,
		});
		const bytes = Buffer.from(`${JSON.stringify(document)}\n`, 'utf8');
		if (bytes.byteLength > MAX_REGISTRY_FILE_BYTES) {
			throw new RangeError('The linked-video locator registry exceeds its byte limit.');
		}
		const parent = dirname(this.#path);
		await mkdir(parent, { recursive: true, mode: 0o700 });
		const temporaryPath = `${this.#path}.${this.#temporaryToken()}.tmp`;
		let published = false;
		let handle = null;
		try {
			handle = await open(temporaryPath, 'wx', 0o600);
			await handle.writeFile(bytes);
			await handle.sync();
			await handle.close();
			handle = null;
			await rename(temporaryPath, this.#path);
			published = true;
			await syncDirectory(parent);
		} finally {
			await handle?.close().catch(() => undefined);
			if (!published) await rm(temporaryPath, { force: true }).catch(() => undefined);
		}
	}

	#temporaryToken(): string {
		const bytes = this.#randomBytes(16);
		if (!(bytes instanceof Uint8Array) || bytes.byteLength !== 16) {
			throw new Error('Secure linked-video registry staging token generation failed.');
		}
		return Buffer.from(bytes).toString('hex');
	}
}

export function normalizePersistedLinkedVideoLocator(
	value: unknown,
): Readonly<PersistedLinkedVideoLocator> {
	return normalizePersistedLocator(value, true);
}

function normalizePersistedLocator(
	value: unknown,
	allowLegacyVideo: boolean,
): Readonly<PersistedLinkedVideoLocator> {
	const record = value && typeof value === 'object' && !Array.isArray(value) ? value : null;
	const legacy = allowLegacyVideo && record !== null && !Object.hasOwn(record, 'kind');
	const candidate = closedRecord(value, [
		...(legacy ? [] : ['kind']),
		'locatorId', 'locatorRevision', 'path', 'name', 'size', 'mimeType',
		'lastModified', 'identity',
	], 'Persisted linked-video locator');
	const kind = linkedOriginalMediaKind(legacy ? undefined : candidate.kind, 'video');
	const identity = normalizeIdentity(candidate.identity);
	const size = positiveSafeInteger(candidate.size, 'Persisted linked-video locator size');
	if (size !== identity.size || size > MAX_PERSISTED_LINKED_VIDEO_FILE_BYTES) {
		throw new RangeError('Persisted linked-video locator size does not match its file identity.');
	}
	const lastModified = nonnegativeSafeInteger(
		candidate.lastModified,
		'Persisted linked-video locator modification time',
	);
	if (lastModified !== Math.max(0, Math.trunc(identity.mtimeMs))) {
		throw new RangeError('Persisted linked-video locator modification time does not match its file identity.');
	}
	const name = displayName(candidate.name);
	return Object.freeze({
		kind,
		locatorId: opaqueToken(candidate.locatorId, 'locator identifier'),
		locatorRevision: opaqueToken(candidate.locatorRevision, 'locator revision'),
		path: absolutePath(candidate.path),
		name,
		size,
		mimeType: linkedOriginalMimeType(kind, candidate.mimeType, name, 'Persisted linked-original locator'),
		lastModified,
		identity,
	});
}

function normalizeRegistry(value: unknown): readonly PersistedLinkedVideoLocator[] {
	const document = closedRecord(value, ['schemaVersion', 'entries'], 'Linked-video locator registry');
	if (document.schemaVersion !== 1
		&& document.schemaVersion !== LINKED_VIDEO_LOCATOR_REGISTRY_SCHEMA_VERSION) {
		throw new RangeError('Unsupported linked-video locator registry schema version.');
	}
	if (!Array.isArray(document.entries)) {
		throw new TypeError('Linked-video locator registry entries must be an array.');
	}
	return normalizeEntries(document.entries, document.schemaVersion === 1);
}

function normalizeEntries(
	value: readonly unknown[],
	allowLegacyVideo: boolean,
): readonly PersistedLinkedVideoLocator[] {
	if (!Array.isArray(value) || value.length > MAX_PERSISTED_LINKED_VIDEO_LOCATORS) {
		throw new RangeError('Linked-video locator registry entry count exceeds its limit.');
	}
	const entries = value.map((entry) => normalizePersistedLocator(entry, allowLegacyVideo))
		.sort((left, right) => left.locatorId.localeCompare(right.locatorId));
	if (new Set(entries.map(({ locatorId }) => locatorId)).size !== entries.length) {
		throw new Error('Linked-video locator registry contains duplicate identifiers.');
	}
	const totalBytes = entries.reduce((sum, entry) => sum + entry.size, 0);
	if (!Number.isSafeInteger(totalBytes) || totalBytes > MAX_PERSISTED_LINKED_VIDEO_BYTES) {
		throw new RangeError('Linked-video locator registry aggregate bytes exceed their limit.');
	}
	return Object.freeze(entries);
}

function normalizeIdentity(value: unknown): Readonly<PersistedLinkedVideoFileIdentity> {
	const candidate = closedRecord(
		value,
		['dev', 'ino', 'size', 'mtimeMs', 'ctimeMs'],
		'Persisted linked-video file identity',
	);
	return Object.freeze({
		dev: nonnegativeFinite(candidate.dev, 'file device'),
		ino: nonnegativeFinite(candidate.ino, 'file inode'),
		size: positiveSafeInteger(candidate.size, 'file size'),
		mtimeMs: nonnegativeFinite(candidate.mtimeMs, 'file modification time'),
		ctimeMs: nonnegativeFinite(candidate.ctimeMs, 'file change time'),
	});
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
		if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`${label} ${field} must be an enumerable data field.`);
		}
		output[field] = descriptor.value;
	}
	return output;
}

function opaqueToken(value: unknown, label: string): string {
	if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) {
		throw new TypeError(`Persisted linked-video ${label} is invalid.`);
	}
	return value;
}

function absolutePath(value: unknown): string {
	if (typeof value !== 'string' || !isAbsolute(value) || value.length > 4096
		|| /[\u0000-\u001f]/u.test(value)) {
		throw new TypeError('Persisted linked-video path is invalid.');
	}
	return resolve(value);
}

function displayName(value: unknown): string {
	if (typeof value !== 'string' || !value || value !== value.trim()
		|| value.length > 255 || value === '.' || value === '..'
		|| value.includes('/') || value.includes('\\') || /[\u0000-\u001f]/u.test(value)) {
		throw new TypeError('Persisted linked-video display name is invalid.');
	}
	return value;
}

function positiveSafeInteger(value: unknown, label: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1) throw new RangeError(`${label} is invalid.`);
	return Number(value);
}

function nonnegativeSafeInteger(value: unknown, label: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) throw new RangeError(`${label} is invalid.`);
	return Number(value);
}

function nonnegativeFinite(value: unknown, label: string): number {
	if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
		throw new RangeError(`Persisted linked-video ${label} is invalid.`);
	}
	return value;
}

function errorCode(error: unknown): string | null {
	return error && typeof error === 'object' && 'code' in error
		? String((error as Readonly<{ code?: unknown }>).code ?? '')
		: null;
}

async function syncDirectory(path: string): Promise<void> {
	let handle = null;
	try {
		handle = await open(path, 'r');
		await handle.sync();
	} catch (error) {
		if (!['EINVAL', 'ENOTSUP', 'EISDIR', 'EPERM'].includes(errorCode(error) ?? '')) throw error;
	} finally {
		await handle?.close().catch(() => undefined);
	}
}
