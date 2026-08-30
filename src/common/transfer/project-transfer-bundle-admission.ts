/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The admitted domain of a bulk project transfer: its bounds, its entry shape
 * and the seams it is given. Everything a transport hands over crosses this
 * module first, fail-closed and by name, so the orchestration in
 * project-transfer-bundle.ts only ever sees admitted values.
 */

import { SCAPE_MIME_TYPE } from '../editor/scape-project-format.ts';
import type {
	CrossProductHandoffConversionReportV1,
} from './cross-product-handoff-conversion.ts';
import {
	admitCrossProductHandoffReportSidecar,
	type CrossProductHandoffReportSidecarV1,
} from './cross-product-handoff-report-sidecar.ts';
import { TransferManualImportRefusalError } from './transfer-manual-refusal.ts';

/** Mirrors SCAPE_FILE_EXTENSION without importing the archive implementation. */
export const PROJECT_TRANSFER_ENTRY_EXTENSION = '.scape';
export const PROJECT_TRANSFER_ENTRY_MIME_TYPE = SCAPE_MIME_TYPE;
export const PROJECT_TRANSFER_DEFAULT_MAXIMUM_ENTRIES = 512;
export const PROJECT_TRANSFER_DEFAULT_MAXIMUM_ENTRY_BYTES = 512 * 1024 * 1024;
const MAXIMUM_ADMITTED_ENTRIES = 100_000;
const MAXIMUM_ADMITTED_ENTRY_BYTES = 8 * 1024 * 1024 * 1024;
const MAXIMUM_PROJECT_ID_LENGTH = 256;
const MAXIMUM_TITLE_LENGTH = 512;
const MAXIMUM_FILE_NAME_LENGTH = 255;
const MAXIMUM_REASON_LENGTH = 512;
const ENTRY_FIELDS = new Set([
	'bytes', 'byteLength', 'conversionReportSidecar', 'fileName', 'mimeType', 'projectId', 'title',
]);

export type ProjectTransferRefusalCode =
	| 'entry-limit'
	| 'entry-too-large'
	| 'invalid-bound'
	| 'malformed-entry'
	| 'shared-memory'
	| 'store-contract';

export class ProjectTransferRefusalError extends Error {
	readonly code: ProjectTransferRefusalCode;

	constructor(code: ProjectTransferRefusalCode, message: string) {
		super(message);
		this.name = 'ProjectTransferRefusalError';
		this.code = code;
	}
}

export interface ProjectTransferProject {
	readonly id: string;
	readonly [field: string]: unknown;
}

export interface ProjectTransferEntry {
	readonly projectId: string;
	readonly title: string;
	readonly fileName: string;
	readonly mimeType: string;
	readonly byteLength: number;
	readonly bytes: Uint8Array<ArrayBuffer>;
	readonly conversionReportSidecar: Readonly<CrossProductHandoffReportSidecarV1> | null;
}

export interface ProjectTransferProgress {
	readonly stage: 'export' | 'import';
	readonly completed: number;
	readonly total: number | null;
	readonly projectId: string | null;
	readonly title: string | null;
}

export type ProjectTransferExportEvent =
	| Readonly<{ kind: 'entry'; index: number; total: number; entry: ProjectTransferEntry }>
	| Readonly<{
		kind: 'failed'; index: number; total: number;
		projectId: string; title: string | null; code: string | null; reason: string;
	}>
	| Readonly<{ kind: 'summary'; total: number; exported: number; failed: number }>;

/** The archive writer seam: exportScapeProject(project, store, options). */
export type ProjectTransferArchiveExport = (
	project: ProjectTransferProject,
	store: unknown,
	options: Readonly<{ signal?: AbortSignal; maximumBlobBytes: number }>,
) => PromiseLike<ProjectTransferArchiveExportResult | null | undefined>
	| ProjectTransferArchiveExportResult | null | undefined;

export interface ProjectTransferArchiveExportResult {
	readonly blob?: unknown;
	/** Optional archive-owned identity for a converted copy. */
	readonly projectId?: unknown;
	readonly title?: unknown;
	/** Product-native manual fallback suffix; ordinary exports retain `.scape`. */
	readonly fileExtension?: unknown;
	/** Separate custody metadata; never embedded in the native archive. */
	readonly conversionReport?: unknown;
}

