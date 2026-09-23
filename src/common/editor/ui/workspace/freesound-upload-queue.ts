/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	FreesoundDescribeUploadRequest,
	FreesoundPendingUpload,
	FreesoundPublishLicense,
	FreesoundSubmittedUpload,
} from './freesound-auth-upload-client.ts';
import {
	createFreesoundUploadMetadataDefaults,
	validateFreesoundUploadMetadata,
	type FreesoundUploadClipMetadata,
	type FreesoundUploadLicenseAnalysis,
	type FreesoundUploadSourceMetadata,
} from '../../freesound-upload-metadata.ts';

export type { FreesoundDescribeUploadRequest } from './freesound-auth-upload-client.ts';

export type FreesoundUploadStatus =
	| 'queued'
	| 'preparing'
	| 'uploading'
	| 'ready-to-publish'
	| 'publishing'
	| 'submitted'
	| 'failed'
	| 'cancelled';

export interface FreesoundClipUploadReference {
	readonly projectId: string;
	readonly clipId: string;
	readonly clipTitle?: string;
}

export interface FreesoundMaterializedClip {
	readonly file: File;
	readonly source?: FreesoundUploadSourceMetadata;
	readonly clip?: FreesoundUploadClipMetadata;
	readonly clipTitle: string;
	readonly description?: string;
	readonly tags?: readonly string[];
}

export interface FreesoundUploadItem {
	readonly id: string;
	readonly sourceKind: 'file' | 'clip' | 'remote';
	readonly fileName: string;
	readonly byteLength: number;
	readonly status: FreesoundUploadStatus;
	readonly title: string;
	readonly description: string;
	readonly tags: readonly string[];
	readonly categoryId?: string;
	readonly license?: FreesoundPublishLicense;
	readonly allowedLicenses?: readonly FreesoundPublishLicense[];
	readonly attributionText?: string;
	readonly blockedReason?: string | null;
	readonly requiresRightsConfirmation?: boolean;
	readonly rightsConfirmed?: boolean;
	readonly uploadFilename?: string;
	readonly errorMessage?: string;
	readonly soundId?: number;
	readonly soundUrl?: string;
	readonly remoteStatus?: string;
}

export interface FreesoundPublishDraft {
	readonly title: string;
	readonly description: string;
	readonly tags: readonly string[];
	readonly categoryId: string;
	readonly license: FreesoundPublishLicense;
	readonly rightsConfirmed?: boolean;
}

export interface FreesoundUploadQueueSnapshot {
	readonly active: boolean;
	readonly items: readonly FreesoundUploadItem[];
}

export interface FreesoundUploadQueueRuntime {
	readonly upload: (file: File, signal?: AbortSignal) => Promise<Readonly<{ uploadFilename: string }>>;
	readonly describe: (
		request: FreesoundDescribeUploadRequest,
		signal?: AbortSignal,
	) => Promise<FreesoundSubmittedUpload>;
	readonly materializeClip?: (
		request: FreesoundClipUploadReference & Readonly<{ signal?: AbortSignal }>,
	) => Promise<FreesoundMaterializedClip>;
	readonly prepareFile?: (file: File, signal?: AbortSignal) => Promise<File>;
	readonly createId?: () => string;
}

export interface FreesoundUploadQueue {
	readonly getSnapshot: () => FreesoundUploadQueueSnapshot;
	readonly subscribe: (listener: () => void) => () => void;
	readonly enqueueFiles: (files: readonly File[]) => readonly string[];
	readonly enqueueClip: (reference: FreesoundClipUploadReference) => string;
	readonly publish: (id: string, draft: FreesoundPublishDraft) => Promise<void>;
	readonly retry: (id: string) => void;
	readonly cancel: (id: string) => void;
	readonly remove: (id: string) => void;
	readonly restorePending: (items: readonly FreesoundPendingUpload[]) => void;
	readonly clear: () => void;
}

interface QueueRecord {
	item: FreesoundUploadItem;
	file?: File;
	clip?: FreesoundClipUploadReference;
	abort?: AbortController;
	licenseAnalysis: FreesoundUploadLicenseAnalysis;
}

