/* SPDX-License-Identifier: AGPL-3.0-only */

import { validateAudioEditorProjectV9, type AudioEditorProjectV9 } from '../project-v9.ts';
import {
	parseScapeProjectDocument,
	serializeScapeProjectDocument,
} from '../scape-project-document.ts';
import type {
	ProjectDocument,
	ProjectLoadOptions,
	ProjectRepositoryPort,
	ProjectRevision,
} from './project-repository.ts';
import {
	desktopSharedProjectHasSourceReferences,
	verifyDesktopSharedProjectSourceAvailability,
	type DesktopSharedProjectSourceAvailability,
} from './desktop-shared-project-source-availability.ts';
import {
	acquireDesktopSharedProjectMedia,
	prepareDesktopSharedProjectMediaHandoff,
	type DesktopSharedMediaAcquisition,
	type DesktopSharedManagedSourceDescriptor,
	type DesktopSharedSourceTransferBridge,
	type DesktopSharedSourceTransferStore,
} from './desktop-shared-project-media-transfer.ts';

type CurrentProjectDocument = AudioEditorProjectV9 & ProjectDocument & Readonly<{
	id: string;
	title: string;
	revision: number;
	updatedAt: string;
}>;

const MIB = 1024 * 1024;
const MAXIMUM_PROJECT_ID_BYTES = 4 * 1024;
const MAXIMUM_PROJECT_SUMMARIES = 10_000;
const SUMMARY_KEYS = Object.freeze(['id', 'title', 'revision', 'updatedAt'] as const);

export const MAXIMUM_DESKTOP_SHARED_PROJECT_DOCUMENT_BYTES = 256 * MIB;

export interface DesktopSharedProjectSummary {
	readonly id: string;
	readonly title: string;
	readonly revision: number;
	readonly updatedAt: string;
}

/** Pathless renderer capability; Electron implementation details remain in main/preload. */
export interface DesktopSharedProjectBridge {
	listSharedProjects(): Promise<readonly DesktopSharedProjectSummary[]>;
	readSharedProject(projectId: string): Promise<string | null>;
	commitSharedProject(canonicalDocument: string): Promise<string>;
	deleteSharedProject(projectId: string): Promise<boolean>;
	readSharedProjectBundle?(projectId: string): Promise<Readonly<{
		document: string;
		sources: readonly DesktopSharedManagedSourceDescriptor[];
	}> | null>;
	beginSharedSourceWrite?: DesktopSharedSourceTransferBridge['beginSharedSourceWrite'];
	writeSharedSourceChunk?: DesktopSharedSourceTransferBridge['writeSharedSourceChunk'];
	finishSharedSourceWrite?: DesktopSharedSourceTransferBridge['finishSharedSourceWrite'];
	abortSharedSourceWrite?: DesktopSharedSourceTransferBridge['abortSharedSourceWrite'];
	readSharedSourceChunk?: DesktopSharedSourceTransferBridge['readSharedSourceChunk'];
}

export interface DesktopSharedProjectRepositoryOptions {
	readonly bridge: DesktopSharedProjectBridge;
	readonly shadow: ProjectRepositoryPort;
	readonly sourceAvailability: DesktopSharedProjectSourceAvailability;
	readonly sourceTransfer?: DesktopSharedSourceTransferStore | null;
	readonly onLocalCleanupError: (error: DesktopSharedProjectLocalCleanupError) => void;
	readonly maximumDocumentBytes?: number;
}

/**
 * The shared catalog owns latest project metadata and documents. IndexedDB is
 * retained as the local revision/source/media shadow. Source bytes cross the
 * product boundary only through the explicit managed-media handoff.
 */
export class DesktopSharedProjectRepository implements ProjectRepositoryPort {
	readonly #bridge: DesktopSharedProjectBridge;
	readonly #maximumDocumentBytes: number;
	readonly #latestMutations = new Map<string, Promise<void>>();
	readonly #onLocalCleanupError: (error: DesktopSharedProjectLocalCleanupError) => void;
	readonly #shadow: ProjectRepositoryPort;
	readonly #sourceAvailability: DesktopSharedProjectSourceAvailability;
	readonly #sourceTransfer: DesktopSharedSourceTransferStore | null;

