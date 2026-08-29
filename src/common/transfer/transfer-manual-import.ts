/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Manual fallback pairing for product-native Scape archives and their optional
 * conversion-report sidecars. File handles are bounded up front, sidecars are
 * read only beside their matching archive, and only one archive payload is
 * resident at a time.
 */

import type * as Bundle from './project-transfer-bundle.ts';
import {
	archiveFileNameForCrossProductHandoffReportSidecar,
	CROSS_PRODUCT_HANDOFF_REPORT_SIDECAR_MAX_BYTES,
	decodeCrossProductHandoffReportSidecarFile,
	isCrossProductHandoffReportSidecarFileName,
} from './cross-product-handoff-report-sidecar.ts';
import {
	requireTransferRuntime,
	transferArchiveTitle,
	type TransferRuntime,
} from './transfer-archive-stream.ts';
import { TransferManualImportRefusalError } from './transfer-manual-refusal.ts';

const DEFAULT_MAXIMUM_ENTRIES = 512;
const DEFAULT_MAXIMUM_ENTRY_BYTES = 512 * 1024 * 1024;
const MAXIMUM_ADMITTED_ENTRY_BYTES = 8 * 1024 * 1024 * 1024;
const PROJECT_FILE_NAME_PATTERN = /\.(?:sscape|fscape|liscape|scape)$/iu;

export interface TransferArchiveSource {
	readonly name: string;
	/** Browser `File.size`, retained so bounds are checked before arrayBuffer(). */
	readonly byteLength: number;
	read(): Promise<Uint8Array>;
}

export interface ImportTransferArchiveFilesOptions {
	readonly runtime: TransferRuntime;
	readonly store: Bundle.ProjectTransferImportStore;
	readonly files: Iterable<TransferArchiveSource>;
	readonly maximumEntries?: number;
	readonly maximumEntryBytes?: number;
	readonly signal?: AbortSignal;
	readonly onProgress?: (progress: Bundle.ProjectTransferProgress) => void;
}

/** Import archives sequentially after pairing exact `<archive>.conversion-report.json` names. */
export async function importTransferArchiveFiles(
	options: ImportTransferArchiveFilesOptions,
): Promise<Bundle.ProjectTransferImportResult> {
	const { runtime, store } = requireTransferRuntime(options, 'importing transfer archives');
	const maximumEntries = manualMaximumEntries(options.maximumEntries);
	const maximumEntryBytes = manualMaximumEntryBytes(options.maximumEntryBytes);

	async function* entries(): AsyncGenerator<unknown, void> {
		const selected = admitManualFiles(options.files, maximumEntries, maximumEntryBytes);
		const sidecars = pairManualSidecars(selected);
		for (const source of selected.archives) {
			options.signal?.throwIfAborted();
			const bytes = await readManualFile(source, 'archive', options.signal);
			const sidecarSource = sidecars.get(source.name);
			let conversionReportSidecar = null;
			if (sidecarSource !== undefined) {
				const sidecarBytes = await readManualFile(
					sidecarSource, 'conversion report sidecar', options.signal,
				);
				try {
					conversionReportSidecar = decodeCrossProductHandoffReportSidecarFile(
						sidecarBytes, bytes,
					);
				} catch (error) {
					throw new TransferManualImportRefusalError('malformed-entry',
						`Conversion report sidecar ${sidecarSource.name} does not match its archive: ${describe(error)}`);
				}
			}
			yield {
				projectId: conversionReportSidecar?.entryId,
				title: transferArchiveTitle(source.name),
				bytes,
				conversionReportSidecar,
			};
		}
	}
	return runtime.importBundle({
		store,
		importProject: runtime.importProject,
		inspectProject: runtime.inspectProject,
		entries: entries(),
		maximumEntries,
		maximumEntryBytes,
		signal: options.signal,
		onProgress: options.onProgress,
	});
}