const MAXIMUM_QUEUE_ITEMS = 100;
const MAXIMUM_UPLOAD_BYTES = 100_000_000;
const AUDIO_FILE_EXTENSION = /\.(?:aac|aif|aiff|bw64|flac|m4a|m4v|mp2|mp3|mp4|oga|ogg|opus|rf64|wav|wave|wavpack|webm|wv)$/iu;
const FREESOUND_DIRECT_EXTENSION = /\.(?:aif|aiff|flac|mp3|ogg|wav)$/iu;
const FREESOUND_DIRECT_MIME_BY_EXTENSION = Object.freeze({
	aif: 'audio/aiff',
	aiff: 'audio/aiff',
	flac: 'audio/flac',
	mp3: 'audio/mpeg',
	ogg: 'audio/ogg',
	wav: 'audio/wav',
} as const);

export function createFreesoundUploadQueue(runtime: FreesoundUploadQueueRuntime): FreesoundUploadQueue {
	const records: QueueRecord[] = [];
	const listeners = new Set<() => void>();
	const createId = runtime.createId ?? defaultUploadId;
	let active = false;
	let snapshot = freezeSnapshot(active, records);

	const publish = async (id: string, draft: FreesoundPublishDraft): Promise<void> => {
		const record = findRecord(records, id);
		if (record.item.status !== 'ready-to-publish' || !record.item.uploadFilename) {
			throw new Error('This upload is not ready to publish.');
		}
		const request = validatePublishDraft(record.item.uploadFilename, draft, record.licenseAnalysis);
		const abort = new AbortController();
		record.abort = abort;
		update(record, { ...draft, tags: Object.freeze([...request.tags]), status: 'publishing', errorMessage: undefined });
		try {
			const submitted = await runtime.describe(request, abort.signal);
			update(record, {
				status: 'submitted',
				remoteStatus: submitted.status,
				...(submitted.soundId ? { soundId: submitted.soundId } : {}),
				...(submitted.soundUrl ? { soundUrl: submitted.soundUrl } : {}),
			});
		} catch (error) {
			update(record, {
				status: abort.signal.aborted ? 'cancelled' : 'ready-to-publish',
				errorMessage: errorMessage(error, 'Freesound could not publish this upload.'),
			});
			throw error;
		} finally {
			record.abort = undefined;
		}
	};

	const pump = async (): Promise<void> => {
		if (active) return;
		active = true;
		publishSnapshot();
		try {
			for (;;) {
				const record = records.find(({ item }) => item.status === 'queued');
				if (!record) break;
				const abort = new AbortController();
				record.abort = abort;
				try {
					let file = record.file;
					if (!file && record.clip) {
						if (!runtime.materializeClip) throw new Error('Clip uploads are unavailable in this build.');
						update(record, { status: 'preparing', errorMessage: undefined });
						const materialized = await runtime.materializeClip({ ...record.clip, signal: abort.signal });
						validateInputFile(materialized.file);
						file = materialized.file;
						record.file = file;
						const defaults = createFreesoundUploadMetadataDefaults({
							fileName: file.name,
							clip: materialized.clip ?? { title: materialized.clipTitle },
							source: materialized.source,
						});
						update(record, {
							fileName: file.name,
							byteLength: file.size,
							title: defaults.title,
							description: materialized.description ?? defaults.description,
							tags: Object.freeze([...(materialized.tags ?? defaults.tags)]),
							license: defaults.license,
							allowedLicenses: defaults.allowedLicenses,
							attributionText: defaults.attributionText,
							blockedReason: defaults.blockedReason,
							requiresRightsConfirmation: defaults.requiresRightsConfirmation,
						});
						record.licenseAnalysis = defaults;
					}
					if (!file) throw new Error('The queued audio is unavailable.');
					if (!FREESOUND_DIRECT_EXTENSION.test(file.name)) {
						if (!runtime.prepareFile) throw new Error(`${file.name} must be converted to WAV before upload.`);
						update(record, { status: 'preparing', errorMessage: undefined });
						file = await runtime.prepareFile(file, abort.signal);
						validatePreparedFile(file);
						record.file = file;
						update(record, { fileName: file.name, byteLength: file.size });
					} else {
						validatePreparedFile(file);
						file = normalizeDirectUploadFile(file);
						record.file = file;
					}
					abort.signal.throwIfAborted();
					update(record, { status: 'uploading', errorMessage: undefined });
					const result = await runtime.upload(file, abort.signal);
					abort.signal.throwIfAborted();
					update(record, { status: 'ready-to-publish', uploadFilename: result.uploadFilename });
				} catch (error) {
					update(record, {
						status: abort.signal.aborted ? 'cancelled' : 'failed',
						errorMessage: errorMessage(error, 'Freesound could not upload this audio.'),
					});
				} finally {
					record.abort = undefined;
				}
			}
		} finally {
			active = false;
			publishSnapshot();
		}
	};

	function update(record: QueueRecord, changes: Partial<FreesoundUploadItem>): void {
		const next: Record<string, unknown> = { ...record.item, ...changes };
		for (const [key, value] of Object.entries(next)) if (value === undefined) delete next[key];
		record.item = Object.freeze(next) as unknown as FreesoundUploadItem;
		publishSnapshot();
	}

	function publishSnapshot(): void {
		snapshot = freezeSnapshot(active, records);
		for (const listener of listeners) listener();
	}

	return Object.freeze({
		getSnapshot: () => snapshot,
		subscribe: (listener: () => void) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		enqueueFiles: (files: readonly File[]) => {
			assertQueueCapacity(records.length, files.length);
			for (const file of files) validateInputFile(file);
			const ids = files.map((file) => {
				const id = createId();
				const defaults = createFreesoundUploadMetadataDefaults({ fileName: file.name });
				records.push({
					file,
					licenseAnalysis: defaults,
					item: Object.freeze({
						id, sourceKind: 'file', fileName: file.name, byteLength: file.size,
						status: 'queued', title: defaults.title, description: defaults.description,
						tags: defaults.tags, license: defaults.license,
						allowedLicenses: defaults.allowedLicenses,
						attributionText: defaults.attributionText,
						blockedReason: defaults.blockedReason,
						requiresRightsConfirmation: defaults.requiresRightsConfirmation,
					}),
				});
				return id;
			});
			publishSnapshot();
			void pump();
			return Object.freeze(ids);
		},
		enqueueClip: (reference: FreesoundClipUploadReference) => {
			if (!reference.projectId || !reference.clipId) throw new TypeError('A valid project clip is required.');
			const duplicate = records.find(({ clip }) => clip?.projectId === reference.projectId
				&& clip.clipId === reference.clipId);
			if (duplicate) return duplicate.item.id;
			assertQueueCapacity(records.length, 1);
			const id = createId();
			const defaults = createFreesoundUploadMetadataDefaults({
				fileName: `${reference.clipTitle || 'Audio clip'}.wav`,
				clip: { title: reference.clipTitle },
			});
			records.push({
				clip: Object.freeze({ ...reference }),
				licenseAnalysis: defaults,
				item: Object.freeze({
					id, sourceKind: 'clip', fileName: reference.clipTitle || 'Audio clip', byteLength: 0,
					status: 'queued', title: reference.clipTitle || 'Audio clip', description: '',
					tags: defaults.tags, license: defaults.license,
					allowedLicenses: defaults.allowedLicenses,
					attributionText: defaults.attributionText,
					blockedReason: defaults.blockedReason,
					requiresRightsConfirmation: defaults.requiresRightsConfirmation,
				}),
			});
			publishSnapshot();
			void pump();
			return id;
		},
		publish,
		retry: (id: string) => {
			const record = findRecord(records, id);
			if (!['failed', 'cancelled'].includes(record.item.status)) return;
			update(record, { status: 'queued', errorMessage: undefined });
			void pump();
		},
		cancel: (id: string) => {
			const record = findRecord(records, id);
			if (record.abort) record.abort.abort();
			else if (record.item.status === 'queued') update(record, { status: 'cancelled' });
		},
		remove: (id: string) => {
			const index = records.findIndex(({ item }) => item.id === id);
			if (index < 0) return;
			const record = records[index]!;
			if (record.abort || ['preparing', 'uploading', 'publishing'].includes(record.item.status)) {
				throw new Error('Cancel the active upload before removing it.');
			}
			records.splice(index, 1);
			publishSnapshot();
		},
		restorePending: (items: readonly FreesoundPendingUpload[]) => {
			for (const pending of items) {
				if (records.some(({ item }) => item.uploadFilename === pending.uploadFilename)) continue;
				assertQueueCapacity(records.length, 1);
				const awaitingDescription = pending.status === 'pending_description';
				const defaults = createFreesoundUploadMetadataDefaults({ fileName: pending.uploadFilename });
				records.push({ licenseAnalysis: defaults, item: Object.freeze({
					id: createId(),
					sourceKind: 'remote',
					fileName: pending.name || pending.uploadFilename,
					byteLength: 0,
					status: awaitingDescription ? 'ready-to-publish' : 'submitted',
					title: normalizedTitle(pending.name || '', pending.uploadFilename),
					description: pending.description ?? '',
					tags: Object.freeze([...(pending.tags ?? defaults.tags)]),
					license: defaults.license,
					allowedLicenses: defaults.allowedLicenses,
					attributionText: defaults.attributionText,
					blockedReason: defaults.blockedReason,
					requiresRightsConfirmation: defaults.requiresRightsConfirmation,
					uploadFilename: pending.uploadFilename,
					remoteStatus: pending.status,
					...(pending.soundId ? { soundId: pending.soundId } : {}),
					...(pending.soundUrl ? { soundUrl: pending.soundUrl } : {}),
				}) });
			}
			publishSnapshot();
		},
		clear: () => {
			for (const record of records) record.abort?.abort();
			records.splice(0);
			publishSnapshot();
		},
	});
}

