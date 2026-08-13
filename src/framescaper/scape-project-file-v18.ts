/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ProjectFeatureRequirementsReport } from '../common/editor/project-feature-requirements.ts';
import type { EditorProjectRuntimeProfile } from '../common/editor/project-runtime-profile.ts';
import {
	awaitScapeReadOperation,
	throwIfScapeAborted,
} from '../common/editor/scape-abort.ts';
import type { ScapeArchiveLimits } from '../common/editor/scape-archive-envelope.ts';
import type {
	ScapeArchiveByteSourceReaderFactory,
	ScapeArchiveReaderFactory,
} from '../common/editor/scape-archive-reader.ts';
import type { ScapeProjectInput } from '../common/editor/scape-project-input.ts';
import { withScapeProjectInput } from '../common/editor/scape-project-input.ts';
import {
	createFramescaperProjectFeatureCompatibilityServiceV18,
} from './editor-project-feature-requirements-v18.ts';
import { assertFramescaperProjectV18Profile } from './editor-project-v18-profile.ts';
import {
	loadFramescaperProjectV18,
	type FramescaperProjectV18,
} from './editor-project-v18.ts';
import {
	readFramescaperScapeFileEnvelopeV18,
	type FramescaperScapeManifestV18,
} from './scape-project-file-envelope-v18.ts';
import {
	exportFramescaperScapeProjectFileV18,
	type FramescaperScapeFileExportOptionsV18,
	type FramescaperScapeFileExportResultV18,
	type FramescaperScapeFileExportStoreV18,
} from './scape-project-file-export-v18.ts';
import { FramescaperScapeCanonicalImportV18 } from './scape-project-file-import-v18.ts';
import {
	FramescaperScapeArchiveV18,
	type FramescaperScapeArchiveImportResultV18,
	type FramescaperScapeArchivePublicationRequestV18,
} from './scape-project-preservation-v18.ts';

export interface FramescaperScapeProjectInspectionV18 {
	readonly id: string;
	readonly title: string;
	readonly schemaVersion: 18;
	readonly readOnly: boolean;
	readonly exists: boolean;
	readonly manifest: FramescaperScapeManifestV18;
	readonly featureRequirementsCompatibility: ProjectFeatureRequirementsReport | null;
}

export interface FramescaperScapeProjectFileImportOptionsV18 {
	readonly decision: 'continue' | 'cancel';
	readonly operationId: string;
	readonly publication: FramescaperScapeArchivePublicationRequestV18;
	readonly signal?: AbortSignal;
	readonly archiveLimits?: Partial<ScapeArchiveLimits>;
	readonly archiveReaderFactory?: ScapeArchiveReaderFactory;
	readonly archiveByteSourceReaderFactory?: ScapeArchiveByteSourceReaderFactory;
}

export interface FramescaperScapeProjectFileImportResultV18 {
	readonly status: 'cancelled' | 'published' | 'stale';
	readonly formatVersion: 1 | 2;
	readonly project: FramescaperProjectV18;
	readonly publicationMode: 'create' | 'copy' | 'compare-and-swap' | null;
	readonly publicationOwner: 'framescaper-v18-archive' | null;
	readonly canonicalStage: 'not-requested' | 'staged';
}

export interface FramescaperScapeProjectFileV18Dependencies {
	readonly archive: FramescaperScapeArchiveV18;
	readonly store: FramescaperScapeFileExportStoreV18;
}

interface InspectorStore {
	loadProject?(
		projectId: string,
		options?: Readonly<{ signal?: AbortSignal }>,
	): PromiseLike<unknown> | unknown;
}

interface InspectorRetention {
	retain(settlement: PromiseLike<unknown>): void;
}

type InspectorOptions = Readonly<Record<string, unknown>> & Readonly<{
	signal: AbortSignal;
	archiveLimits?: Partial<ScapeArchiveLimits>;
	archiveReaderFactory?: ScapeArchiveReaderFactory;
	archiveByteSourceReaderFactory?: ScapeArchiveByteSourceReaderFactory;
}>;