	constructor(options: DesktopSharedProjectRepositoryOptions) {
		this.#bridge = validateBridge(options.bridge);
		this.#shadow = validateShadow(options.shadow);
		this.#sourceAvailability = validateSourceAvailability(options.sourceAvailability);
		this.#sourceTransfer = options.sourceTransfer ?? null;
		if (typeof options.onLocalCleanupError !== 'function') {
			throw new TypeError('Desktop shared project cleanup reporting is required.');
		}
		this.#onLocalCleanupError = options.onLocalCleanupError;
		this.#maximumDocumentBytes = maximumDocumentBytes(options.maximumDocumentBytes);
	}

	async save(project: ProjectDocument): Promise<ProjectDocument> {
		const admitted = admitCurrentProject(project, this.#maximumDocumentBytes);
		return this.#serializeLatestMutation(admitted.id, undefined, async () => {
			const snapshot = await this.#shadow.save(admitted);
			assertCurrentProject(snapshot);
			if (snapshot.id !== admitted.id || snapshot.revision !== admitted.revision) {
				throw new Error('Desktop shared project shadow changed the project identity or revision.');
			}
			const document = serializeBoundedProject(snapshot, this.#maximumDocumentBytes);
			const acknowledgement = await this.#bridge.commitSharedProject(document);
			parseCanonicalProject(acknowledgement, this.#maximumDocumentBytes, 'commit acknowledgement');
			if (acknowledgement !== document) {
				throw new Error('Desktop shared project acknowledgement does not match the local snapshot.');
			}
			return snapshot;
		});
	}

	async load(projectId: string, options: ProjectLoadOptions = {}): Promise<ProjectDocument | null> {
		if (options.revision !== undefined) return this.#shadow.load(projectId, options);
		assertProjectId(projectId);
		return this.#serializeLatestMutation(projectId, options.signal, async () => {
			throwIfAborted(options.signal);
			const bundle = await raceAbort(
				() => this.#readBundle(projectId),
				options.signal,
			);
			throwIfAborted(options.signal);
			if (bundle === null) return null;
			const { document } = bundle;
			const project = parseCanonicalProject(document, this.#maximumDocumentBytes, 'loaded document');
			if (project.id !== projectId) {
				throw new Error('Desktop shared project document identity does not match the requested project.');
			}
			let acquisition: DesktopSharedMediaAcquisition | null = null;
			if (desktopSharedProjectHasSourceReferences(project)) {
				const priorLocalProject = await this.#shadow.load(projectId, { signal: options.signal });
				throwIfAborted(options.signal);
				if (bundle.managed && this.#sourceTransfer) {
					acquisition = await acquireDesktopSharedProjectMedia(
						project,
						priorLocalProject,
						bundle.sources,
						managedTransferBridge(this.#bridge),
						this.#sourceTransfer,
						{ signal: options.signal },
					);
				}
				try {
					await verifyDesktopSharedProjectSourceAvailability(
						project,
						priorLocalProject,
						this.#sourceAvailability,
						{ signal: options.signal, trustedSourceIds: acquisition?.trustedSourceIds },
					);
					throwIfAborted(options.signal);
				} catch (error) {
					await rollbackAcquisition(acquisition, error);
				}
			}
			const snapshot = await this.#saveExactLoadedProject(project, document)
				.catch((error: unknown) => rollbackAcquisition(acquisition, error));
			// Once the exact snapshot is durable, cancellation must not remove managed media it references.
			acquisition?.commit();
			throwIfAborted(options.signal);
			return snapshot;
		});
	}

	async prepareHandoff(project: ProjectDocument, signal?: AbortSignal) {
		const admitted = admitCurrentProject(project, this.#maximumDocumentBytes);
		return this.#serializeLatestMutation(admitted.id, signal, async () => {
			if (!this.#sourceTransfer) {
				if (desktopSharedProjectHasSourceReferences(admitted)) {
					throw new Error('Desktop shared-source transfer storage is unavailable.');
				}
				return Object.freeze([]);
			}
			return prepareDesktopSharedProjectMediaHandoff(
				admitted,
				managedTransferBridge(this.#bridge),
				this.#sourceTransfer,
				{ signal },
			);
		});
	}

	async #readBundle(projectId: string): Promise<Readonly<{
		document: string;
		managed: boolean;
		sources: readonly DesktopSharedManagedSourceDescriptor[];
	}> | null> {
		if (typeof this.#bridge.readSharedProjectBundle !== 'function') {
			const document = await this.#bridge.readSharedProject(projectId);
			return document === null ? null : Object.freeze({ document, managed: false, sources: Object.freeze([]) });
		}
		const value = await this.#bridge.readSharedProjectBundle(projectId);
		if (value === null) return null;
		if (!value || typeof value !== 'object' || typeof value.document !== 'string' || !Array.isArray(value.sources)) {
			throw new TypeError('Desktop shared project bundle is invalid.');
		}
		return Object.freeze({ document: value.document, managed: true, sources: Object.freeze([...value.sources]) });
	}

