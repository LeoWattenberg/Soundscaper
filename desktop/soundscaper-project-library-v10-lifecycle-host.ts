/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';

import {
	SoundscaperDesktopProjectLibraryV10Catalog,
} from './soundscaper-project-library-v10-catalog.ts';
import {
	validateSoundscaperDesktopCurrentProjectV21,
} from './soundscaper-project-library-v10-current-project.ts';
import {
	validateSoundscaperDesktopProjectLibraryV10CatalogSnapshot,
	validateSoundscaperDesktopProjectLibraryV10DeleteRequest,
	validateSoundscaperDesktopProjectLibraryV10DeleteResult,
	validateSoundscaperDesktopProjectLibraryV10DuplicateRequest,
	type SoundscaperDesktopProjectLibraryV10CatalogSnapshot,
	type SoundscaperDesktopProjectLibraryV10DeleteResult,
	type SoundscaperDesktopProjectLibraryV10DuplicateRequest,
	type SoundscaperDesktopProjectLibraryV10ExpectedProject,
} from './soundscaper-project-library-v10-lifecycle-contract.ts';
import type {
	SoundscaperDesktopLibraryV10Metadata,
	SoundscaperDesktopLibraryV10Project,
} from './soundscaper-project-library-v10-metadata.ts';
import {
	SoundscaperDesktopProjectLibraryV10PublicationHost,
} from './soundscaper-project-library-v10-publication-host.ts';
import {
	validateSoundscaperDesktopProjectLibraryV10LeaseToken,
	type SoundscaperDesktopProjectLibraryV10Lease,
} from './soundscaper-project-library-v10-persistence-codecs.ts';
import {
	createSoundscaperDesktopProjectLibraryV10TransferBodies,
	MAXIMUM_SOUNDSCAPER_V10_TRANSFER_CHUNK_BYTES,
	validateSoundscaperDesktopProjectLibraryV10HostBundle,
	type SoundscaperDesktopProjectLibraryV10TransferBody,
	type SoundscaperDesktopProjectLibraryV10TransferBundle,
} from './soundscaper-project-library-v10-transfer-contract.ts';

const CREATE_FIELDS = ['catalog', 'host', 'lease'] as const;

interface CreateOptions {
	readonly catalog: SoundscaperDesktopProjectLibraryV10Catalog;
	readonly host: SoundscaperDesktopProjectLibraryV10PublicationHost;
	readonly lease: SoundscaperDesktopProjectLibraryV10Lease;
}

/** Main-only exact catalog/delete/duplicate authority for the selected V10 owner. */
export class SoundscaperDesktopProjectLibraryV10LifecycleHost {
	readonly #catalog: SoundscaperDesktopProjectLibraryV10Catalog;
	readonly #host: SoundscaperDesktopProjectLibraryV10PublicationHost;
	#lease: SoundscaperDesktopProjectLibraryV10Lease;

	private constructor(options: CreateOptions) {
		this.#catalog = options.catalog;
		this.#host = options.host;
		this.#lease = options.lease;
	}

	static create(value: unknown): SoundscaperDesktopProjectLibraryV10LifecycleHost {
		const options = closedRecord(value, CREATE_FIELDS, 'Soundscaper V10 lifecycle host');
		if (!(options.catalog instanceof SoundscaperDesktopProjectLibraryV10Catalog)
			|| !(options.host instanceof SoundscaperDesktopProjectLibraryV10PublicationHost)) {
			throw new TypeError('Soundscaper V10 lifecycle requires exact main catalog and publication owners');
		}
		const lease = validateSoundscaperDesktopProjectLibraryV10LeaseToken(
			options.lease as SoundscaperDesktopProjectLibraryV10Lease,
		);
		return Object.freeze(new SoundscaperDesktopProjectLibraryV10LifecycleHost({
			catalog: options.catalog,
			host: options.host,
			lease,
		})) as SoundscaperDesktopProjectLibraryV10LifecycleHost;
	}