/** The archive reader seam: inspectScapeProject(input, store, options). */
export type ProjectTransferArchiveInspect = (
	input: unknown,
	store: unknown,
	options: Readonly<{ signal?: AbortSignal; canonicalProjectDigest?: boolean }>,
) => PromiseLike<unknown> | unknown;

/** The archive import seam: importScapeProject(input, store, options). */
export type ProjectTransferArchiveImport = (
	input: unknown,
	store: unknown,
	options: Readonly<{ signal?: AbortSignal; collision: 'cancel' }>,
) => PromiseLike<unknown> | unknown;

export interface ProjectTransferExportStore {
	listProjects(): PromiseLike<readonly unknown[]> | readonly unknown[];
}

export interface ProjectTransferImportStore {
	loadProject(projectId: string, options?: Readonly<{ signal?: AbortSignal }>): PromiseLike<unknown> | unknown;
	/**
	 * Create-only publication seams. A store that offers one publishes a new
	 * identity under a fence and hands back the exact document it stored - the
	 * only authorship evidence a transfer can hold, since the transfer itself
	 * never writes.
	 */
	createScapeProjectIfAbsent?(project: unknown): PromiseLike<unknown> | unknown;
	createProjectIfAbsent?(project: unknown): PromiseLike<unknown> | unknown;
	/**
	 * Compare-and-delete against that exact document: it removes the row only
	 * while the store still holds the value it handed back, and reports false
	 * rather than removing anything else.
	 */
	deleteProjectIfCurrent?(project: unknown): PromiseLike<unknown> | unknown;
}

/** The create-only seams, in the order the .scape import itself prefers them. */
const PROJECT_PUBLICATION_SEAMS = ['createScapeProjectIfAbsent', 'createProjectIfAbsent'] as const;

export interface ProjectTransferWriteWitness {
	/** The store to hand the archive import in place of the real one. */
	readonly store: ProjectTransferImportStore;
	/** The exact document the store published for this identity, if any. */
	created(): unknown;
}

interface ProjectTransferWriteWitnessState {
	readonly projectId: string;
	readonly facades: WeakMap<object, ProjectTransferImportStore>;
	created: unknown;
}

const PROJECT_TRANSFER_WRITE_WITNESSES = new WeakMap<object, ProjectTransferWriteWitnessState>();

/**
 * Hand the archive import a facade over the receiving store that remembers the
 * exact document the store published for this identity.
 *
 * Everything is forwarded to the real store, and every method is applied with
 * the real store as its receiver, so a store built on private fields behaves
 * exactly as it would unwrapped. The only addition is that a create-only
 * publication's return value is retained when it carries this project id.
 */
export function witnessProjectTransferWrites(
	store: ProjectTransferImportStore,
	projectId: string,
): ProjectTransferWriteWitness {
	const state: ProjectTransferWriteWitnessState = {
		projectId,
		facades: new WeakMap(),
		created: null,
	};
	const facade = witnessStore(store as object, state);
	return Object.freeze({ store: facade, created: () => state.created });
}

/**
 * Preserve a transfer write witness when archive routing substitutes a family
 * home for the federation the import layer originally wrapped.
 */
export function projectTransferWitnessedHomeStore(store: unknown, homeStore: unknown): unknown {
	if (store === null || typeof store !== 'object'
		|| homeStore === null || typeof homeStore !== 'object') return homeStore;
	const state = PROJECT_TRANSFER_WRITE_WITNESSES.get(store);
	return state ? witnessStore(homeStore, state) : homeStore;
}

