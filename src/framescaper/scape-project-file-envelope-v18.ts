/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	awaitScapeOperation,
	throwIfScapeAborted,
} from '../common/editor/scape-abort.ts';
import {
	SCAPE_ARCHIVE_LIMITS,
	type ScapeArchiveEntry,
	type ScapeArchiveLimits,
} from '../common/editor/scape-archive-envelope.ts';
import { safeScapeEntryId, verifyScapeAssetBytes } from '../common/editor/scape-archive-media.ts';
import { ScapeExpandedByteBudget } from '../common/editor/scape-expanded-byte-budget.ts';
import type { EditorProjectRuntimeProfile } from '../common/editor/project-runtime-profile.ts';
import { normalizeVideoTimingAssetReference } from '../common/editor/video-timing-asset.ts';
import type { FramescaperProjectV18 } from './editor-project-v18.ts';
import { assertFramescaperScapeFallbackAssetsV18 } from './scape-project-file-fallback-v18.ts';
import {
	inspectFramescaperScapeProjectEnvelopeV18,
	type FramescaperScapeProjectEnvelopeInspectionV18,
} from './scape-project-envelope-v18.ts';

export type FramescaperScapeAssetDescriptorV18 = Readonly<Record<string, unknown>> & Readonly<{
	sourceId: string;
	kind: 'audio' | 'video' | 'video-timing' | 'video-proxy';
	encoding: string;
	entry: string;
	mimeType?: string;
	size: number;
	sha256: string;
}>;

export type FramescaperScapeManifestV18 = Readonly<Record<string, unknown>> & Readonly<{
	format: 'scape-project';
	formatVersion: 1 | 2;
	createdAt?: string;
	project: Readonly<Record<string, unknown>> & Readonly<{
		entry: 'project.json';
		mimeType?: string;
		schemaVersion: 18;
		size: number;
		sha256: string;
	}>;
	assets: readonly FramescaperScapeAssetDescriptorV18[];
}>;

export interface FramescaperScapeFileEnvelopeV18 {
	readonly entries: readonly ScapeArchiveEntry[];
	readonly entryByName: ReadonlyMap<string, ScapeArchiveEntry>;
	readonly expandedByteBudget: ScapeExpandedByteBudget;
	readonly manifest: FramescaperScapeManifestV18;
	readonly project: FramescaperProjectV18;
	readonly inspection: Readonly<FramescaperScapeProjectEnvelopeInspectionV18>;
}

const SHA256 = /^[a-f0-9]{64}$/u;
const METADATA_ENTRIES = new Set(['manifest.json', 'project.json']);
const AUDIO_ENCODING = 'audio-f32le-chunks-v1';
const TIMING_MIME_TYPE = 'application/vnd.soundscaper.video-timing';

export async function readFramescaperScapeFileEnvelopeV18(
	profile: EditorProjectRuntimeProfile | unknown,
	entriesValue: readonly ScapeArchiveEntry[],
	limitOverrides: Partial<ScapeArchiveLimits> = {},
	signal?: AbortSignal,
): Promise<Readonly<FramescaperScapeFileEnvelopeV18>> {
	throwIfScapeAborted(signal);
	const limits = resolveLimits(limitOverrides);
	const entries = snapshotEntries(entriesValue, limits, signal);
	const indexed = new Map(entries.map((entry) => [entry.filename, entry]));
	await validateEntryLayouts(entries, signal);
	const expandedByteBudget = new ScapeExpandedByteBudget(limits.maximumExpandedBytes);
	const manifestEntry = requiredEntry(indexed, 'manifest.json');
	const manifestBytes = await readBoundedEntry(
		manifestEntry, 'manifest.json', limits.maximumManifestBytes, expandedByteBudget, signal,
	);
	const manifestValue = parseJson(manifestBytes, 'manifest');
	deepFreezeJson(manifestValue);
	const manifest = validateManifest(manifestValue, indexed, limits);
	const projectEntry = requiredEntry(indexed, 'project.json');
	const projectBytes = await readBoundedEntry(
		projectEntry, 'project.json', limits.maximumProjectBytes, expandedByteBudget, signal,
	);
	verifyScapeAssetBytes(projectBytes, manifest.project, 'project document');
	const projectValue = parseJson(projectBytes, 'project document');
	deepFreezeJson(projectValue);
	const inspection = inspectFramescaperScapeProjectEnvelopeV18(
		profile, manifest, projectValue, 'continue',
	);
	validateCanonicalAssets(inspection.project, manifest.assets, inspection.proxyAssets);
	assertFramescaperScapeFallbackAssetsV18(profile, inspection.project, manifest.assets);
	throwIfScapeAborted(signal);
	return Object.freeze({
		entries,
		entryByName: readonlyMap(indexed),
		expandedByteBudget,
		manifest,
		project: inspection.project,
		inspection,
	});
}

