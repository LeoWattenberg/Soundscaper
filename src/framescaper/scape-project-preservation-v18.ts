/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	editorProjectRuntimeProfileDefinition,
	type EditorProjectRuntimeProfile,
} from '../common/editor/project-runtime-profile.ts';
import {
	editorProjectRuntimeProfilePrerequisiteDefinition,
} from '../common/editor/project-runtime-profile-prerequisite.ts';
import { isStrictlyHigherProjectRevision } from '../common/editor/project-revision-cas.ts';
import { throwIfScapeAborted } from '../common/editor/scape-abort.ts';
import type { ScapeArchiveEntry } from '../common/editor/scape-archive-envelope.ts';
import {
	planScapeVideoProxyArchiveAssetsV2,
	type ScapeVideoProxyArchiveAssetDescriptorV2,
} from '../common/editor/scape-video-proxy-archive-plan-v2.ts';
import {
	canonicalMediaContentBlob,
} from '../common/editor/storage/media-content-digest.ts';
import type {
	OwnedMediaAssetPublication,
	OwnedMediaAssetWriter,
} from '../common/editor/storage/media-asset-write-contract.ts';
import type { OpfsRepository } from '../common/editor/storage/opfs-repository.ts';
import {
	assertEditorProjectStoreProfile,
} from '../common/editor/storage/project-store-profile-binding.ts';
import { editorProjectStorageProfileNames } from '../common/editor/storage/project-storage-profile.ts';
import type { StorageRepositoryPort } from '../common/editor/storage/repository-port.ts';
import {
	VideoProxyClaimRepository,
} from '../common/editor/storage/video-proxy-claim-repository.ts';
import {
	VideoProxyClaimStagingRepository,
} from '../common/editor/storage/video-proxy-claim-staging-repository.ts';
import {
	type VideoTimingAssetReference,
} from '../common/editor/video-timing-asset.ts';
import {
	FramescaperProjectV18ArchiveRepository,
	type FramescaperProjectV18ArchivePreservationPlan,
	type FramescaperProjectV18ArchivePublicationMode,
} from './editor-project-v18-archive-repository.ts';
import { assertFramescaperProjectV18Profile } from './editor-project-v18-profile.ts';
import {
	framescaperProjectFingerprintV18,
} from './editor-project-v18-preservation-repository.ts';
import {
	cloneFramescaperProjectV18,
	type FramescaperProjectV18,
} from './editor-project-v18.ts';
import {
	inspectFramescaperScapeProjectEnvelopeV18,
	type FramescaperScapeEnvelopeDecisionV18,
} from './scape-project-envelope-v18.ts';
import {
	assertFramescaperScapeOwnedWriterV18,
	assertFramescaperScapePreservedAttachmentsV18,
	assertFramescaperScapeStoredMetadataV18,
	extractFramescaperScapeBodyV18,
	framescaperScapeAttachmentInventoryV18,
	framescaperScapeOperationIdentifierV18,
	framescaperScapeProjectIdentifierV18,
	framescaperScapeProjectRevisionV18,
	framescaperScapeSourceOperationIdV18,
	indexFramescaperScapeBodyEntriesV18,
	verifyFramescaperScapeStoredBodyV18,
} from './scape-project-preservation-v18-support.ts';

export interface FramescaperScapeArchiveBodyStoreV18 {
	readonly databaseName: string;
	readonly memory: unknown;
	readonly opfsRepository: OpfsRepository;
	getMediaAssetMetadata(sourceId: string): PromiseLike<unknown> | unknown;
	loadMediaAsset(sourceId: string, options?: Readonly<{ signal?: AbortSignal }>): PromiseLike<unknown> | unknown;
	beginMediaAssetWrite(
		sourceId: string,
		metadata: Readonly<Record<string, unknown>>,
		options: Readonly<{ expectedBytes: number; expectedSha256: string; signal?: AbortSignal }>,
	): PromiseLike<OwnedMediaAssetWriter> | OwnedMediaAssetWriter;
}

export interface FramescaperScapeArchiveV18Dependencies {
	readonly store: FramescaperScapeArchiveBodyStoreV18;
	readonly port: StorageRepositoryPort;
	readonly opfs: OpfsRepository;
	readonly now?: () => number;
	readonly createGeneration?: () => string;
}