function witnessStore(
	store: object,
	state: ProjectTransferWriteWitnessState,
): ProjectTransferImportStore {
	const existing = state.facades.get(store);
	if (existing) return existing;
	const facade = new Proxy(store, {
		get(target, property) {
			const value = Reflect.get(target, property, target);
			if (typeof value !== 'function') return value;
			const method = value as (...args: unknown[]) => unknown;
			if (!(PROJECT_PUBLICATION_SEAMS as readonly (string | symbol)[]).includes(property)) {
				return (...args: unknown[]) => method.apply(target, args);
			}
			return async (...args: unknown[]) => {
				const published = await method.apply(target, args);
				const identity = asProjectTransferRecord(published).id;
				if (published && admittedProjectTransferId(identity) === state.projectId) {
					state.created = published;
				}
				return published;
			};
		},
	}) as ProjectTransferImportStore;
	state.facades.set(store, facade);
	PROJECT_TRANSFER_WRITE_WITNESSES.set(facade as object, state);
	return facade;
}

export interface ProjectTransferExportRequest {
	readonly store: ProjectTransferExportStore;
	readonly exportProject: ProjectTransferArchiveExport;
	/** Product selection lives with the caller; this module owns no product. */
	readonly select?: (project: ProjectTransferProject) => boolean;
	readonly maximumEntries?: number;
	readonly maximumEntryBytes?: number;
	readonly signal?: AbortSignal;
	readonly onProgress?: (progress: ProjectTransferProgress) => void;
}

export interface ProjectTransferImportRequest {
	readonly store: ProjectTransferImportStore;
	readonly importProject: ProjectTransferArchiveImport;
	readonly inspectProject: ProjectTransferArchiveInspect;
	readonly entries: AsyncIterable<unknown> | Iterable<unknown>;
	/** Wraps admitted bytes as a .scape archive input; a Blob by default. */
	readonly toArchiveInput?: (bytes: Uint8Array<ArrayBuffer>) => unknown;
	readonly maximumEntries?: number;
	readonly maximumEntryBytes?: number;
	readonly signal?: AbortSignal;
	readonly onProgress?: (progress: ProjectTransferProgress) => void;
}

export type ProjectTransferSkipReasonCode = 'already-present' | 'archive-read-only';
export type ProjectTransferFailureCode = 'archive-unreadable' | 'archive-identity' | 'import-failed';

export interface ProjectTransferImportRecord {
	readonly index: number;
	readonly outcome: 'imported' | 'skipped' | 'failed';
	readonly projectId: string | null;
	readonly title: string | null;
	readonly byteLength: number;
	readonly reasonCode: ProjectTransferSkipReasonCode | ProjectTransferFailureCode | null;
	readonly reason: string | null;
	readonly residue: 'none' | 'cleared' | 'retained';
	/** Non-null only after this origin imported or already recognized the bound archive. */
	readonly conversionReport: Readonly<CrossProductHandoffConversionReportV1> | null;
}

/** Why a run stopped before its entries ran out. */
export type ProjectTransferStopCode = 'aborted' | ProjectTransferRefusalCode;

export interface ProjectTransferImportStop {
	readonly code: ProjectTransferStopCode;
	/** The entry the run stopped at; entries before it carry records. */
	readonly index: number;
	readonly reason: string;
}

export interface ProjectTransferImportResult {
	readonly entries: readonly ProjectTransferImportRecord[];
	readonly total: number;
	readonly imported: number;
	readonly skipped: number;
	readonly failed: number;
	/** False when the run stopped before every offered entry was seen. */
	readonly completed: boolean;
	readonly stopped: ProjectTransferImportStop | null;
}

/**
 * Close a run over the records it accumulated. Entries already written to the
 * receiving store are reported whether the run finished or stopped, because a
 * visitor is owed the list of what actually landed either way.
 */
export function projectTransferImportResult(
	records: readonly ProjectTransferImportRecord[],
	stopped: ProjectTransferImportStop | null,
): ProjectTransferImportResult {
	return Object.freeze({
		entries: Object.freeze([...records]),
		total: records.length,
		imported: records.filter((record) => record.outcome === 'imported').length,
		skipped: records.filter((record) => record.outcome === 'skipped').length,
		failed: records.filter((record) => record.outcome === 'failed').length,
		completed: stopped === null,
		stopped,
	});
}

/**
 * Name the stop an error raised mid-run represents, or null when the error is
 * not one of them: an admission refusal and an abort both stop the run and are
 * reported on its result, while anything else is a defect in the injected
 * seams and keeps propagating.
 */