function resolveLimits(overrides: Partial<ScapeArchiveLimits>): ScapeArchiveLimits {
	if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) {
		throw new TypeError('Framescaper Scape archive limits must be a record.');
	}
	for (const key of Reflect.ownKeys(overrides)) {
		if (typeof key !== 'string' || !Object.hasOwn(SCAPE_ARCHIVE_LIMITS, key)) {
			throw new TypeError(`Unsupported .scape archive limit: ${String(key)}.`);
		}
		const descriptor = Object.getOwnPropertyDescriptor(overrides, key);
		if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`The .scape ${key} limit must be a data property.`);
		}
	}
	const limits = { ...SCAPE_ARCHIVE_LIMITS, ...overrides };
	for (const key of Object.keys(SCAPE_ARCHIVE_LIMITS) as (keyof ScapeArchiveLimits)[]) {
		const value = limits[key];
		if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(`Invalid .scape ${key} limit.`);
		if (value > SCAPE_ARCHIVE_LIMITS[key]) {
			throw new RangeError(`The .scape ${key} limit cannot exceed the hard limit.`);
		}
	}
	return limits;
}

function snapshotEntries(
	values: readonly ScapeArchiveEntry[],
	limits: ScapeArchiveLimits,
	signal?: AbortSignal,
): readonly ScapeArchiveEntry[] {
	if (!Array.isArray(values)) throw new TypeError('Framescaper Scape entries must be an array.');
	if (values.length > limits.maximumEntryCount) throw new RangeError('The .scape archive contains too many entries.');
	const filenames = new Set<string>();
	let expanded = 0;
	const entries = values.map((value): ScapeArchiveEntry => {
		throwIfScapeAborted(signal);
		if (!value || typeof value !== 'object') throw new TypeError('A .scape entry is invalid.');
		const filename = entryName(value.filename);
		if (filenames.has(filename)) throw new Error(`Duplicate .scape entry: ${filename}.`);
		filenames.add(filename);
		if (value.directory) throw new Error(`The .scape archive contains an unsupported directory entry: ${filename}.`);
		if (value.encrypted) throw new Error(`The .scape entry ${filename} is encrypted.`);
		const compressedSize = entrySize(value.compressedSize, filename, 'compressed');
		const uncompressedSize = entrySize(value.uncompressedSize, filename, 'uncompressed');
		if (value.compressionMethod !== 0) {
			throw new Error(`The .scape entry ${filename} must use ZIP STORE.`);
		}
		if (compressedSize !== uncompressedSize) {
			throw new Error(`The .scape STORE entry ${filename} has inconsistent sizes.`);
		}
		if (uncompressedSize > limits.maximumExpandedBytes - expanded) {
			throw new RangeError('The .scape archive exceeds the declared expansion limit.');
		}
		expanded += uncompressedSize;
		const getData = value.getData;
		return Object.freeze({
			filename,
			directory: false,
			encrypted: false,
			compressionMethod: 0,
			compressedSize,
			uncompressedSize,
			...(typeof getData === 'function' ? {
				getData: (
					writable: WritableStream<Uint8Array>,
					options?: Parameters<NonNullable<ScapeArchiveEntry['getData']>>[1],
				) => getData.call(value, writable, options),
			} : {}),
		});
	});
	return Object.freeze(entries);
}