	updateLease(value: unknown): void {
		const next = validateSoundscaperDesktopProjectLibraryV10LeaseToken(
			value as SoundscaperDesktopProjectLibraryV10Lease,
		);
		if (next.leaseId !== this.#lease.leaseId || next.fencingToken !== this.#lease.fencingToken
			|| JSON.stringify(next.owner) !== JSON.stringify(this.#lease.owner)
			|| next.acquiredAtMs !== this.#lease.acquiredAtMs || next.expiresAtMs < this.#lease.expiresAtMs) {
			throw new Error('Soundscaper V10 lifecycle lease renewal changed its main-owned fence');
		}
		this.#lease = next;
	}

	listProjects(): Readonly<SoundscaperDesktopProjectLibraryV10CatalogSnapshot> {
		const metadata = this.#catalog.readMetadata();
		const projects = metadata.projects.map((project) => Object.freeze({
			id: project.projectId,
			title: project.name,
			revision: project.projectRevision,
			updatedAt: new Date(project.updatedAtMs).toISOString(),
		})).sort((left, right) => (
			right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id)
		));
		return validateSoundscaperDesktopProjectLibraryV10CatalogSnapshot({
			metadataRevision: metadata.revision,
			projects,
		});
	}

	deleteProject(value: unknown): Readonly<SoundscaperDesktopProjectLibraryV10DeleteResult> {
		const request = validateSoundscaperDesktopProjectLibraryV10DeleteRequest(value);
		const metadata = this.#catalog.readMetadata();
		assertMetadataRevision(metadata, request.expectedMetadataRevision);
		const current = exactProject(metadata, request.projectId);
		assertExpectedProject(current, request.expectedProject, 'delete');
		const published = this.#catalog.publishMetadata({
			expectedRevision: request.expectedMetadataRevision,
			lease: this.#lease,
			metadata: {
				schemaVersion: 10,
				revision: increment(request.expectedMetadataRevision, 'metadata revision'),
				projects: metadata.projects.filter(({ projectId }) => projectId !== request.projectId),
				media: metadata.media,
			},
		});
		return validateSoundscaperDesktopProjectLibraryV10DeleteResult({
			projectId: request.projectId,
			metadataRevision: published.revision,
			deleted: true,
		});
	}

	async duplicateProject(
		value: unknown,
		signal?: AbortSignal,
	): Promise<Readonly<SoundscaperDesktopProjectLibraryV10TransferBundle>> {
		const request = validateSoundscaperDesktopProjectLibraryV10DuplicateRequest(value);
		throwIfAborted(signal);
		const metadata = this.#catalog.readMetadata();
		assertMetadataRevision(metadata, request.expectedMetadataRevision);
		const sourceRow = exactProject(metadata, request.sourceProjectId);
		assertExpectedProject(sourceRow, request.expectedSource, 'duplication source');
		if (metadata.projects.some(({ projectId }) => projectId === request.copyProjectId)) {
			throw new Error('Soundscaper V10 project duplication destination already exists');
		}
		const sourceValue = await this.#host.readProjectBundle(request.sourceProjectId, signal);
		if (sourceValue === null) throw new Error('Soundscaper V10 project duplication source is unavailable');
		const source = validateSoundscaperDesktopProjectLibraryV10HostBundle(
			sourceValue,
			request.sourceProjectId,
		);
		if (source.metadataRevision !== request.expectedMetadataRevision
			|| source.project.projectRevision !== request.expectedSource.projectRevision
			|| source.project.sha256 !== request.expectedSource.projectSha256) {
			throw new Error('Soundscaper V10 project duplication source changed before publication');
		}
		const project = duplicateProjectDocument(source.document, request);
		const document = JSON.stringify(project);
		const projectSha256 = createHash('sha256').update(document, 'utf8').digest('hex');
		const bodies = createSoundscaperDesktopProjectLibraryV10TransferBodies(project, projectSha256);
		const sourceBodies = matchSourceBodies(source.bodies, bodies);
		throwIfAborted(signal);
		return this.#host.publish({
			lease: this.#lease,
			expectedMetadataRevision: request.expectedMetadataRevision,
			expectedProject: null,
			project,
			bodies: bodies.map((descriptor, index) => ({
				descriptor,
				chunks: this.#bodyChunks(sourceBodies[index]!, signal),
			})),
		}, signal);
	}

	async *#bodyChunks(
		body: Readonly<SoundscaperDesktopProjectLibraryV10TransferBody>,
		signal?: AbortSignal,
	): AsyncGenerator<Uint8Array> {
		for (let offset = 0; offset < body.byteLength; offset += MAXIMUM_SOUNDSCAPER_V10_TRANSFER_CHUNK_BYTES) {
			throwIfAborted(signal);
			const length = Math.min(MAXIMUM_SOUNDSCAPER_V10_TRANSFER_CHUNK_BYTES, body.byteLength - offset);
			yield await this.#host.readBodyChunk(body, { offset, length, ...(signal ? { signal } : {}) });
		}
	}
}