	async #saveExactLoadedProject(
		project: CurrentProjectDocument,
		document: string,
	): Promise<CurrentProjectDocument> {
		const snapshot = await this.#shadow.save(project);
		assertCurrentProject(snapshot);
		if (snapshot.id !== project.id || snapshot.revision !== project.revision) {
			throw new Error('Desktop shared project shadow changed the loaded identity or revision.');
		}
		if (serializeBoundedProject(snapshot, this.#maximumDocumentBytes) !== document) {
			throw new Error('Desktop shared project shadow changed the authoritative loaded document.');
		}
		return snapshot;
	}

	async #serializeLatestMutation<Value>(
		projectId: string,
		signal: AbortSignal | undefined,
		operation: () => Promise<Value>,
	): Promise<Value> {
		const predecessor = this.#latestMutations.get(projectId) ?? Promise.resolve();
		let release = (): void => undefined;
		const completion = new Promise<void>((resolve) => { release = resolve; });
		const queued = predecessor.catch(() => undefined).then(() => completion);
		this.#latestMutations.set(projectId, queued);
		try {
			await raceAbort(() => predecessor.catch(() => undefined), signal);
			throwIfAborted(signal);
			return await operation();
		} finally {
			release();
			void queued.then(() => {
				if (this.#latestMutations.get(projectId) === queued) this.#latestMutations.delete(projectId);
			});
		}
	}

	async list(): Promise<ProjectDocument[]> {
		const summaries = await this.#bridge.listSharedProjects();
		if (!Array.isArray(summaries) || summaries.length > MAXIMUM_PROJECT_SUMMARIES) {
			throw new RangeError('Desktop shared project summary count exceeds its limit.');
		}
		const projects = summaries.map(validateSummary);
		if (new Set(projects.map(({ id }) => id)).size !== projects.length) {
			throw new TypeError('Desktop shared project summaries contain duplicate identities.');
		}
		return projects.sort(sortProjects);
	}

	listRevisions(projectId: string): Promise<ProjectRevision[]> {
		return this.#shadow.listRevisions(projectId);
	}

	async delete(projectId: string): Promise<void> {
		assertProjectId(projectId);
		await this.#serializeLatestMutation(projectId, undefined, async () => {
			await this.#bridge.deleteSharedProject(projectId);
			try {
				await this.#shadow.delete(projectId);
			} catch (cause) {
				const error = new DesktopSharedProjectLocalCleanupError(projectId, cause);
				try {
					this.#onLocalCleanupError(error);
				} catch {
					// Reporting cannot restore the already-cleared authoritative entry.
				}
			}
		});
	}
}