async function validateEntryLayouts(entries: readonly ScapeArchiveEntry[], signal?: AbortSignal): Promise<void> {
	for (const entry of entries) {
		throwIfScapeAborted(signal);
		if (!entry.getData) continue;
		await awaitScapeOperation(entry.getData(new WritableStream<Uint8Array>(), {
			signal,
			strictness: 'strict',
			checkOverlappingEntryOnly: true,
		}), signal);
	}
}

async function readBoundedEntry(
	entry: ScapeArchiveEntry,
	label: string,
	maximumBytes: number,
	budget: ScapeExpandedByteBudget,
	signal?: AbortSignal,
): Promise<Uint8Array> {
	if (!entry.getData) throw new Error(`The .scape archive is missing ${label}.`);
	if (entry.uncompressedSize > maximumBytes) throw new RangeError(`${label} exceeds the metadata limit.`);
	const chunks: Uint8Array[] = [];
	let size = 0;
	await awaitScapeOperation(entry.getData(new WritableStream<Uint8Array>({
		write(value) {
			throwIfScapeAborted(signal);
			const bytes = toBytes(value);
			if (bytes.byteLength > maximumBytes - size) throw new RangeError(`${label} exceeds the read limit.`);
			budget.consume(bytes.byteLength, label);
			size += bytes.byteLength;
			chunks.push(bytes.slice());
		},
	}), { signal, strictness: 'strict' }), signal);
	if (size !== entry.uncompressedSize) throw new Error(`${label} emitted bytes that do not match its archive metadata.`);
	const bytes = new Uint8Array(size);
	let offset = 0;
	for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
	return bytes;
}

function validateManifest(
	value: unknown,
	entries: ReadonlyMap<string, ScapeArchiveEntry>,
	limits: ScapeArchiveLimits,
): FramescaperScapeManifestV18 {
	const raw = record(value, 'Framescaper Scape manifest');
	closedKeys(raw, ['format', 'formatVersion', 'project', 'assets'], ['createdAt'], 'Framescaper Scape manifest');
	if (raw.format !== 'scape-project') throw new RangeError('This is not a Scape project.');
	if (raw.formatVersion !== 1 && raw.formatVersion !== 2) {
		throw new RangeError(`Unsupported Framescaper Scape format version: ${String(raw.formatVersion)}.`);
	}
	if (raw.createdAt !== undefined && typeof raw.createdAt !== 'string') {
		throw new TypeError('Framescaper Scape manifest createdAt must be a string.');
	}
	const project = descriptor(raw.project, 'project document', false);
	if (project.entry !== 'project.json' || project.schemaVersion !== 18) {
		throw new Error('The Framescaper Scape project descriptor must own schema-18 project.json.');
	}
	if (project.mimeType !== undefined && project.mimeType !== 'application/json') {
		throw new TypeError('The Framescaper Scape project descriptor MIME type is invalid.');
	}
	const assetsValue = denseArray(raw.assets, 'Framescaper Scape assets');
	if (assetsValue.length > limits.maximumEntryCount - 2) throw new RangeError('The Scape asset limit was exceeded.');
	const assets = assetsValue.map((asset, index) => descriptor(
		asset, `asset ${String(index)}`, true,
	) as FramescaperScapeAssetDescriptorV18);
	const owned = new Set(['manifest.json']);
	claim(project, 'project document', entries, owned);
	const sourceIds = new Set<string>();
	for (const asset of assets) {
		if (sourceIds.has(asset.sourceId)) throw new Error(`Duplicate .scape source asset: ${asset.sourceId}.`);
		sourceIds.add(asset.sourceId);
		claim(asset, `asset ${asset.sourceId}`, entries, owned);
	}
	for (const filename of entries.keys()) {
		if (!owned.has(filename)) throw new Error(`Unreferenced entry: ${filename} in the .scape archive.`);
	}
	return value as FramescaperScapeManifestV18;
}