/** Product-owned V18 file codec. Dormant until the V18 runtime selector composes it. */
export class FramescaperScapeProjectFileV18 {
	readonly #profile: EditorProjectRuntimeProfile;
	readonly #archive: FramescaperScapeArchiveV18;
	readonly #store: FramescaperScapeFileExportStoreV18;
	readonly #compatibility: ReturnType<typeof createFramescaperProjectFeatureCompatibilityServiceV18>;

	constructor(
		profile: EditorProjectRuntimeProfile | unknown,
		dependenciesValue: FramescaperScapeProjectFileV18Dependencies | unknown,
	) {
		assertFramescaperProjectV18Profile(profile);
		const dependencies = dependenciesRecord(dependenciesValue);
		if (!(dependencies.archive instanceof FramescaperScapeArchiveV18)) {
			throw new TypeError('The exact Framescaper V18 archive authority is required.');
		}
		dependencies.archive.assertComposition(profile, dependencies.store);
		this.#profile = profile;
		this.#archive = dependencies.archive;
		this.#store = dependencies.store;
		this.#compatibility = createFramescaperProjectFeatureCompatibilityServiceV18(profile);
	}

	readonly inspectScapeProject = async (
		input: ScapeProjectInput,
		store: InspectorStore | null,
		options: InspectorOptions,
		retention: InspectorRetention,
	): Promise<Readonly<FramescaperScapeProjectInspectionV18>> => {
		const signal = abortSignal(options.signal);
		const envelope = await this.#readEnvelope(input, options, signal);
		const loaded = loadFramescaperProjectV18(this.#profile, envelope.project);
		const compatibility = this.#compatibility.evaluate(envelope.project);
		const existing = store?.loadProject
			? await awaitScapeReadOperation(() => {
				const lookup = Promise.resolve(store.loadProject!(
					envelope.project.id,
					{ signal },
				));
				retention.retain(lookup);
				return lookup;
			}, signal)
			: null;
		return Object.freeze({
			id: envelope.project.id,
			title: envelope.project.title,
			schemaVersion: 18,
			readOnly: loaded.readOnly,
			exists: Boolean(existing),
			manifest: envelope.manifest,
			featureRequirementsCompatibility: compatibility,
		});
	};

	readonly importProject = async (
		input: ScapeProjectInput,
		options: FramescaperScapeProjectFileImportOptionsV18,
	): Promise<Readonly<FramescaperScapeProjectFileImportResultV18>> => {
		const signal = optionalAbortSignal(options?.signal);
		const decision = importDecision(options?.decision);
		return withScapeProjectInput(input, signal, async (inputEntries) => {
			const envelope = await readFramescaperScapeFileEnvelopeV18(
				this.#profile,
				inputEntries,
				options.archiveLimits ?? {},
				signal,
			);
			const archiveRequest = Object.freeze({
				manifest: envelope.manifest,
				project: envelope.project,
				decision,
				entries: envelope.entries,
				operationId: options.operationId,
				publication: options.publication,
				...(signal ? { signal } : {}),
			});
			if (decision === 'cancel') {
				const cancelled = await this.#archive.importProject(archiveRequest);
				return fileResult(cancelled, null, 'not-requested');
			}
			const operationId = operationIdentifier(options.operationId);
			const publication = publicationRequest(options.publication);
			const context = Object.freeze({
				manifest: envelope.manifest,
				project: envelope.project,
				entryByName: envelope.entryByName,
				expandedByteBudget: envelope.expandedByteBudget,
				publication,
				...(signal ? { signal } : {}),
			});
			const canonical = new FramescaperScapeCanonicalImportV18(this.#profile, this.#store);
			try {
				await canonical.stage(context);
				throwIfScapeAborted(signal);
				const published = await this.#archive.importProject({
					...archiveRequest, operationId, publication,
				});
				if (published.status === 'stale') await canonical.discard();
				else canonical.complete();
				return fileResult(published, 'framescaper-v18-archive', 'staged');
			} catch (error) {
				return canonical.rollback(error);
			}
		}, {
			blob: options.archiveReaderFactory,
			byteSource: options.archiveByteSourceReaderFactory,
		});
	};

