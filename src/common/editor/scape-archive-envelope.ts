/* SPDX-License-Identifier: AGPL-3.0-only */

import { awaitScapeOperation, throwIfScapeAborted } from './scape-abort.ts';
import { ScapeExpandedByteBudget } from './scape-expanded-byte-budget.ts';

export const SCAPE_FORMAT = 'scape-project';
export const SCAPE_FORMAT_VERSION = 1;
export const SCAPE_MANIFEST_ENTRY = 'manifest.json';
export const SCAPE_PROJECT_ENTRY = 'project.json';

export interface ScapeArchiveLimits {
	maximumEntryCount: number;
	maximumManifestBytes: number;
	maximumProjectBytes: number;
	maximumExpandedBytes: number;
}

export const SCAPE_ARCHIVE_LIMITS: Readonly<ScapeArchiveLimits> = Object.freeze({
	maximumEntryCount: 4_096,
	maximumManifestBytes: 32 * 1024 * 1024,
	maximumProjectBytes: 256 * 1024 * 1024,
	maximumExpandedBytes: 64 * 1024 * 1024 * 1024,
});

export interface ScapeArchiveEntry {
	filename: string;
	directory: boolean;
	encrypted: boolean;
	compressedSize: number;
	uncompressedSize: number;
	getData?: (
		writable: WritableStream<Uint8Array>,
		options?: Readonly<{
			signal?: AbortSignal;
			strictness?: 'strict';
			checkOverlappingEntry?: boolean;
			checkOverlappingEntryOnly?: boolean;
		}>,
	) => Promise<unknown>;
}

export interface ScapeDescriptor {
	entry: string;
	size: number;
	sha256: string;
}

export interface ScapeProjectDescriptor extends ScapeDescriptor {
	mimeType?: string;
	schemaVersion?: number;
}

export interface ScapeAssetDescriptor extends ScapeDescriptor {
	sourceId: string;
	kind: 'audio' | 'video';
	encoding: string;
	mimeType?: string;
}

export interface ScapeManifest {
	format: typeof SCAPE_FORMAT;
	formatVersion: typeof SCAPE_FORMAT_VERSION;
	createdAt?: string;
	project: ScapeProjectDescriptor;
	assets: ScapeAssetDescriptor[];
}

export interface ScapeArchiveEnvelope {
	entryByName: Map<string, ScapeArchiveEntry>;
	expandedByteBudget: ScapeExpandedByteBudget;
	manifest: ScapeManifest;
	projectText: string;
}

export async function readScapeArchiveEnvelope(
	entries: readonly ScapeArchiveEntry[],
	limitOverrides: Partial<ScapeArchiveLimits> = {},
	signal?: AbortSignal,
): Promise<ScapeArchiveEnvelope> {
	throwIfScapeAborted(signal);
	const limits = resolveLimits(limitOverrides);
	const expandedByteBudget = new ScapeExpandedByteBudget(limits.maximumExpandedBytes);
	const entryByName = indexEntries(entries, limits, signal);
	await validateEntryLayouts(entryByName.values(), signal);
	const manifestEntry = requiredFileEntry(entryByName, SCAPE_MANIFEST_ENTRY);
	assertMetadataLimit(manifestEntry, SCAPE_MANIFEST_ENTRY, limits.maximumManifestBytes);
	const manifestText = await readBoundedTextEntry(
		manifestEntry,
		SCAPE_MANIFEST_ENTRY,
		limits.maximumManifestBytes,
		expandedByteBudget,
		signal,
	);
	throwIfScapeAborted(signal);
	const manifest = parseScapeManifest(manifestText);
	validateManifestOwnership(manifest, entryByName, limits);
	const projectEntry = requiredFileEntry(entryByName, SCAPE_PROJECT_ENTRY);
	const projectText = await readBoundedTextEntry(
		projectEntry,
		SCAPE_PROJECT_ENTRY,
		limits.maximumProjectBytes,
		expandedByteBudget,
		signal,
	);
	throwIfScapeAborted(signal);
	return { entryByName, expandedByteBudget, manifest, projectText };
}

async function validateEntryLayouts(
	entries: Iterable<ScapeArchiveEntry>,
	signal?: AbortSignal,
): Promise<void> {
	for (const entry of entries) {
		throwIfScapeAborted(signal);
		if (typeof entry.getData !== 'function') continue;
		await awaitScapeOperation(entry.getData(new WritableStream<Uint8Array>(), {
			signal,
			strictness: 'strict',
			checkOverlappingEntryOnly: true,
		}), signal);
		throwIfScapeAborted(signal);
	}
}