function descriptor(value: unknown, label: string, asset: boolean): Record<string, unknown> {
	const raw = record(value, `Framescaper Scape ${label}`);
	closedKeys(
		raw,
		asset
			? ['sourceId', 'kind', 'encoding', 'entry', 'size', 'sha256']
			: ['entry', 'schemaVersion', 'size', 'sha256'],
		['mimeType'],
		`Framescaper Scape ${label}`,
	);
	entryName(raw.entry);
	if (!Number.isSafeInteger(raw.size) || Number(raw.size) < 0) throw new RangeError(`The Scape ${label} size is invalid.`);
	if (typeof raw.sha256 !== 'string' || !SHA256.test(raw.sha256)) throw new TypeError(`The Scape ${label} digest is invalid.`);
	if (asset) {
		if (typeof raw.sourceId !== 'string' || !raw.sourceId) throw new TypeError(`The Scape ${label} source ID is invalid.`);
		if (raw.kind !== 'audio' && raw.kind !== 'video' && raw.kind !== 'video-timing' && raw.kind !== 'video-proxy') {
			throw new TypeError(`The Scape ${label} kind is invalid.`);
		}
		if (typeof raw.encoding !== 'string' || !raw.encoding) throw new TypeError(`The Scape ${label} encoding is invalid.`);
	}
	return raw;
}

function validateCanonicalAssets(
	project: FramescaperProjectV18,
	assets: readonly FramescaperScapeAssetDescriptorV18[],
	proxyAssets: readonly Readonly<Record<string, unknown>>[],
): void {
	const expected = new Map<string, Readonly<Record<string, unknown>>>();
	for (const source of project.sources as unknown as readonly Record<string, unknown>[]) {
		const sourceId = nonEmptyString(source.id, 'Framescaper project source ID');
		const kind = source.kind === 'video' ? 'video' : 'audio';
		expected.set(sourceId, {
			sourceId,
			kind,
			encoding: kind === 'video' ? 'original' : AUDIO_ENCODING,
			entry: kind === 'video'
				? `media/${safeScapeEntryId(sourceId)}/original`
				: `audio/${safeScapeEntryId(sourceId)}.f32c`,
			mimeType: String(source.mimeType ?? ''),
			...(kind === 'video' ? { sha256: source.contentSha256 } : {}),
		});
		if (kind === 'video' && source.timingAsset !== null && source.timingAsset !== undefined) {
			const timing = normalizeVideoTimingAssetReference(source.timingAsset);
			expected.set(timing.storageKey, {
				sourceId: timing.storageKey,
				kind: 'video-timing',
				encoding: timing.encoding,
				entry: `timing/${safeScapeEntryId(timing.sha256)}.scti`,
				mimeType: TIMING_MIME_TYPE,
				size: timing.byteLength,
				sha256: timing.sha256,
			});
		}
	}
	const proxyBySource = new Map(proxyAssets.map((asset) => [String(asset.sourceId), asset]));
	const seenCanonical = new Set<string>();
	for (const asset of assets) {
		const canonical = expected.get(asset.sourceId);
		const proxy = proxyBySource.get(asset.sourceId);
		const canonicalMatch = canonical ? matchesExpectedAsset(asset, canonical) : false;
		const proxyMatch = proxy ? matchesExpectedAsset(asset, proxy) : false;
		if (!canonicalMatch && !proxyMatch) throw new Error(`Orphan Framescaper Scape asset: ${asset.sourceId}.`);
		if (canonicalMatch) seenCanonical.add(asset.sourceId);
	}
	for (const sourceId of expected.keys()) {
		if (!seenCanonical.has(sourceId)) throw new Error(`Missing canonical Scape asset: ${sourceId}.`);
	}
}

function matchesExpectedAsset(
	asset: FramescaperScapeAssetDescriptorV18,
	expected: Readonly<Record<string, unknown>>,
): boolean {
	for (const field of ['sourceId', 'kind', 'encoding', 'entry', 'mimeType', 'size', 'sha256'] as const) {
		if (Object.hasOwn(expected, field) && asset[field] !== expected[field]) return false;
	}
	return true;
}