function validatePublishDraft(
	uploadFilename: string,
	draft: FreesoundPublishDraft,
	licenseAnalysis: FreesoundUploadLicenseAnalysis,
): FreesoundDescribeUploadRequest {
	const validated = validateFreesoundUploadMetadata(draft, { licenseAnalysis });
	return Object.freeze({
		uploadFilename: boundedRequiredText(uploadFilename, 'upload filename', 1024),
		title: validated.title,
		description: validated.description,
		tags: validated.tags,
		categoryId: validated.categoryId,
		license: validated.license,
	});
}

function validateInputFile(file: File): void {
	if (!(file instanceof Blob) || typeof file.name !== 'string' || !file.name) {
		throw new TypeError('A named audio file is required.');
	}
	if (file.size <= 0) throw new RangeError(`${file.name} is empty.`);
	if (!file.type.toLowerCase().startsWith('audio/') && !AUDIO_FILE_EXTENSION.test(file.name)) {
		throw new TypeError(`${file.name} is not a supported audio file.`);
	}
}

function validatePreparedFile(file: File): void {
	validateInputFile(file);
	if (!FREESOUND_DIRECT_EXTENSION.test(file.name)) {
		throw new TypeError('Prepared Freesound audio must be WAV, AIFF, FLAC, OGG, or MP3.');
	}
	if (file.size > MAXIMUM_UPLOAD_BYTES) throw new RangeError(`${file.name} exceeds the 100 MB upload limit.`);
}