export function projectTransferImportStop(
	error: unknown,
	index: number,
	signal: AbortSignal | undefined,
): ProjectTransferImportStop | null {
	if (error instanceof ProjectTransferRefusalError) {
		return Object.freeze({ code: error.code, index, reason: describeProjectTransferError(error) });
	}
	if (error instanceof TransferManualImportRefusalError) {
		return Object.freeze({ code: error.code, index, reason: describeProjectTransferError(error) });
	}
	if (signal?.aborted) {
		return Object.freeze({ code: 'aborted' as const, index, reason: describeProjectTransferError(error) });
	}
	return null;
}

export interface AdmittedProjectTransferExportRequest {
	readonly store: ProjectTransferExportStore;
	readonly exportProject: ProjectTransferArchiveExport;
	readonly select: ((project: ProjectTransferProject) => boolean) | null;
	readonly maximumEntries: number;
	readonly maximumEntryBytes: number;
	readonly signal: AbortSignal | undefined;
	readonly onProgress: ((progress: ProjectTransferProgress) => void) | undefined;
}

export interface AdmittedProjectTransferImportRequest {
	readonly store: ProjectTransferImportStore;
	readonly importProject: ProjectTransferArchiveImport;
	readonly inspectProject: ProjectTransferArchiveInspect;
	readonly entries: AsyncIterable<unknown> | Iterable<unknown>;
	readonly toArchiveInput: (bytes: Uint8Array<ArrayBuffer>) => unknown;
	readonly maximumEntries: number;
	readonly maximumEntryBytes: number;
	readonly signal: AbortSignal | undefined;
	readonly onProgress: ((progress: ProjectTransferProgress) => void) | undefined;
}

export interface AdmittedProjectTransferEntry {
	readonly projectId: string | null;
	readonly title: string | null;
	readonly bytes: Uint8Array<ArrayBuffer>;
	readonly conversionReportSidecar: Readonly<CrossProductHandoffReportSidecarV1> | null;
}

export function admitProjectTransferExportRequest(
	request: ProjectTransferExportRequest,
): AdmittedProjectTransferExportRequest {
	const value = asRequestRecord(request, 'A project transfer export request');
	const store = value.store as ProjectTransferExportStore;
	if (typeof store?.listProjects !== 'function') {
		throw new TypeError('A project transfer export requires a store that lists projects.');
	}
	if (typeof value.exportProject !== 'function') {
		throw new TypeError('A project transfer export requires an archive export function.');
	}
	if (value.select !== undefined && typeof value.select !== 'function') {
		throw new TypeError('A project transfer selection must be a function.');
	}
	return {
		store,
		exportProject: value.exportProject as ProjectTransferArchiveExport,
		select: (value.select as ((project: ProjectTransferProject) => boolean) | undefined) ?? null,
		maximumEntries: admitEntryCount(value.maximumEntries),
		maximumEntryBytes: admitEntryBytes(value.maximumEntryBytes),
		signal: admitSignal(value.signal),
		onProgress: admitProgress(value.onProgress),
	};
}

export function admitProjectTransferImportRequest(
	request: ProjectTransferImportRequest,
): AdmittedProjectTransferImportRequest {
	const value = asRequestRecord(request, 'A project transfer import request');
	const store = value.store as ProjectTransferImportStore;
	if (typeof store?.loadProject !== 'function') {
		throw new TypeError('A project transfer import requires a store that loads projects.');
	}
	if (typeof value.importProject !== 'function' || typeof value.inspectProject !== 'function') {
		throw new TypeError('A project transfer import requires archive inspect and import functions.');
	}
	const entries = value.entries as AsyncIterable<unknown> | Iterable<unknown>;
	if (!isIterableEntries(entries)) {
		throw new TypeError('A project transfer import requires an iterable of entries.');
	}
	if (value.toArchiveInput !== undefined && typeof value.toArchiveInput !== 'function') {
		throw new TypeError('A project transfer archive input factory must be a function.');
	}
	return {
		store,
		importProject: value.importProject as ProjectTransferArchiveImport,
		inspectProject: value.inspectProject as ProjectTransferArchiveInspect,
		entries,
		toArchiveInput: (value.toArchiveInput as ((bytes: Uint8Array<ArrayBuffer>) => unknown) | undefined)
			?? ((bytes: Uint8Array<ArrayBuffer>) => new Blob([bytes], { type: PROJECT_TRANSFER_ENTRY_MIME_TYPE })),
		maximumEntries: admitEntryCount(value.maximumEntries),
		maximumEntryBytes: admitEntryBytes(value.maximumEntryBytes),
		signal: admitSignal(value.signal),
		onProgress: admitProgress(value.onProgress),
	};
}