function claim(
	descriptorValue: Readonly<Record<string, unknown>>,
	label: string,
	entries: ReadonlyMap<string, ScapeArchiveEntry>,
	owned: Set<string>,
): void {
	const entry = String(descriptorValue.entry);
	if (METADATA_ENTRIES.has(entry) && entry !== 'project.json') throw new Error(`The .scape entry ${entry} is reserved.`);
	if (owned.has(entry)) throw new Error(`The .scape entry ${entry} is owned more than once.`);
	const body = requiredEntry(entries, entry);
	if (body.uncompressedSize !== descriptorValue.size) throw new Error(`The .scape ${label} size does not match its entry.`);
	owned.add(entry);
}

function requiredEntry(entries: ReadonlyMap<string, ScapeArchiveEntry>, filename: string): ScapeArchiveEntry {
	const entry = entries.get(filename);
	if (!entry?.getData) throw new Error(`The .scape archive is missing ${filename}.`);
	return entry;
}

function readonlyMap<Key, Value>(source: ReadonlyMap<Key, Value>): ReadonlyMap<Key, Value> {
	return Object.freeze({
		get size() { return source.size; },
		get: (key: Key) => source.get(key),
		has: (key: Key) => source.has(key),
		entries: () => source.entries(),
		keys: () => source.keys(),
		values: () => source.values(),
		forEach: (callback: (value: Value, key: Key, map: ReadonlyMap<Key, Value>) => void, thisArg?: unknown) => {
			for (const [key, value] of source) callback.call(thisArg, value, key, source);
		},
		[Symbol.iterator]: () => source[Symbol.iterator](),
	});
}

function parseJson(bytes: Uint8Array, label: string): unknown {
	try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
	catch { throw new Error(`The .scape ${label} is not valid UTF-8 JSON.`); }
}

function deepFreezeJson(value: unknown): void {
	if (!value || typeof value !== 'object' || Object.isFrozen(value)) return;
	for (const child of Object.values(value)) deepFreezeJson(child);
	Object.freeze(value);
}

function record(value: unknown, label: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| Object.getPrototypeOf(value) !== Object.prototype) throw new TypeError(`${label} must be a plain record.`);
	return value as Record<string, unknown>;
}

function closedKeys(raw: Record<string, unknown>, required: readonly string[], optional: readonly string[], label: string): void {
	const keys = Reflect.ownKeys(raw);
	const allowed = new Set([...required, ...optional]);
	if (keys.some((key) => typeof key !== 'string' || !allowed.has(key))) throw new TypeError(`${label} has unsupported fields.`);
	for (const field of required) {
		if (!Object.hasOwn(raw, field)) throw new TypeError(`${label} is missing ${field}.`);
	}
}

function denseArray(value: unknown, label: string): unknown[] {
	if (!Array.isArray(value)) throw new TypeError(`${label} must be an array.`);
	for (let index = 0; index < value.length; index += 1) {
		if (!Object.hasOwn(value, index)) throw new TypeError(`${label} must be dense.`);
	}
	return value;
}

function entryName(value: unknown): string {
	if (typeof value !== 'string' || !value || value.startsWith('/') || value.endsWith('/')
		|| value.includes('\\') || value.includes('\0') || value.split('/').some((part) => !part || part === '.' || part === '..')) {
		throw new TypeError('A .scape entry name is unsafe.');
	}
	return value;
}

function entrySize(value: unknown, filename: string, label: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) throw new RangeError(`The .scape entry ${filename} has an invalid ${label} size.`);
	return Number(value);
}

function nonEmptyString(value: unknown, label: string): string {
	if (typeof value !== 'string' || !value) throw new TypeError(`${label} is required.`);
	return value;
}

function toBytes(value: unknown): Uint8Array {
	if (value instanceof Uint8Array) return value;
	if (value instanceof ArrayBuffer) return new Uint8Array(value);
	throw new TypeError('A .scape metadata entry emitted non-byte data.');
}
