/* SPDX-License-Identifier: AGPL-3.0-only */

import { awaitScapeOperation, throwIfScapeAborted } from './scape-abort.ts';
import {
	readProjectSchemaIdentity,
	type ProjectSchemaFamily,
} from './project-schema-identity.ts';
import { parseOpaqueScapeProjectDocument } from './scape-project-document.ts';
import { ScapeExpandedByteBudget } from './scape-expanded-byte-budget.ts';
import { confirmFileSizeWarning, type FileSizeWarningOptions } from './controller/shared/file-size-warning.ts';
import { PHOTO_CATALOG_PACK_ASSET_KIND } from './scape-photo-catalog-pack.ts';

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
	compressionMethod: number;
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
	readonly [key: string]: unknown;
	entry: string;
	size: number;
	sha256: string;
}

export interface ScapeProjectDescriptor extends ScapeDescriptor {
	mimeType?: string;
	schemaFamily: ProjectSchemaFamily;
	schemaVersion: number;
}

export interface ScapeAssetDescriptor extends ScapeDescriptor {
	sourceId: string;
	kind: string;
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

/** A pre-baseline archive format is intentionally not a 1.0 migration source. */
export class ScapeArchiveReimportRequiredError extends RangeError {
	readonly code = 'REIMPORT_REQUIRED' as const;
	readonly formatVersion: unknown;