export interface FramescaperScapeArchiveExportAssetV18 {
	readonly descriptor: Readonly<ScapeVideoProxyArchiveAssetDescriptorV2>;
	readonly body: Blob;
}

export interface FramescaperScapeArchiveExportV18 {
	readonly formatVersion: 1 | 2;
	readonly assets: readonly Readonly<FramescaperScapeArchiveExportAssetV18>[];
}

export type FramescaperScapeArchivePublicationRequestV18 =
	| Readonly<{ readonly mode: 'create' }>
	| Readonly<{ readonly mode: 'copy'; readonly project: unknown }>
	| Readonly<{
		readonly mode: 'compare-and-swap';
		readonly expected: unknown;
		readonly project: unknown;
	}>;

export interface FramescaperScapeArchiveDocumentPublicationV18 {
	readonly mode: FramescaperProjectV18ArchivePublicationMode;
	readonly expected: FramescaperProjectV18 | null;
	readonly project: FramescaperProjectV18;
}

export interface FramescaperScapeArchiveDocumentPublisherV18 {
	publish(
		publication: Readonly<FramescaperScapeArchiveDocumentPublicationV18>,
	): Promise<FramescaperProjectV18 | null>;
}

export interface FramescaperScapeArchiveImportRequestV18 {
	readonly manifest: unknown;
	readonly project: unknown;
	readonly decision: FramescaperScapeEnvelopeDecisionV18;
	readonly entries: readonly ScapeArchiveEntry[];
	readonly operationId: string;
	readonly publication: FramescaperScapeArchivePublicationRequestV18;
	readonly signal?: AbortSignal;
	readonly publisher?: Readonly<FramescaperScapeArchiveDocumentPublisherV18>;
}

export interface FramescaperScapeArchiveImportResultV18 {
	readonly status: 'cancelled' | 'metadata-only' | 'published' | 'stale';
	readonly formatVersion: 1 | 2;
	readonly project: FramescaperProjectV18;
	readonly publicationMode: FramescaperProjectV18ArchivePublicationMode | null;
}

interface TargetPublication {
	readonly mode: FramescaperProjectV18ArchivePublicationMode;
	readonly expected: FramescaperProjectV18 | null;
	readonly project: FramescaperProjectV18;
}

const DEPENDENCY_REQUIRED_FIELDS = ['store', 'port', 'opfs'] as const;
const DEPENDENCY_OPTIONAL_FIELDS = ['now', 'createGeneration'] as const;
const IMPORT_REQUIRED_FIELDS = [
	'manifest', 'project', 'decision', 'entries', 'operationId', 'publication',
] as const;
const IMPORT_OPTIONAL_FIELDS = ['signal', 'publisher'] as const;
const TIMING_MIME_TYPE = 'application/vnd.soundscaper.video-timing';
const DOCUMENT_PUBLISHERS = new WeakMap<object, FramescaperScapeArchiveV18>();

/** Dormant format-2 proxy/timing body owner. V17 archive code never imports it. */
export class FramescaperScapeArchiveV18 {
	readonly #profile: EditorProjectRuntimeProfile;
	readonly #store: FramescaperScapeArchiveBodyStoreV18;
	readonly #port: StorageRepositoryPort;
	readonly #claims: VideoProxyClaimRepository;
	readonly #claimStaging: VideoProxyClaimStagingRepository;
	readonly #repository: FramescaperProjectV18ArchiveRepository;
	readonly #databaseName: string;