function duplicateProjectDocument(
	document: string,
	request: Readonly<SoundscaperDesktopProjectLibraryV10DuplicateRequest>,
) {
	const source = validateSoundscaperDesktopCurrentProjectV21(JSON.parse(document) as unknown);
	const project = structuredClone(source) as unknown as Record<string, unknown>;
	project.id = request.copyProjectId;
	project.title = request.title;
	project.revision = 0;
	project.createdAt = request.timestamp;
	project.updatedAt = request.timestamp;
	return validateSoundscaperDesktopCurrentProjectV21(project);
}

function matchSourceBodies(
	source: readonly Readonly<SoundscaperDesktopProjectLibraryV10TransferBody>[],
	destination: readonly Readonly<SoundscaperDesktopProjectLibraryV10TransferBody>[],
): readonly Readonly<SoundscaperDesktopProjectLibraryV10TransferBody>[] {
	return destination.map((body) => {
		const candidates = source.filter((candidate) => sameBodyContent(candidate, body));
		if (candidates.length !== 1) {
			throw new Error('Soundscaper V10 duplication source body ownership is incomplete or ambiguous');
		}
		return candidates[0]!;
	});
}

function sameBodyContent(
	left: Readonly<SoundscaperDesktopProjectLibraryV10TransferBody>,
	right: Readonly<SoundscaperDesktopProjectLibraryV10TransferBody>,
): boolean {
	return left.kind === right.kind && left.encoding === right.encoding
		&& left.sourceId === right.sourceId && left.storageKey === right.storageKey
		&& left.mimeType === right.mimeType && left.byteLength === right.byteLength
		&& left.sha256 === right.sha256;
}

function exactProject(
	metadata: Readonly<SoundscaperDesktopLibraryV10Metadata>,
	projectId: string,
): Readonly<SoundscaperDesktopLibraryV10Project> {
	const matches = metadata.projects.filter((project) => project.projectId === projectId);
	if (matches.length !== 1) throw new Error('Soundscaper V10 current catalog project is unavailable');
	return matches[0]!;
}

function assertExpectedProject(
	project: Readonly<SoundscaperDesktopLibraryV10Project>,
	expected: Readonly<SoundscaperDesktopProjectLibraryV10ExpectedProject>,
	label: string,
): void {
	if (project.projectRevision !== expected.projectRevision || project.sha256 !== expected.projectSha256) {
		throw new Error(`Soundscaper V10 ${label} failed its exact project compare-and-swap`);
	}
}

function assertMetadataRevision(
	metadata: Readonly<SoundscaperDesktopLibraryV10Metadata>,
	expected: number,
): void {
	if (metadata.revision !== expected) {
		throw new Error('Soundscaper V10 metadata revision failed compare-and-swap');
	}
}

function closedRecord<const Field extends string>(value: unknown, fields: readonly Field[], name: string) {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
		throw new TypeError(`${name} must be a plain record`);
	}
	const keys = Reflect.ownKeys(value);
	if (keys.length !== fields.length || keys.some(
		(key) => typeof key !== 'string' || !fields.includes(key as Field),
	)) throw new TypeError(`${name} has missing or unsupported fields`);
	const result = Object.create(null) as Record<Field, unknown>;
	for (const field of fields) {
		const descriptor = Object.getOwnPropertyDescriptor(value, field);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`${name}.${field} must be an own enumerable data property`);
		}
		result[field] = descriptor.value;
	}
	return result;
}

function increment(value: number, label: string): number {
	if (value === Number.MAX_SAFE_INTEGER) throw new RangeError(`Soundscaper V10 ${label} cannot advance`);
	return value + 1;
}

function throwIfAborted(signal?: AbortSignal): void {
	if (signal !== undefined && !(signal instanceof AbortSignal)) {
		throw new TypeError('Soundscaper V10 lifecycle signal is invalid');
	}
	signal?.throwIfAborted();
}