/** Admit one transport-supplied entry as an exact own-property record. */
export function admitProjectTransferEntry(
	value: unknown,
	maximumEntryBytes: number,
	index: number,
): AdmittedProjectTransferEntry {
	if (!isPlainRecord(value)) {
		throw new ProjectTransferRefusalError('malformed-entry',
			`Project transfer entry ${index} is not a plain record.`);
	}
	for (const field of Object.getOwnPropertyNames(value)) {
		if (!ENTRY_FIELDS.has(field)) {
			throw new ProjectTransferRefusalError('malformed-entry',
				`Project transfer entry ${index} carries the unknown field ${field}.`);
		}
	}
	if (Object.getOwnPropertySymbols(value).length) {
		throw new ProjectTransferRefusalError('malformed-entry',
			`Project transfer entry ${index} carries symbol-keyed fields.`);
	}
	const bytes = value.bytes;
	admitProjectTransferBytes(bytes, maximumEntryBytes, `Project transfer entry ${index}`);
	if (value.byteLength !== undefined && value.byteLength !== bytes.byteLength) {
		throw new ProjectTransferRefusalError('malformed-entry',
			`Project transfer entry ${index} declares a byte length its payload does not match.`);
	}
	const projectId = admitOptionalText(value.projectId, MAXIMUM_PROJECT_ID_LENGTH, index, 'projectId');
	let conversionReportSidecar: Readonly<CrossProductHandoffReportSidecarV1> | null = null;
	if (value.conversionReportSidecar !== undefined && value.conversionReportSidecar !== null) {
		if (projectId === null) {
			throw new ProjectTransferRefusalError('malformed-entry',
				`Project transfer entry ${index} cannot bind a conversion report without a projectId.`);
		}
		try {
			conversionReportSidecar = admitCrossProductHandoffReportSidecar(
				value.conversionReportSidecar, { entryId: projectId, archive: bytes },
			);
		} catch (error) {
			throw new ProjectTransferRefusalError('malformed-entry',
				`Project transfer entry ${index} has an invalid conversion report sidecar: ${describeProjectTransferError(error)}`);
		}
	}
	return Object.freeze({
		projectId,
		title: admitOptionalText(value.title, MAXIMUM_TITLE_LENGTH, index, 'title'),
		bytes,
		conversionReportSidecar,
	});
}

/** Bulk payloads are ordinary, non-shared Uint8Arrays within the entry bound. */
export function admitProjectTransferBytes(
	value: unknown,
	maximumEntryBytes: number,
	label: string,
): asserts value is Uint8Array<ArrayBuffer> {
	if (!(value instanceof Uint8Array)) {
		throw new ProjectTransferRefusalError('malformed-entry', `${label} must carry its archive as a Uint8Array.`);
	}
	if (typeof SharedArrayBuffer === 'function' && value.buffer instanceof SharedArrayBuffer) {
		throw new ProjectTransferRefusalError('shared-memory', `${label} must not be backed by SharedArrayBuffer.`);
	}
	if (value.byteLength > maximumEntryBytes) {
		throw new ProjectTransferRefusalError('entry-too-large',
			`${label} is ${value.byteLength} bytes, over the ${maximumEntryBytes} byte entry limit.`);
	}
}