	constructor(
		profile: EditorProjectRuntimeProfile | unknown,
		dependenciesValue: FramescaperScapeArchiveV18Dependencies | unknown,
	) {
		assertFramescaperProjectV18Profile(profile);
		const dependencies = allowedRecord(
			dependenciesValue,
			DEPENDENCY_REQUIRED_FIELDS,
			DEPENDENCY_OPTIONAL_FIELDS,
			'Framescaper V18 Scape dependencies',
		);
		const runtime = editorProjectRuntimeProfileDefinition(profile);
		const prerequisite = editorProjectRuntimeProfilePrerequisiteDefinition(runtime.prerequisite);
		const names = editorProjectStorageProfileNames(prerequisite.storageProfile);
		assertEditorProjectStoreProfile(dependencies.store, prerequisite.storageProfile);
		const store = dependencies.store as FramescaperScapeArchiveBodyStoreV18;
		const port = dependencies.port as StorageRepositoryPort;
		const opfs = dependencies.opfs as OpfsRepository;
		if (ownData(store, 'databaseName') !== names.databaseName
			|| ownData(store, 'memory') !== ownData(port, 'memory')
			|| ownData(store, 'opfsRepository') !== opfs
			|| typeof ownData(port, 'database') !== 'function') {
			throw new TypeError('The exact isolated Framescaper V18 store authority is required.');
		}
		for (const method of ['getMediaAssetMetadata', 'loadMediaAsset', 'beginMediaAssetWrite'] as const) {
			if (typeof store[method] !== 'function') throw new TypeError('A complete V18 archive body store is required.');
		}
		if (!opfs || typeof opfs !== 'object') throw new TypeError('The exact V18 OPFS repository is required.');
		const now = dependencies.now === undefined ? undefined : clockValue(dependencies.now);
		const createGeneration = dependencies.createGeneration === undefined
			? undefined
			: generationValue(dependencies.createGeneration);
		this.#profile = profile;
		this.#store = store;
		this.#port = port;
		this.#databaseName = names.databaseName;
		this.#claims = new VideoProxyClaimRepository(port, { now });
		this.#claimStaging = new VideoProxyClaimStagingRepository(port, opfs, { now, createGeneration });
		this.#repository = new FramescaperProjectV18ArchiveRepository(profile, {
			port, claims: this.#claims,
		});
	}

	/** Authenticate product-level composition without exposing either private authority. */
	assertComposition(
		profile: EditorProjectRuntimeProfile | unknown,
		store: FramescaperScapeArchiveBodyStoreV18 | unknown,
		publisher: Readonly<FramescaperScapeArchiveDocumentPublisherV18> | unknown = null,
	): void {
		assertFramescaperProjectV18Profile(profile);
		if (profile !== this.#profile || store !== this.#store
			|| (publisher !== null && DOCUMENT_PUBLISHERS.get(publisher as object) !== this)) {
			throw new TypeError('The exact V18 archive composition is required.');
		}
	}

	/**
	 * Admit one external owner for imported documents. Bodies keep landing in this
	 * archive's isolated V18 store, so only the document publication moves and the
	 * catalog that owns the destination stays the single publication act.
	 */
	admitDocumentPublisher(
		profile: EditorProjectRuntimeProfile | unknown,
		store: FramescaperScapeArchiveBodyStoreV18 | unknown,
		publish: (publication: Readonly<FramescaperScapeArchiveDocumentPublicationV18>) => unknown,
	): Readonly<FramescaperScapeArchiveDocumentPublisherV18> {
		this.assertComposition(profile, store);
		if (typeof publish !== 'function') {
			throw new TypeError('A V18 archive document publisher must be a function.');
		}
		const publisher = Object.freeze({
			publish: async (publication: Readonly<FramescaperScapeArchiveDocumentPublicationV18>) => {
				const published = await publish(publication);
				return published === null || published === undefined
					? null
					: cloneFramescaperProjectV18(this.#profile, published);
			},
		});
		DOCUMENT_PUBLISHERS.set(publisher, this);
		return publisher;
	}

	async exportProject(
		projectValue: unknown,
		options: Readonly<{ signal?: AbortSignal }> = {},
	): Promise<Readonly<FramescaperScapeArchiveExportV18>> {
		const project = cloneFramescaperProjectV18(this.#profile, projectValue);
		throwIfScapeAborted(options.signal);
		const inventory = framescaperScapeAttachmentInventoryV18(project);
		const plan = planScapeVideoProxyArchiveAssetsV2(inventory.references);
		if (plan.formatVersion === 1) return Object.freeze({ formatVersion: 1, assets: Object.freeze([]) });
		const assets: Readonly<FramescaperScapeArchiveExportAssetV18>[] = [];
		for (const descriptor of plan.assets) {
			throwIfScapeAborted(options.signal);
			const metadata = await this.#store.getMediaAssetMetadata(descriptor.sourceId);
			assertFramescaperScapeStoredMetadataV18(metadata, descriptor);
			const loaded = await this.#store.loadMediaAsset(
				descriptor.sourceId,
				options.signal ? { signal: options.signal } : {},
			);
			const body = canonicalMediaContentBlob(loaded);
			await verifyFramescaperScapeStoredBodyV18(body, descriptor, inventory.timingByStorageKey, options.signal);
			assets.push(Object.freeze({ descriptor, body }));
		}
		return Object.freeze({ formatVersion: 2, assets: Object.freeze(assets) });
	}

	async importProject(
		requestValue: FramescaperScapeArchiveImportRequestV18 | unknown,
	): Promise<Readonly<FramescaperScapeArchiveImportResultV18>> {
		const raw = allowedRecord(
			requestValue,
			IMPORT_REQUIRED_FIELDS,
			IMPORT_OPTIONAL_FIELDS,
			'Framescaper V18 Scape import request',
		);
		const signal = raw.signal === undefined ? undefined : abortSignal(raw.signal);
		const publisher = raw.publisher === undefined ? null : this.#admittedPublisher(raw.publisher);
		const inspection = inspectFramescaperScapeProjectEnvelopeV18(
			this.#profile,
			raw.manifest,
			raw.project,
			raw.decision as FramescaperScapeEnvelopeDecisionV18,
		);
		const origin = cloneFramescaperProjectV18(this.#profile, inspection.project);
		if (inspection.status === 'cancelled') {
			return importResult('cancelled', inspection.formatVersion, origin, null);
		}
		const operationId = framescaperScapeOperationIdentifierV18(raw.operationId);
		const target = normalizeTarget(this.#profile, origin, raw.publication);
		if (inspection.formatVersion === 1) {
			throwIfScapeAborted(signal);
			await this.#assertDurableStore();
			return this.#publishDocument(publisher, 1, origin, target, Object.freeze([]));
		}
		const entries = indexFramescaperScapeBodyEntriesV18(raw.entries, inspection.proxyAssets);
		throwIfScapeAborted(signal);
		await this.#assertDurableStore();
		throwIfScapeAborted(signal);
		const targetInventory = framescaperScapeAttachmentInventoryV18(target.project);
		const newPublications: OwnedMediaAssetPublication[] = [];
		let verifiedClaimCount = 0;
		try {
			for (const descriptor of inspection.proxyAssets) {
				const entry = entries.get(descriptor.entry)!;
				const created = await this.#stageBody(
					descriptor,
					entry,
					targetInventory.timingByStorageKey,
					signal,
				);
				if (created) newPublications.push(created);
			}

			if (publisher === null) {
				const fingerprint = framescaperProjectFingerprintV18(this.#profile, origin);
				const plans: FramescaperProjectV18ArchivePreservationPlan[] = [];
				for (const [index, source] of targetInventory.attached.entries()) {
					const claimOperationId = framescaperScapeSourceOperationIdV18(operationId, index);
					const proxy = await this.#claimStaging.createVerifiedClaim({
						operationId: claimOperationId,
						projectId: framescaperScapeProjectIdentifierV18(target.project),
						sourceId: source.sourceId,
						baseFingerprint: fingerprint,
						bodyKind: 'proxy',
						bodyKey: source.attachment.storageKey,
						byteLength: source.attachment.byteLength,
						mimeType: source.attachment.mimeType,
					}, signal ? { signal } : {});
					verifiedClaimCount += 1;
					const timing = await this.#claimStaging.createVerifiedClaim({
						operationId: claimOperationId,
						projectId: framescaperScapeProjectIdentifierV18(target.project),
						sourceId: source.sourceId,
						baseFingerprint: fingerprint,
						bodyKind: 'timing',
						bodyKey: source.attachment.timingAsset.storageKey,
						byteLength: source.attachment.timingAsset.byteLength,
						mimeType: TIMING_MIME_TYPE,
					}, signal ? { signal } : {});
					verifiedClaimCount += 1;
					const plan = await this.#claims.preparePreservationPlan({
						operationId: claimOperationId,
						projectId: framescaperScapeProjectIdentifierV18(target.project),
						sourceId: source.sourceId,
						baseFingerprint: fingerprint,
						proxyClaimKey: proxy.key,
						timingClaimKey: timing.key,
					});
					plans.push(Object.freeze({ sourceId: source.sourceId, plan }));
				}
				throwIfScapeAborted(signal);
				return await this.#publishDocument(null, 2, origin, target, plans);
			}
			throwIfScapeAborted(signal);
		} catch (error) {
			if (verifiedClaimCount > 0) throw error;
			const cleanupErrors: unknown[] = [];
			for (const publication of [...newPublications].reverse()) {
				try { await publication.discardIfCurrent(); } catch (cleanupError) { cleanupErrors.push(cleanupError); }
			}
			if (cleanupErrors.length) {
				throw new AggregateError(
					[error, ...cleanupErrors],
					'V18 archive body staging and cleanup both failed.',
					{ cause: error },
				);
			}
			throw error;
		}
		// The delegate reconciles this shadow through its own import, so the staged
		// bodies must outlive a refused or indeterminate external publication.
		return this.#publishDocument(publisher, 2, origin, target, Object.freeze([]));
	}

	async #publishDocument(
		publisher: Readonly<FramescaperScapeArchiveDocumentPublisherV18> | null,
		formatVersion: 1 | 2,
		origin: FramescaperProjectV18,
		target: TargetPublication,
		plans: readonly Readonly<FramescaperProjectV18ArchivePreservationPlan>[],
	): Promise<Readonly<FramescaperScapeArchiveImportResultV18>> {
		const published = publisher === null
			? await this.#repository.publish({
				mode: target.mode,
				origin,
				expected: target.expected,
				project: target.project,
				plans,
			})
			: await publisher.publish({
				mode: target.mode,
				expected: target.expected,
				project: target.project,
			});
		return published
			? importResult('published', formatVersion, published, target.mode)
			: importResult('stale', formatVersion, target.project, target.mode);
	}

	#admittedPublisher(value: unknown): Readonly<FramescaperScapeArchiveDocumentPublisherV18> {
		if (DOCUMENT_PUBLISHERS.get(value as object) !== this) {
			throw new TypeError('The exact admitted V18 archive document publisher is required.');
		}
		return value as Readonly<FramescaperScapeArchiveDocumentPublisherV18>;
	}

	async #assertDurableStore(): Promise<void> {
		const database = await this.#port.database();
		if (!database || database.name !== this.#databaseName) {
			throw new Error('The exact durable Framescaper V18 archive database is required.');
		}
	}

	async #stageBody(
		descriptor: Readonly<ScapeVideoProxyArchiveAssetDescriptorV2>,
		entry: ScapeArchiveEntry,
		timingByStorageKey: ReadonlyMap<string, Readonly<VideoTimingAssetReference>>,
		signal?: AbortSignal,
	): Promise<OwnedMediaAssetPublication | null> {
		const existing = await this.#store.getMediaAssetMetadata(descriptor.sourceId);
		if (existing !== null && existing !== undefined) {
			assertFramescaperScapeStoredMetadataV18(existing, descriptor);
			await extractFramescaperScapeBodyV18(entry, descriptor, timingByStorageKey, undefined, signal);
			return null;
		}
		const timing = timingByStorageKey.get(descriptor.sourceId);
		const writer = await this.#store.beginMediaAssetWrite(descriptor.sourceId, {
			name: descriptor.entry,
			kind: descriptor.kind,
			encoding: descriptor.encoding,
			mimeType: descriptor.mimeType,
			...(timing ? {
				frameCount: timing.frameCount,
				timescale: timing.timescale,
				finalFrameDurationTicks: timing.finalFrameDurationTicks,
			} : {}),
		}, {
			expectedBytes: descriptor.size,
			expectedSha256: descriptor.sha256,
			...(signal ? { signal } : {}),
		});
		assertFramescaperScapeOwnedWriterV18(writer);
		let publication: OwnedMediaAssetPublication | null = null;
		try {
			await extractFramescaperScapeBodyV18(entry, descriptor, timingByStorageKey, writer, signal);
			publication = await writer.commitOwned(signal ? { signal } : {});
			assertFramescaperScapeStoredMetadataV18(publication.metadata, descriptor);
			return publication;
		} catch (error) {
			try {
				if (publication) await publication.discardIfCurrent();
				else await writer.abort();
			} catch (cleanupError) {
				throw new AggregateError(
					[error, cleanupError],
					'V18 archive body write and cleanup both failed.',
					{ cause: error },
				);
			}
			throw error;
		}
	}
}

