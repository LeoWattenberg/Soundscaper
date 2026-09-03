/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	BlobReader,
	BlobWriter,
	TextReader,
	TextWriter,
	ZipReader,
	ZipWriter,
} from '@zip.js/zip.js';

import {
	DAWPROJECT_METADATA_ENTRY,
	DAWPROJECT_MIME_TYPE,
	DAWPROJECT_PROJECT_ENTRY,
	normalizeEntryPath,
} from './dawproject-format.ts';
import { DAWPROJECT_XML_LIMITS } from './dawproject-xml.ts';

/**
 * The ZIP container around a DAWproject.
 *
 * The reference implementation writes `metadata.xml`, then `project.xml`, then
 * the embedded files, with plain deflate throughout. Media here is stored
 * rather than deflated: float PCM does not compress, and a reader that has to
 * inflate a gigabyte of WAV to reach a two-kilobyte project file is a reader
 * that opens slowly for nothing.
 *
 * Reading is bounded the same way the Scape reader is: an entry count cap, a
 * per-entry size cap checked against the central directory before any bytes
 * are inflated, and only the entries the project references are ever read.
 */

export interface DawprojectArchiveFile {
	readonly path: string;
	readonly blob: Blob;
}

export interface DawprojectArchiveInput {
	readonly projectXml: string;
	readonly metadataXml: string;
	readonly files: readonly DawprojectArchiveFile[];
}

export interface DawprojectArchiveOptions {
	readonly signal?: AbortSignal;
}

export interface DawprojectArchiveReadOptions extends DawprojectArchiveOptions {
	readonly maximumEntries?: number;
	readonly maximumEntryBytes?: number;
}

export interface DawprojectArchive {
	readonly projectXml: string;
	readonly metadataXml: string | null;
	readonly entryNames: readonly string[];
	/** The entry's bytes, or null when the archive has no such entry. */
	readEntry(path: string): Promise<Blob | null>;
	entrySize(path: string): number | null;
	close(): Promise<void>;
}

export const DAWPROJECT_ARCHIVE_LIMITS = Object.freeze({
	maximumEntries: 10_000,
	maximumEntryBytes: 4 * 1024 * 1024 * 1024,
});

interface ArchiveEntry {
	readonly filename: string;
	readonly directory: boolean;
	readonly uncompressedSize: number;
	getData?<Value>(writer: TextWriter | BlobWriter, options?: Readonly<{ signal?: AbortSignal }>): Promise<Value>;
}

export async function writeDawprojectArchive(
	input: DawprojectArchiveInput,
	options: DawprojectArchiveOptions = {},
): Promise<Blob> {
	if (typeof input?.projectXml !== 'string' || !input.projectXml) {
		throw new TypeError('A DAWproject archive requires project.xml text.');
	}
	const signal = options.signal;
	throwIfAborted(signal);
	const seen = new Set<string>([DAWPROJECT_PROJECT_ENTRY, DAWPROJECT_METADATA_ENTRY]);
	for (const file of input.files) {
		const path = normalizeEntryPath(file.path);
		if (!path || path.endsWith('/') || path.split('/').includes('..')) {
			throw new RangeError(`Unsupported DAWproject entry path: ${file.path}.`);
		}
		if (seen.has(path)) throw new RangeError(`Duplicate DAWproject entry path: ${path}.`);
		seen.add(path);
	}
	const writer = new ZipWriter(new BlobWriter(DAWPROJECT_MIME_TYPE));
	try {
		await writer.add(DAWPROJECT_METADATA_ENTRY, new TextReader(input.metadataXml || ''), { signal });
		await writer.add(DAWPROJECT_PROJECT_ENTRY, new TextReader(input.projectXml), { signal });
		for (const file of input.files) {
			throwIfAborted(signal);
			await writer.add(normalizeEntryPath(file.path), new BlobReader(file.blob), { level: 0, signal });
		}
	} catch (error) {
		await writer.close().catch(() => undefined);
		throw error;
	}
	const blob = await writer.close();
	throwIfAborted(signal);
	return blob;
}