function admitManualFiles(
	files: Iterable<TransferArchiveSource>,
	maximumEntries: number,
	maximumEntryBytes: number,
): Readonly<{
	archives: readonly TransferArchiveSource[];
	sidecars: readonly TransferArchiveSource[];
}> {
	if (files === null || typeof files !== 'object'
		|| typeof (files as Iterable<unknown>)[Symbol.iterator] !== 'function') {
		throw new TypeError('Importing transfer archives needs an iterable of files.');
	}
	const archives: TransferArchiveSource[] = [];
	const sidecars: TransferArchiveSource[] = [];
	const names = new Set<string>();
	for (const source of files) {
		if (!source || typeof source !== 'object' || typeof source.name !== 'string'
			|| !source.name || source.name.length > 512 || typeof source.read !== 'function'
			|| typeof source.byteLength !== 'number' || !Number.isSafeInteger(source.byteLength)
			|| source.byteLength < 0) {
			throw new TransferManualImportRefusalError('malformed-entry',
				'Every manual transfer file needs a bounded name, exact byteLength, and read() function.');
		}
		if (names.has(source.name)) {
			throw new TransferManualImportRefusalError('malformed-entry',
				`Manual transfer file ${source.name} was selected twice.`);
		}
		names.add(source.name);
		if (isCrossProductHandoffReportSidecarFileName(source.name)) {
			if (source.byteLength > CROSS_PRODUCT_HANDOFF_REPORT_SIDECAR_MAX_BYTES) {
				throw new TransferManualImportRefusalError('entry-too-large',
					`Conversion report sidecar ${source.name} is ${source.byteLength} bytes, over the`
						+ ` ${CROSS_PRODUCT_HANDOFF_REPORT_SIDECAR_MAX_BYTES} byte limit.`);
			}
			sidecars.push(source);
		} else if (PROJECT_FILE_NAME_PATTERN.test(source.name)) {
			if (source.byteLength > maximumEntryBytes) {
				throw new TransferManualImportRefusalError('entry-too-large',
					`Manual archive ${source.name} is ${source.byteLength} bytes, over the`
						+ ` ${maximumEntryBytes} byte limit.`);
			}
			archives.push(source);
		} else throw new TransferManualImportRefusalError('malformed-entry',
			`Manual transfer file ${source.name} is not a project archive or conversion report sidecar.`);
		if (archives.length > maximumEntries || sidecars.length > maximumEntries) {
			throw new TransferManualImportRefusalError('entry-limit',
				`A manual transfer admits at most ${maximumEntries} archives and matching sidecars.`);
		}
	}
	return Object.freeze({
		archives: Object.freeze(archives),
		sidecars: Object.freeze(sidecars),
	});
}

function pairManualSidecars(selected: Readonly<{
	archives: readonly TransferArchiveSource[];
	sidecars: readonly TransferArchiveSource[];
}>): ReadonlyMap<string, TransferArchiveSource> {
	const sidecars = new Map<string, TransferArchiveSource>();
	const archiveNames = new Set(selected.archives.map(({ name }) => name));
	for (const source of selected.sidecars) {
		const archiveName = archiveFileNameForCrossProductHandoffReportSidecar(source.name);
		if (archiveName === null || !archiveNames.has(archiveName)) {
			throw new TransferManualImportRefusalError('malformed-entry',
				`Conversion report sidecar ${source.name} has no matching selected archive.`);
		}
		if (sidecars.has(archiveName)) {
			throw new TransferManualImportRefusalError('malformed-entry',
				`Two conversion report companions were selected for archive ${archiveName}.`);
		}
		sidecars.set(archiveName, source);
	}
	return sidecars;
}

async function readManualFile(
	source: TransferArchiveSource,
	label: string,
	signal: AbortSignal | undefined,
): Promise<Uint8Array> {
	let bytes: unknown;
	try {
		bytes = await source.read();
	} catch (error) {
		if (signal?.aborted) throw error;
		throw new TransferManualImportRefusalError('malformed-entry',
			`Manual ${label} ${source.name} could not be read: ${describe(error)}`);
	}
	if (!(bytes instanceof Uint8Array)) {
		throw new TransferManualImportRefusalError('malformed-entry',
			`Manual ${label} ${source.name} did not provide Uint8Array bytes.`);
	}
	if (bytes.byteLength !== source.byteLength) {
		throw new TransferManualImportRefusalError('malformed-entry',
			`Manual ${label} ${source.name} declared ${source.byteLength} bytes but read ${bytes.byteLength}.`);
	}
	return bytes;
}

function manualMaximumEntries(value: unknown): number {
	if (value === undefined) return DEFAULT_MAXIMUM_ENTRIES;
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1
		|| value > DEFAULT_MAXIMUM_ENTRIES) {
		throw new TransferManualImportRefusalError('invalid-bound',
			`A manual transfer entry limit must be in [1, ${DEFAULT_MAXIMUM_ENTRIES}].`);
	}
	return value;
}

function manualMaximumEntryBytes(value: unknown): number {
	if (value === undefined) return DEFAULT_MAXIMUM_ENTRY_BYTES;
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1
		|| value > MAXIMUM_ADMITTED_ENTRY_BYTES) {
		throw new TransferManualImportRefusalError('invalid-bound',
			`A manual transfer byte limit must be in [1, ${MAXIMUM_ADMITTED_ENTRY_BYTES}].`);
	}
	return value;
}

function describe(error: unknown): string {
	return error instanceof Error ? error.message || error.name : String(error);
}