function normalizeTarget(
	profile: EditorProjectRuntimeProfile,
	origin: FramescaperProjectV18,
	value: unknown,
): TargetPublication {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('A V18 archive publication request is required.');
	}
	const mode = ownData(value, 'mode');
	if (mode === 'create') {
		assertExactKeys(value, ['mode'], 'archive create request');
		return { mode, expected: null, project: origin };
	}
	if (mode === 'copy') {
		assertExactKeys(value, ['mode', 'project'], 'archive copy request');
		const project = cloneFramescaperProjectV18(profile, ownData(value, 'project'));
		if (framescaperScapeProjectIdentifierV18(project) === framescaperScapeProjectIdentifierV18(origin)
			|| framescaperScapeProjectRevisionV18(project) !== 0) {
			throw new Error('Archive copy requires a fresh project identity at revision 0.');
		}
		assertFramescaperScapePreservedAttachmentsV18(origin, project);
		return { mode, expected: null, project };
	}
	if (mode === 'compare-and-swap') {
		assertExactKeys(value, ['mode', 'expected', 'project'], 'archive replacement request');
		const expected = cloneFramescaperProjectV18(profile, ownData(value, 'expected'));
		const project = cloneFramescaperProjectV18(profile, ownData(value, 'project'));
		const expectedRevision = framescaperScapeProjectRevisionV18(expected);
		if (framescaperScapeProjectIdentifierV18(origin) !== framescaperScapeProjectIdentifierV18(expected)
			|| framescaperScapeProjectIdentifierV18(project) !== framescaperScapeProjectIdentifierV18(expected)
			|| !isStrictlyHigherProjectRevision(
				framescaperScapeProjectRevisionV18(project),
				expectedRevision,
			)) {
			throw new Error('Archive replacement must compare and swap a strictly higher revision.');
		}
		assertFramescaperScapePreservedAttachmentsV18(origin, project);
		return { mode, expected, project };
	}
	throw new TypeError('A supported V18 archive publication mode is required.');
}