function resolveLimits(overrides: Partial<ScapeArchiveLimits>): ScapeArchiveLimits {
	for (const name of Object.keys(overrides)) {
		if (!Object.hasOwn(SCAPE_ARCHIVE_LIMITS, name)) {
			throw new TypeError(`Unsupported .scape archive limit: ${name}.`);
		}
	}
	const limits = { ...SCAPE_ARCHIVE_LIMITS, ...overrides };
	for (const name of Object.keys(SCAPE_ARCHIVE_LIMITS) as (keyof ScapeArchiveLimits)[]) {
		const value = limits[name];
		if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(`Invalid .scape ${name} limit.`);
		if (value > SCAPE_ARCHIVE_LIMITS[name]) {
			throw new RangeError(`The .scape ${name} limit cannot exceed the hard limit.`);
		}
	}
	return limits;
}

function indexEntries(
	entries: readonly ScapeArchiveEntry[],
	limits: ScapeArchiveLimits,
	signal?: AbortSignal,
): Map<string, ScapeArchiveEntry> {
	if (entries.length > limits.maximumEntryCount) {
		throw new RangeError('The .scape archive contains too many entries.');
	}
	const entryByName = new Map<string, ScapeArchiveEntry>();
	let declaredExpandedBytes = 0;
	for (const entry of entries) {
		throwIfScapeAborted(signal);
		validateScapeEntryName(entry.filename);
		if (entryByName.has(entry.filename)) throw new Error(`Duplicate .scape entry: ${entry.filename}.`);
		if (entry.directory) throw new Error(`The .scape archive contains an unsupported directory entry: ${entry.filename}.`);
		if (entry.encrypted) throw new Error(`The .scape archive contains ${entry.filename}; encrypted entries are not supported.`);
		validateEntrySize(entry.compressedSize, entry.filename, 'compressed');
		validateEntrySize(entry.uncompressedSize, entry.filename, 'uncompressed');
		if (entry.uncompressedSize > limits.maximumExpandedBytes - declaredExpandedBytes) {
			throw new RangeError('The .scape archive exceeds the declared expansion limit.');
		}
		declaredExpandedBytes += entry.uncompressedSize;
		entryByName.set(entry.filename, entry);
	}
	return entryByName;
}

function validateEntrySize(value: number, filename: string, label: string): void {
	if (!Number.isSafeInteger(value) || value < 0) {
		throw new RangeError(`The .scape entry ${filename} has an invalid ${label} size.`);
	}
}

function assertMetadataLimit(entry: ScapeArchiveEntry, label: string, maximumBytes: number): void {
	if (entry.uncompressedSize > maximumBytes) throw new RangeError(`${label} exceeds the metadata limit.`);
}

async function readBoundedTextEntry(
	entry: ScapeArchiveEntry,
	label: string,
	maximumBytes: number,
	expandedByteBudget: ScapeExpandedByteBudget,
	signal?: AbortSignal,
): Promise<string> {
	throwIfScapeAborted(signal);
	if (typeof entry.getData !== 'function') throw new Error(`The .scape archive is missing ${label}.`);
	assertMetadataLimit(entry, label, maximumBytes);
	const decoder = new TextDecoder();
	const textChunks: string[] = [];
	let byteLength = 0;
	const writable = new WritableStream<Uint8Array>({
		write(chunk) {
			throwIfScapeAborted(signal);
			const bytes = toBytes(chunk);
			if (bytes.byteLength > maximumBytes - byteLength) throw new RangeError(`${label} exceeds the read limit.`);
			expandedByteBudget.consume(bytes.byteLength, label);
			byteLength += bytes.byteLength;
			textChunks.push(decoder.decode(bytes, { stream: true }));
		},
	});
	await awaitScapeOperation(entry.getData(writable, { signal, strictness: 'strict' }), signal);
	throwIfScapeAborted(signal);
	if (byteLength !== entry.uncompressedSize) {
		throw new Error(`${label} emitted bytes that do not match its archive metadata.`);
	}
	textChunks.push(decoder.decode());
	return textChunks.join('');
}