	constructor(formatVersion: unknown) {
		super(
			`Scape format ${String(formatVersion)} predates the family-qualified 1.0 baseline; re-import the source media.`,
		);
		this.name = 'ScapeArchiveReimportRequiredError';
		this.formatVersion = formatVersion;
	}
}

export async function readScapeArchiveEnvelope(
	entries: readonly ScapeArchiveEntry[],
	limitOverrides: Partial<ScapeArchiveLimits> = {},
	signal?: AbortSignal,
	additionalAssetKinds: readonly string[] = [],
	desktopImport = false,
	warningOptions: FileSizeWarningOptions = {},
): Promise<ScapeArchiveEnvelope> {
	throwIfScapeAborted(signal);
	const limits = resolveLimits(limitOverrides, desktopImport);
	const confirmation = { ...warningOptions, signal };
	const entryByName = indexEntries(entries, warningOptions.confirmFileSizeWarning
		? { ...limits, maximumExpandedBytes: Number.MAX_SAFE_INTEGER } : limits, signal);
	if (warningOptions.confirmFileSizeWarning) {
		limits.maximumExpandedBytes = await confirmFileSizeWarning(entries.reduce((sum, entry) => sum + entry.uncompressedSize, 0),
			limits.maximumExpandedBytes, 'Scape project archive', confirmation);
	}
	const expandedByteBudget = new ScapeExpandedByteBudget(limits.maximumExpandedBytes);
	const manifestEntry = requiredFileEntry(entryByName, SCAPE_MANIFEST_ENTRY);
	if (warningOptions.confirmFileSizeWarning) limits.maximumManifestBytes = await confirmFileSizeWarning(
		manifestEntry.uncompressedSize, limits.maximumManifestBytes, SCAPE_MANIFEST_ENTRY, confirmation);
	await validateEntryLayouts([manifestEntry], signal);
	assertMetadataLimit(manifestEntry, SCAPE_MANIFEST_ENTRY, limits.maximumManifestBytes);
	const manifestText = await readBoundedTextEntry(
		manifestEntry,
		SCAPE_MANIFEST_ENTRY,
		limits.maximumManifestBytes,
		expandedByteBudget,
		signal,
	);
	throwIfScapeAborted(signal);
	const manifest = parseScapeManifest(manifestText, additionalAssetKinds);
	const projectEntry = requiredFileEntry(entryByName, SCAPE_PROJECT_ENTRY);
	if (warningOptions.confirmFileSizeWarning) limits.maximumProjectBytes = await confirmFileSizeWarning(
		projectEntry.uncompressedSize, limits.maximumProjectBytes, SCAPE_PROJECT_ENTRY, confirmation);
	validateManifestOwnership(manifest, entryByName, limits);
	await validateEntryLayouts([projectEntry], signal);
	const projectText = await readBoundedTextEntry(
		projectEntry,
		SCAPE_PROJECT_ENTRY,
		limits.maximumProjectBytes,
		expandedByteBudget,
		signal,
	);
	throwIfScapeAborted(signal);
	assertManifestProjectIdentity(manifest, projectText);
	await validateEntryLayouts(
		[...entryByName.values()].filter(({ filename }) => (
			filename !== SCAPE_MANIFEST_ENTRY && filename !== SCAPE_PROJECT_ENTRY
		)),
		signal,
	);
	return { entryByName, expandedByteBudget, manifest, projectText };
}

function assertManifestProjectIdentity(manifest: ScapeManifest, projectText: string): void {
	const project = parseOpaqueScapeProjectDocument(projectText);
	const identity = readProjectSchemaIdentity(project);
	if (manifest.project.schemaFamily !== identity.schemaFamily
		|| manifest.project.schemaVersion !== identity.schemaVersion) {
		throw new Error('The Scape manifest project identity does not match its project document.');
	}
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

function resolveLimits(overrides: Partial<ScapeArchiveLimits>, desktopImport: boolean): ScapeArchiveLimits {
	for (const name of Object.keys(overrides)) {
		if (!Object.hasOwn(SCAPE_ARCHIVE_LIMITS, name)) {
			throw new TypeError(`Unsupported Scape archive limit: ${name}.`);
		}
	}
	const maximumExpandedBytes = desktopImport
		? Number.MAX_SAFE_INTEGER : SCAPE_ARCHIVE_LIMITS.maximumExpandedBytes;
	const limits = { ...SCAPE_ARCHIVE_LIMITS, maximumExpandedBytes, ...overrides };
	for (const name of Object.keys(SCAPE_ARCHIVE_LIMITS) as (keyof ScapeArchiveLimits)[]) {
		const value = limits[name];
		if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(`Invalid Scape ${name} limit.`);
		if (value > (name === 'maximumExpandedBytes' ? maximumExpandedBytes : SCAPE_ARCHIVE_LIMITS[name])) {
			throw new RangeError(`The Scape ${name} limit cannot exceed the hard limit.`);
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
		throw new RangeError('The Scape archive contains too many entries.');
	}
	const entryByName = new Map<string, ScapeArchiveEntry>();
	let declaredExpandedBytes = 0;
	for (const entry of entries) {
		throwIfScapeAborted(signal);
		validateScapeEntryName(entry.filename);
		if (entryByName.has(entry.filename)) throw new Error(`Duplicate Scape entry: ${entry.filename}.`);
		if (entry.directory) throw new Error(`The Scape archive contains an unsupported directory entry: ${entry.filename}.`);
		if (entry.encrypted) throw new Error(`The Scape archive contains ${entry.filename}; encrypted entries are not supported.`);
		validateEntrySize(entry.compressedSize, entry.filename, 'compressed');
		validateEntrySize(entry.uncompressedSize, entry.filename, 'uncompressed');
		if (entry.compressionMethod !== 0) {
			throw new Error(
				`The Scape entry ${entry.filename} uses unsupported ZIP compression method ${String(entry.compressionMethod)}; portable Scape entries must use STORE.`,
			);
		}
		if (entry.compressedSize !== entry.uncompressedSize) {
			throw new Error(
				`The Scape STORE entry ${entry.filename} has inconsistent compressed and uncompressed sizes.`,
			);
		}
		if (entry.uncompressedSize > limits.maximumExpandedBytes - declaredExpandedBytes) {
			throw new RangeError('The Scape archive exceeds the declared expansion limit.');
		}
		declaredExpandedBytes += entry.uncompressedSize;
		entryByName.set(entry.filename, entry);
	}
	return entryByName;
}

function validateEntrySize(value: number, filename: string, label: string): void {
	if (!Number.isSafeInteger(value) || value < 0) {
		throw new RangeError(`The Scape entry ${filename} has an invalid ${label} size.`);
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
	if (typeof entry.getData !== 'function') throw new Error(`The Scape archive is missing ${label}.`);
	assertMetadataLimit(entry, label, maximumBytes);
	const decoder = new TextDecoder('utf-8', { fatal: true });
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

function parseScapeManifest(text: string, additionalAssetKinds: readonly string[]): ScapeManifest {
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch {
		throw new Error('The Scape manifest is not valid JSON.');
	}
	if (!isRecord(value) || value.format !== SCAPE_FORMAT) throw new RangeError('This is not a Scape project.');
	if (value.formatVersion !== SCAPE_FORMAT_VERSION) {
		if (value.formatVersion === 2) {
			throw new ScapeArchiveReimportRequiredError(value.formatVersion);
		}
		throw new RangeError(`Unsupported Scape format version: ${String(value.formatVersion)}.`);
	}
	if (!isRecord(value.project) || !Array.isArray(value.assets)) {
		throw new TypeError('The Scape manifest is incomplete.');
	}
	validateDescriptor(value.project);
	const identity = readProjectSchemaIdentity(value.project);
	const assetKinds = allowedAssetKinds(additionalAssetKinds, identity.schemaFamily);
	for (const asset of value.assets) {
		if (!isRecord(asset)) throw new TypeError('A Scape asset descriptor is invalid.');
		validateDescriptor(asset);
		if (typeof asset.sourceId !== 'string' || !asset.sourceId) {
			throw new TypeError('A Scape asset has an invalid source ID.');
		}
		if (typeof asset.kind !== 'string' || !assetKinds.has(asset.kind)) {
			throw new TypeError(`A Scape asset has an invalid kind: ${String(asset.kind)}.`);
		}
		if (typeof asset.encoding !== 'string' || !asset.encoding) {
			throw new TypeError('A Scape asset has an invalid encoding.');
		}
	}
	return value as unknown as ScapeManifest;
}

function allowedAssetKinds(additional: readonly string[], family: ProjectSchemaFamily): ReadonlySet<string> {
	if (!Array.isArray(additional) || additional.length > 64) {
		throw new TypeError('Additional Scape asset kinds must be a bounded array.');
	}
	const result = new Set(['audio', 'video', 'video-timing']);
	if (family === 'lightscaper') result.add(PHOTO_CATALOG_PACK_ASSET_KIND);
	for (const kind of additional) {
		if (typeof kind !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/u.test(kind)) {
			throw new TypeError(`An additional Scape asset kind is invalid: ${String(kind)}.`);
		}
		if (result.has(kind)) throw new Error(`Duplicate Scape asset kind: ${kind}.`);
		if (kind === PHOTO_CATALOG_PACK_ASSET_KIND) throw new TypeError('Photo catalog packs require their registered project family.');
		result.add(kind);
	}
	return result;
}

function validateDescriptor(descriptor: Record<string, unknown>): void {
	validateScapeEntryName(descriptor.entry);
	if (!Number.isSafeInteger(descriptor.size) || (descriptor.size as number) < 0) {
		throw new RangeError('A Scape asset has an invalid size.');
	}
	if (!/^[a-f0-9]{64}$/u.test(String(descriptor.sha256 ?? ''))) {
		throw new TypeError('A Scape asset has an invalid SHA-256 digest.');
	}
}

function validateManifestOwnership(
	manifest: ScapeManifest,
	entryByName: ReadonlyMap<string, ScapeArchiveEntry>,
	limits: ScapeArchiveLimits,
): void {
	if (manifest.project.entry !== SCAPE_PROJECT_ENTRY) {
		throw new Error(`The Scape project descriptor must own ${SCAPE_PROJECT_ENTRY}.`);
	}
	const ownedEntries = new Set([SCAPE_MANIFEST_ENTRY]);
	claimDescriptor(manifest.project, 'project document', entryByName, ownedEntries);
	const sourceIds = new Set<string>();
	for (const asset of manifest.assets) {
		if (sourceIds.has(asset.sourceId)) throw new Error(`Duplicate Scape source asset: ${asset.sourceId}.`);
		sourceIds.add(asset.sourceId);
		if (asset.entry === SCAPE_MANIFEST_ENTRY || asset.entry === SCAPE_PROJECT_ENTRY) {
			throw new Error(`The Scape entry ${asset.entry} is reserved.`);
		}
		claimDescriptor(asset, `asset ${asset.sourceId}`, entryByName, ownedEntries);
	}
	for (const filename of entryByName.keys()) {
		if (!ownedEntries.has(filename)) throw new Error(`Unreferenced entry: ${filename} in the Scape archive.`);
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
		throw new Error(`The Scape entry ${descriptor.entry} is owned by more than one descriptor.`);
	}
	const entry = requiredFileEntry(entryByName, descriptor.entry);
	if (descriptor.size !== entry.uncompressedSize) {
		throw new Error(`The Scape ${label} declared size does not match its archive entry.`);
	}
	ownedEntries.add(descriptor.entry);
}

function requiredFileEntry(
	entryByName: ReadonlyMap<string, ScapeArchiveEntry>,
	filename: string,
): ScapeArchiveEntry {
	const entry = entryByName.get(filename);
	if (!entry || entry.directory || typeof entry.getData !== 'function') {
		throw new Error(`The Scape archive is missing ${filename}.`);
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
		throw new Error(`Unsafe Scape entry name: ${String(value)}.`);
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function toBytes(value: unknown): Uint8Array {
	if (value instanceof Uint8Array) return value;
	if (value instanceof ArrayBuffer) return new Uint8Array(value);
	throw new TypeError('A Scape text entry emitted a non-byte chunk.');
}