export async function readDawprojectArchive(
	input: Blob,
	options: DawprojectArchiveReadOptions = {},
): Promise<DawprojectArchive> {
	if (!(input instanceof Blob)) throw new TypeError('A DAWproject Blob is required.');
	const signal = options.signal;
	const maximumEntries = options.maximumEntries ?? DAWPROJECT_ARCHIVE_LIMITS.maximumEntries;
	const maximumEntryBytes = options.maximumEntryBytes ?? DAWPROJECT_ARCHIVE_LIMITS.maximumEntryBytes;
	throwIfAborted(signal);
	const reader = new ZipReader(new BlobReader(input));
	let entries: ArchiveEntry[];
	try {
		entries = (await reader.getEntries()) as ArchiveEntry[];
	} catch (error) {
		await reader.close().catch(() => undefined);
		throw new Error('The file is not a readable DAWproject ZIP archive.', { cause: error });
	}
	try {
		throwIfAborted(signal);
		if (entries.length > maximumEntries) {
			throw new RangeError(`The DAWproject archive holds more than ${String(maximumEntries)} entries.`);
		}
		const byPath = new Map<string, ArchiveEntry>();
		const byLowerPath = new Map<string, ArchiveEntry>();
		for (const entry of entries) {
			if (entry.directory) continue;
			const path = normalizeEntryPath(entry.filename);
			if (!byPath.has(path)) byPath.set(path, entry);
			const lower = path.toLowerCase();
			if (!byLowerPath.has(lower)) byLowerPath.set(lower, entry);
		}
		const find = (path: string): ArchiveEntry | null => {
			const normalized = normalizeEntryPath(path);
			return byPath.get(normalized) ?? byLowerPath.get(normalized.toLowerCase()) ?? null;
		};
		const readText = async (path: string, required: boolean): Promise<string | null> => {
			const entry = find(path);
			if (!entry) {
				if (required) throw new Error(`The DAWproject archive has no ${path} entry.`);
				return null;
			}
			if (entry.uncompressedSize > DAWPROJECT_XML_LIMITS.maximumBytes) {
				throw new RangeError(`${path} exceeds the ${String(DAWPROJECT_XML_LIMITS.maximumBytes)}-byte limit.`);
			}
			if (!entry.getData) throw new Error(`${path} cannot be read from the archive.`);
			return stripByteOrderMark(await entry.getData<string>(new TextWriter('utf-8'), { signal }));
		};
		const projectXml = await readText(DAWPROJECT_PROJECT_ENTRY, true);
		const metadataXml = await readText(DAWPROJECT_METADATA_ENTRY, false);
		let closed = false;
		return Object.freeze({
			projectXml: projectXml ?? '',
			metadataXml,
			entryNames: Object.freeze([...byPath.keys()]),
			entrySize: (path: string) => find(path)?.uncompressedSize ?? null,
			async readEntry(path: string): Promise<Blob | null> {
				throwIfAborted(signal);
				if (closed) throw new Error('The DAWproject archive is closed.');
				const entry = find(path);
				if (!entry?.getData) return null;
				if (entry.uncompressedSize > maximumEntryBytes) {
					throw new RangeError(`${path} exceeds the ${String(maximumEntryBytes)}-byte entry limit.`);
				}
				return entry.getData<Blob>(new BlobWriter(), { signal });
			},
			async close(): Promise<void> {
				if (closed) return;
				closed = true;
				await reader.close();
			},
		});
	} catch (error) {
		await reader.close().catch(() => undefined);
		throw error;
	}
}

function stripByteOrderMark(text: string): string {
	return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
	if (signal?.aborted) {
		throw signal.reason instanceof Error ? signal.reason : new DOMException('The DAWproject operation was aborted.', 'AbortError');
	}
}