/** Supply the exact extension-derived MIME accepted by the authenticated upload proxy. */
function normalizeDirectUploadFile(file: File): File {
	const extension = /\.([^.]+)$/u.exec(file.name)?.[1]?.toLocaleLowerCase('en-US') ?? '';
	const type = FREESOUND_DIRECT_MIME_BY_EXTENSION[
		extension as keyof typeof FREESOUND_DIRECT_MIME_BY_EXTENSION
	];
	if (!type) throw new TypeError('Prepared Freesound audio must be WAV, AIFF, FLAC, OGG, or MP3.');
	return file.type.toLocaleLowerCase('en-US') === type
		? file
		: new File([file], file.name, { type, lastModified: file.lastModified });
}

function assertQueueCapacity(current: number, addition: number): void {
	if (!Number.isSafeInteger(addition) || addition < 1) throw new TypeError('Select one or more audio files.');
	if (current + addition > MAXIMUM_QUEUE_ITEMS) throw new RangeError('The Freesound queue accepts up to 100 items.');
}

function findRecord(records: readonly QueueRecord[], id: string): QueueRecord {
	const record = records.find(({ item }) => item.id === id);
	if (!record) throw new Error('The Freesound upload no longer exists.');
	return record;
}

function freezeSnapshot(active: boolean, records: readonly QueueRecord[]): FreesoundUploadQueueSnapshot {
	return Object.freeze({ active, items: Object.freeze(records.map(({ item }) => item)) });
}

function normalizedTitle(value: string, fileName: string): string {
	const trimmed = value.trim();
	if (trimmed) return trimmed.slice(0, 512);
	return fileName.replace(/\.[^.]+$/u, '').trim().slice(0, 512) || 'Untitled audio';
}

function boundedRequiredText(value: unknown, label: string, maximum: number): string {
	if (typeof value !== 'string' || !value.trim()) throw new TypeError(`Set a ${label}.`);
	if (value.length > maximum) throw new RangeError(`The ${label} is too long.`);
	return value.trim();
}

function defaultUploadId(): string {
	return globalThis.crypto?.randomUUID?.() ?? `freesound-upload-${Date.now().toString(36)}`;
}

function errorMessage(error: unknown, fallback: string): string {
	if (error instanceof Error && error.message) return error.message;
	return fallback;
}