async function rollbackAcquisition(
	acquisition: DesktopSharedMediaAcquisition | null,
	primary: unknown,
): Promise<never> {
	try {
		await acquisition?.rollback();
	} catch (cleanupError) {
		throw new AggregateError(
			[primary, cleanupError],
			'Desktop shared project load and managed-source rollback both failed.',
		);
	}
	throw primary;
}

/** A shared delete succeeded, but stale local shadow data could not be removed. */
export class DesktopSharedProjectLocalCleanupError extends Error {
	readonly projectId: string;
	readonly remoteDeleted = true;

	constructor(projectId: string, cause: unknown) {
		super(`Desktop shared project ${projectId} was deleted, but local shadow cleanup failed.`, { cause });
		this.name = 'DesktopSharedProjectLocalCleanupError';
		this.projectId = projectId;
	}
}

function admitCurrentProject(value: unknown, maximumBytes: number): CurrentProjectDocument {
	assertCurrentProject(value);
	assertProjectId(value.id);
	assertProjectTitle(value.title);
	const document = serializeBoundedProject(value, maximumBytes);
	return parseCanonicalProject(document, maximumBytes, 'input document');
}

function assertCurrentProject(value: unknown): asserts value is CurrentProjectDocument {
	validateAudioEditorProjectV9(value);
}

function serializeBoundedProject(project: CurrentProjectDocument, maximumBytes: number): string {
	const document = serializeScapeProjectDocument(project);
	assertBoundedText(document, maximumBytes);
	return document;
}

function parseCanonicalProject(
	document: unknown,
	maximumBytes: number,
	label: string,
): CurrentProjectDocument {
	assertBoundedText(document, maximumBytes);
	const project = parseScapeProjectDocument(document);
	assertCurrentProject(project);
	if (serializeScapeProjectDocument(project) !== document) {
		throw new TypeError(`Desktop shared project ${label} is not canonical.`);
	}
	return project;
}

function assertBoundedText(value: unknown, maximumBytes: number): asserts value is string {
	if (typeof value !== 'string') throw new TypeError('Desktop shared project document must be text.');
	if (value.length > maximumBytes || utf8ByteLength(value, maximumBytes) > maximumBytes) {
		throw new RangeError('Desktop shared project document exceeds its byte limit.');
	}
}

function utf8ByteLength(value: string, stopAfter: number): number {
	let bytes = 0;
	for (let index = 0; index < value.length && bytes <= stopAfter; index += 1) {
		const code = value.charCodeAt(index);
		if (code <= 0x7f) bytes += 1;
		else if (code <= 0x7ff) bytes += 2;
		else if (code >= 0xd800 && code <= 0xdbff && isLowSurrogate(value.charCodeAt(index + 1))) {
			bytes += 4;
			index += 1;
		} else bytes += 3;
	}
	return bytes;
}

function isLowSurrogate(value: number): boolean {
	return value >= 0xdc00 && value <= 0xdfff;
}

function validateSummary(value: unknown): ProjectDocument {
	if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
		throw new TypeError('Desktop shared project summary must be a plain object.');
	}
	const record = value as Record<string, unknown>;
	const keys = Object.keys(record);
	if (keys.length !== SUMMARY_KEYS.length || keys.some((key) => !SUMMARY_KEYS.includes(key as typeof SUMMARY_KEYS[number]))) {
		throw new TypeError('Desktop shared project summary has unsupported fields.');
	}
	assertProjectId(record.id);
	assertProjectTitle(record.title);
	if (!Number.isSafeInteger(record.revision) || Number(record.revision) < 0) {
		throw new RangeError('Desktop shared project summary has an invalid revision.');
	}
	if (typeof record.updatedAt !== 'string' || !isCanonicalTimestamp(record.updatedAt)) {
		throw new TypeError('Desktop shared project summary has an invalid update timestamp.');
	}
	return Object.freeze({
		id: record.id,
		title: record.title,
		revision: record.revision as number,
		updatedAt: record.updatedAt,
	});
}

function assertProjectTitle(value: unknown): asserts value is string {
	if (typeof value !== 'string' || !value || value.length > 255
		|| value.trim() !== value || /[\u0000-\u001f\u007f]/u.test(value)) {
		throw new TypeError('Desktop shared project title is invalid.');
	}
}