function importResult(
	status: FramescaperScapeArchiveImportResultV18['status'],
	formatVersion: 1 | 2,
	project: FramescaperProjectV18,
	publicationMode: FramescaperProjectV18ArchivePublicationMode | null,
): Readonly<FramescaperScapeArchiveImportResultV18> {
	return Object.freeze({ status, formatVersion, project, publicationMode });
}

function abortSignal(value: unknown): AbortSignal {
	if (!(value instanceof AbortSignal)) throw new TypeError('A V18 archive AbortSignal is required.');
	return value;
}

function clockValue(value: unknown): () => number {
	if (typeof value !== 'function') throw new TypeError('The V18 archive clock must be a function.');
	return value as () => number;
}

function generationValue(value: unknown): () => string {
	if (typeof value !== 'function') {
		throw new TypeError('The V18 archive claim generation owner must be a function.');
	}
	return value as () => string;
}

function allowedRecord<const Required extends readonly string[], const Optional extends readonly string[]>(
	value: unknown,
	required: Required,
	optional: Optional,
	name: string,
): Record<Required[number] | Optional[number], unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
		throw new TypeError(`${name} must be a plain record.`);
	}
	const allowed = new Set<string>([...required, ...optional]);
	const keys = Reflect.ownKeys(value);
	if (keys.some((key) => typeof key !== 'string' || !allowed.has(key))) throw new TypeError(`${name} has extra fields.`);
	const output = Object.create(null) as Record<Required[number] | Optional[number], unknown>;
	for (const field of required) output[field as Required[number] | Optional[number]] = ownData(value, field);
	for (const field of optional) {
		if (Object.hasOwn(value, field)) {
			output[field as Required[number] | Optional[number]] = ownData(value, field);
		}
	}
	return output;
}

function assertExactKeys(value: object, fields: readonly string[], name: string): void {
	const keys = Reflect.ownKeys(value);
	if (keys.length !== fields.length || keys.some((key) => typeof key !== 'string' || !fields.includes(key))) {
		throw new TypeError(`${name} has unsupported fields.`);
	}
	for (const field of fields) ownData(value, field);
}

function ownData(value: object, field: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(value, field);
	if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError(`${field} must be an own enumerable data property.`);
	}
	return descriptor.value;
}