export function selectProjectTransferProjects(
	listed: readonly unknown[],
	select: ((project: ProjectTransferProject) => boolean) | null,
	maximumEntries: number,
): readonly ProjectTransferProject[] {
	const selected: ProjectTransferProject[] = [];
	for (const candidate of listed) {
		if (!isPlainRecord(candidate) || !admittedProjectTransferId(candidate.id)) {
			throw new ProjectTransferRefusalError('store-contract',
				'A listed project must be a record identified by a non-empty string id.');
		}
		const project = candidate as unknown as ProjectTransferProject;
		if (select && !select(project)) continue;
		if (selected.length >= maximumEntries) {
			throw new ProjectTransferRefusalError('entry-limit',
				`A project transfer admits at most ${maximumEntries} entries.`);
		}
		selected.push(project);
	}
	return selected;
}

export function projectTransferEntryLimitRefusal(maximumEntries: number): ProjectTransferRefusalError {
	return new ProjectTransferRefusalError('entry-limit',
		`A project transfer admits at most ${maximumEntries} entries.`);
}

function admitEntryCount(value: unknown): number {
	if (value === undefined) return PROJECT_TRANSFER_DEFAULT_MAXIMUM_ENTRIES;
	if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > MAXIMUM_ADMITTED_ENTRIES) {
		throw new ProjectTransferRefusalError('invalid-bound',
			`A project transfer entry limit must be an integer between 1 and ${MAXIMUM_ADMITTED_ENTRIES}.`);
	}
	return value as number;
}

function admitEntryBytes(value: unknown): number {
	if (value === undefined) return PROJECT_TRANSFER_DEFAULT_MAXIMUM_ENTRY_BYTES;
	if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > MAXIMUM_ADMITTED_ENTRY_BYTES) {
		throw new ProjectTransferRefusalError('invalid-bound',
			`A project transfer entry byte limit must be an integer between 1 and ${MAXIMUM_ADMITTED_ENTRY_BYTES}.`);
	}
	return value as number;
}

function admitSignal(value: unknown): AbortSignal | undefined {
	if (value === undefined || value === null) return undefined;
	if (typeof AbortSignal === 'function' && value instanceof AbortSignal) return value;
	throw new TypeError('A project transfer signal must be an AbortSignal.');
}

function admitProgress(value: unknown): ((progress: ProjectTransferProgress) => void) | undefined {
	if (value === undefined || value === null) return undefined;
	if (typeof value !== 'function') throw new TypeError('A project transfer progress reporter must be a function.');
	return value as (progress: ProjectTransferProgress) => void;
}

function admitOptionalText(value: unknown, maximumLength: number, index: number, field: string): string | null {
	if (value === undefined || value === null) return null;
	if (typeof value !== 'string' || value.length > maximumLength) {
		throw new ProjectTransferRefusalError('malformed-entry',
			`Project transfer entry ${index} has an inadmissible ${field}.`);
	}
	return value;
}

export function admittedProjectTransferId(value: unknown): string | null {
	return typeof value === 'string' && value.length > 0 && value.length <= MAXIMUM_PROJECT_ID_LENGTH
		? value
		: null;
}

export function admittedProjectTransferTitle(value: unknown): string | null {
	return typeof value === 'string' && value.length > 0 ? value.slice(0, MAXIMUM_TITLE_LENGTH) : null;
}

export function projectTransferFileName(title: string, projectId: string): string {
	const stem = title.replace(/[^\p{L}\p{N} ._-]/gu, ' ').replace(/\s+/gu, ' ').trim().replace(/[. ]+$/u, '');
	const base = (stem || projectId).slice(0, MAXIMUM_FILE_NAME_LENGTH - PROJECT_TRANSFER_ENTRY_EXTENSION.length);
	return `${base}${PROJECT_TRANSFER_ENTRY_EXTENSION}`;
}

export function describeProjectTransferError(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	return message.slice(0, MAXIMUM_REASON_LENGTH) || 'The .scape transfer step failed without a message.';
}

export function asProjectTransferRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function asRequestRecord(value: unknown, label: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be a record.`);
	return value as unknown as Record<string, unknown>;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
}

function isIterableEntries(value: unknown): value is AsyncIterable<unknown> | Iterable<unknown> {
	if (!value || (typeof value !== 'object' && typeof value !== 'function')) return false;
	const candidate = value as Record<symbol, unknown>;
	return typeof candidate[Symbol.asyncIterator] === 'function' || typeof candidate[Symbol.iterator] === 'function';
}