function parseScapeManifest(text: string): ScapeManifest {
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch {
		throw new Error('The .scape manifest is not valid JSON.');
	}
	if (!isRecord(value) || value.format !== SCAPE_FORMAT) throw new RangeError('This is not a .scape project.');
	if (value.formatVersion !== SCAPE_FORMAT_VERSION) {
		throw new RangeError(`Unsupported .scape format version: ${String(value.formatVersion)}.`);
	}
	if (!isRecord(value.project) || !Array.isArray(value.assets)) {
		throw new TypeError('The .scape manifest is incomplete.');
	}
	validateDescriptor(value.project);
	for (const asset of value.assets) {
		if (!isRecord(asset)) throw new TypeError('A .scape asset descriptor is invalid.');
		validateDescriptor(asset);
		if (typeof asset.sourceId !== 'string' || !asset.sourceId) {
			throw new TypeError('A .scape asset has an invalid source ID.');
		}
		if (asset.kind !== 'audio' && asset.kind !== 'video') {
			throw new TypeError(`A .scape asset has an invalid kind: ${String(asset.kind)}.`);
		}
		if (typeof asset.encoding !== 'string' || !asset.encoding) {
			throw new TypeError('A .scape asset has an invalid encoding.');
		}
	}
	return value as unknown as ScapeManifest;
}

function validateDescriptor(descriptor: Record<string, unknown>): void {
	validateScapeEntryName(descriptor.entry);
	if (!Number.isSafeInteger(descriptor.size) || (descriptor.size as number) < 0) {
		throw new RangeError('A .scape asset has an invalid size.');
	}
	if (!/^[a-f0-9]{64}$/u.test(String(descriptor.sha256 ?? ''))) {
		throw new TypeError('A .scape asset has an invalid SHA-256 digest.');
	}
}

function validateManifestOwnership(
	manifest: ScapeManifest,
	entryByName: ReadonlyMap<string, ScapeArchiveEntry>,
	limits: ScapeArchiveLimits,
): void {
	if (manifest.project.entry !== SCAPE_PROJECT_ENTRY) {
		throw new Error(`The .scape project descriptor must own ${SCAPE_PROJECT_ENTRY}.`);
	}
	const ownedEntries = new Set([SCAPE_MANIFEST_ENTRY]);
	claimDescriptor(manifest.project, 'project document', entryByName, ownedEntries);
	const sourceIds = new Set<string>();
	for (const asset of manifest.assets) {
		if (sourceIds.has(asset.sourceId)) throw new Error(`Duplicate .scape source asset: ${asset.sourceId}.`);
		sourceIds.add(asset.sourceId);
		if (asset.entry === SCAPE_MANIFEST_ENTRY || asset.entry === SCAPE_PROJECT_ENTRY) {
			throw new Error(`The .scape entry ${asset.entry} is reserved.`);
		}
		claimDescriptor(asset, `asset ${asset.sourceId}`, entryByName, ownedEntries);
	}
	for (const filename of entryByName.keys()) {
		if (!ownedEntries.has(filename)) throw new Error(`Unreferenced entry: ${filename} in the .scape archive.`);
	}
	const projectEntry = requiredFileEntry(entryByName, SCAPE_PROJECT_ENTRY);
	assertMetadataLimit(projectEntry, SCAPE_PROJECT_ENTRY, limits.maximumProjectBytes);
}

function claimDescriptor(
	descriptor: ScapeDescriptor,
	label: string,
	entryByName: ReadonlyMap<string, ScapeArchiveEntry>,
	ownedEntries: Set<string>,
): void {
	if (ownedEntries.has(descriptor.entry)) {
		throw new Error(`The .scape entry ${descriptor.entry} is owned by more than one descriptor.`);
	}
	const entry = requiredFileEntry(entryByName, descriptor.entry);
	if (descriptor.size !== entry.uncompressedSize) {
		throw new Error(`The .scape ${label} declared size does not match its archive entry.`);
	}
	ownedEntries.add(descriptor.entry);
}

function requiredFileEntry(
	entryByName: ReadonlyMap<string, ScapeArchiveEntry>,
	filename: string,
): ScapeArchiveEntry {
	const entry = entryByName.get(filename);
	if (!entry || entry.directory || typeof entry.getData !== 'function') {
		throw new Error(`The .scape archive is missing ${filename}.`);
	}
	return entry;
}

function validateScapeEntryName(value: unknown): asserts value is string {
	if (
		typeof value !== 'string'
		|| !value
		|| value.startsWith('/')
		|| value.includes('\\')
		|| value.includes('\0')
		|| value.split('/').includes('..')
	) {
		throw new Error(`Unsafe .scape entry name: ${String(value)}.`);
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function toBytes(value: unknown): Uint8Array {
	if (value instanceof Uint8Array) return value;
	if (value instanceof ArrayBuffer) return new Uint8Array(value);
	throw new TypeError('A .scape text entry emitted a non-byte chunk.');
}