function assertProjectId(value: unknown): asserts value is string {
	if (typeof value !== 'string' || !value.trim()
		|| utf8ByteLength(value, MAXIMUM_PROJECT_ID_BYTES) > MAXIMUM_PROJECT_ID_BYTES) {
		throw new TypeError('Desktop shared project identity is invalid.');
	}
}

function isCanonicalTimestamp(value: string): boolean {
	const milliseconds = Date.parse(value);
	return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value;
}

function sortProjects(left: ProjectDocument, right: ProjectDocument): number {
	return String(right.updatedAt).localeCompare(String(left.updatedAt));
}

function maximumDocumentBytes(value: number | undefined): number {
	const maximum = value ?? MAXIMUM_DESKTOP_SHARED_PROJECT_DOCUMENT_BYTES;
	if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > MAXIMUM_DESKTOP_SHARED_PROJECT_DOCUMENT_BYTES) {
		throw new RangeError('Desktop shared project document byte limit is invalid.');
	}
	return maximum;
}

function validateBridge(value: DesktopSharedProjectBridge): DesktopSharedProjectBridge {
	if (!value || typeof value !== 'object') throw new TypeError('Desktop shared project bridge is required.');
	for (const method of ['listSharedProjects', 'readSharedProject', 'commitSharedProject', 'deleteSharedProject'] as const) {
		if (typeof value[method] !== 'function') throw new TypeError(`Desktop shared project bridge.${method} is required.`);
	}
	return value;
}

function validateShadow(value: ProjectRepositoryPort): ProjectRepositoryPort {
	if (!value || typeof value !== 'object') throw new TypeError('Desktop shared project shadow is required.');
	for (const method of ['save', 'load', 'list', 'listRevisions', 'delete'] as const) {
		if (typeof value[method] !== 'function') throw new TypeError(`Desktop shared project shadow.${method} is required.`);
	}
	return value;
}

function validateSourceAvailability(
	value: DesktopSharedProjectSourceAvailability,
): DesktopSharedProjectSourceAvailability {
	if (!value || typeof value !== 'object') {
		throw new TypeError('Desktop shared project source availability is required.');
	}
	for (const method of [
		'getSourceMetadata',
		'readSourceChunks',
		'getMediaAssetMetadata',
		'loadMediaAsset',
	] as const) {
		if (typeof value[method] !== 'function') {
			throw new TypeError(`Desktop shared project source availability.${method} is required.`);
		}
	}
	return value;
}

function managedTransferBridge(value: DesktopSharedProjectBridge): DesktopSharedSourceTransferBridge {
	for (const method of [
		'beginSharedSourceWrite',
		'writeSharedSourceChunk',
		'finishSharedSourceWrite',
		'abortSharedSourceWrite',
		'readSharedSourceChunk',
	] as const) {
		if (typeof value[method] !== 'function') {
			throw new TypeError(`Desktop shared project bridge.${method} is required for managed media.`);
		}
	}
	return value as DesktopSharedSourceTransferBridge;
}

function raceAbort<Value>(read: () => Promise<Value>, signal?: AbortSignal): Promise<Value> {
	if (!signal) return Promise.resolve().then(read);
	if (signal.aborted) return Promise.reject(signal.reason);
	return new Promise<Value>((resolve, reject) => {
		let settled = false;
		const finish = (complete: () => void): void => {
			if (settled) return;
			settled = true;
			signal.removeEventListener('abort', onAbort);
			complete();
		};
		const onAbort = (): void => finish(() => reject(signal.reason));
		signal.addEventListener('abort', onAbort, { once: true });
		if (signal.aborted) {
			onAbort();
			return;
		}
		void Promise.resolve().then(read).then(
			(value) => finish(() => resolve(value)),
			(error: unknown) => finish(() => reject(error)),
		);
	});
}

function throwIfAborted(signal?: AbortSignal): void {
	if (signal?.aborted) throw signal.reason;
}