	readonly exportProject = (
		project: unknown,
		options: FramescaperScapeFileExportOptionsV18 = {},
	): Promise<Readonly<FramescaperScapeFileExportResultV18>> => (
		exportFramescaperScapeProjectFileV18(
			this.#profile,
			project,
			this.#store,
			this.#archive,
			options,
		)
	);

	async #readEnvelope(
		input: ScapeProjectInput,
		options: InspectorOptions,
		signal: AbortSignal,
	) {
		return withScapeProjectInput(input, signal, (entries) => (
			readFramescaperScapeFileEnvelopeV18(
				this.#profile, entries, options.archiveLimits ?? {}, signal,
			)
		), {
			blob: options.archiveReaderFactory,
			byteSource: options.archiveByteSourceReaderFactory,
		});
	}
}

function fileResult(
	result: Readonly<FramescaperScapeArchiveImportResultV18>,
	owner: 'framescaper-v18-archive' | null,
	canonicalStageValue: 'not-requested' | 'staged',
): Readonly<FramescaperScapeProjectFileImportResultV18> {
	if (result.status !== 'cancelled' && result.status !== 'published' && result.status !== 'stale') {
		throw new Error('The V18 file adapter received an incomplete archive publication.');
	}
	return Object.freeze({
		status: result.status,
		formatVersion: result.formatVersion,
		project: result.project,
		publicationMode: result.publicationMode,
		publicationOwner: result.status === 'cancelled' ? null : owner,
		canonicalStage: canonicalStageValue,
	});
}

function dependenciesRecord(value: unknown): FramescaperScapeProjectFileV18Dependencies {
	const raw = closedRecord(value, ['archive', 'store'], 'Framescaper V18 Scape file dependencies');
	return raw as unknown as FramescaperScapeProjectFileV18Dependencies;
}

function publicationRequest(value: unknown): FramescaperScapeArchivePublicationRequestV18 {
	const raw = record(value, 'V18 Scape publication request');
	if (raw.mode === 'create') closedKeys(raw, ['mode'], 'V18 Scape create request');
	else if (raw.mode === 'copy') closedKeys(raw, ['mode', 'project'], 'V18 Scape copy request');
	else if (raw.mode === 'compare-and-swap') {
		closedKeys(raw, ['mode', 'expected', 'project'], 'V18 Scape replacement request');
	} else throw new TypeError('A supported V18 Scape publication mode is required.');
	return value as FramescaperScapeArchivePublicationRequestV18;
}

function operationIdentifier(value: unknown): string {
	if (typeof value !== 'string' || !value.trim() || value.length > 512) {
		throw new TypeError('A bounded V18 Scape operation ID is required.');
	}
	return value;
}

function importDecision(value: unknown): 'continue' | 'cancel' {
	if (value !== 'continue' && value !== 'cancel') throw new RangeError('A V18 Scape import decision is required.');
	return value;
}

function abortSignal(value: unknown): AbortSignal {
	if (!(value instanceof AbortSignal)) throw new TypeError('A V18 Scape inspection AbortSignal is required.');
	return value;
}

function optionalAbortSignal(value: unknown): AbortSignal | undefined {
	if (value === undefined) return undefined;
	return abortSignal(value);
}

function closedRecord(value: unknown, fields: readonly string[], label: string): Record<string, unknown> {
	const raw = record(value, label);
	closedKeys(raw, fields, label);
	return raw;
}

function closedKeys(raw: Record<string, unknown>, fields: readonly string[], label: string): void {
	const keys = Reflect.ownKeys(raw);
	if (keys.length !== fields.length || keys.some((key) => typeof key !== 'string' || !fields.includes(key))) {
		throw new TypeError(`${label} has unsupported fields.`);
	}
	for (const field of fields) {
		const descriptor = Object.getOwnPropertyDescriptor(raw, field);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`${label} ${field} must be an own enumerable data property.`);
		}
	}
}

function record(value: unknown, label: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
		throw new TypeError(`${label} must be a plain record.`);
	}
	return value as Record<string, unknown>;
}
