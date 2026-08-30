/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';

import {
	SoundscaperDesktopProjectLibraryCatalog,
} from './soundscaper-project-library-catalog.ts';
import {
	validateSoundscaperDesktopCurrentProject,
} from './soundscaper-project-library-current-project.ts';
import {
	validateSoundscaperDesktopProjectLibraryCatalogSnapshot,
	validateSoundscaperDesktopProjectLibraryDeleteRequest,
	validateSoundscaperDesktopProjectLibraryDeleteResult,
	validateSoundscaperDesktopProjectLibraryDuplicateRequest,
	type SoundscaperDesktopProjectLibraryCatalogSnapshot,
	type SoundscaperDesktopProjectLibraryDeleteResult,
	type SoundscaperDesktopProjectLibraryDuplicateRequest,
	type SoundscaperDesktopProjectLibraryExpectedProject,
} from './soundscaper-project-library-lifecycle-contract.ts';
import type {
	SoundscaperDesktopLibraryMetadata,
	SoundscaperDesktopLibraryProject,
} from './soundscaper-project-library-metadata.ts';
import {
	SoundscaperDesktopProjectLibraryPublicationHost,
} from './soundscaper-project-library-publication-host.ts';
import {
	validateSoundscaperDesktopProjectLibraryLeaseToken,
	type SoundscaperDesktopProjectLibraryLease,
} from './soundscaper-project-library-persistence-codecs.ts';
import {
	createSoundscaperDesktopProjectLibraryTransferBodies,
	MAXIMUM_SOUNDSCAPER_TRANSFER_CHUNK_BYTES,
	validateSoundscaperDesktopProjectLibraryHostBundle,
	type SoundscaperDesktopProjectLibraryTransferBody,
	type SoundscaperDesktopProjectLibraryTransferBundle,
} from './soundscaper-project-library-transfer-contract.ts';

const CREATE_FIELDS = ['catalog', 'host', 'lease'] as const;

interface CreateOptions {
	readonly catalog: SoundscaperDesktopProjectLibraryCatalog;
	readonly host: SoundscaperDesktopProjectLibraryPublicationHost;
	readonly lease: SoundscaperDesktopProjectLibraryLease;
}

/** Main-only exact catalog/delete/duplicate authority for the selected baseline owner. */
export class SoundscaperDesktopProjectLibraryLifecycleHost {
	readonly #catalog: SoundscaperDesktopProjectLibraryCatalog;
	readonly #host: SoundscaperDesktopProjectLibraryPublicationHost;
	#lease: SoundscaperDesktopProjectLibraryLease;

	private constructor(options: CreateOptions) {
		this.#catalog = options.catalog;
		this.#host = options.host;
		this.#lease = options.lease;
	}

	static create(value: unknown): SoundscaperDesktopProjectLibraryLifecycleHost {
		const options = closedRecord(value, CREATE_FIELDS, 'Soundscaper desktop baseline lifecycle host');
		if (!(options.catalog instanceof SoundscaperDesktopProjectLibraryCatalog)
			|| !(options.host instanceof SoundscaperDesktopProjectLibraryPublicationHost)) {
			throw new TypeError('Soundscaper desktop baseline lifecycle requires exact main catalog and publication owners');
		}
		const lease = validateSoundscaperDesktopProjectLibraryLeaseToken(
			options.lease as SoundscaperDesktopProjectLibraryLease,
		);
		return Object.freeze(new SoundscaperDesktopProjectLibraryLifecycleHost({
			catalog: options.catalog,
			host: options.host,
			lease,
		})) as SoundscaperDesktopProjectLibraryLifecycleHost;
	}

	updateLease(value: unknown): void {
		const next = validateSoundscaperDesktopProjectLibraryLeaseToken(
			value as SoundscaperDesktopProjectLibraryLease,
		);
		if (next.leaseId !== this.#lease.leaseId || next.fencingToken !== this.#lease.fencingToken
			|| JSON.stringify(next.owner) !== JSON.stringify(this.#lease.owner)
			|| next.acquiredAtMs !== this.#lease.acquiredAtMs || next.expiresAtMs < this.#lease.expiresAtMs) {
			throw new Error('Soundscaper desktop baseline lifecycle lease renewal changed its main-owned fence');
		}
		this.#lease = next;
	}

	listProjects(): Readonly<SoundscaperDesktopProjectLibraryCatalogSnapshot> {
		const metadata = this.#catalog.readMetadata();
		const projects = metadata.projects.map((project) => Object.freeze({
			schemaFamily: project.schemaFamily,
			schemaVersion: project.schemaVersion,
			id: project.projectId,
			title: project.name,
			revision: project.projectRevision,
			updatedAt: new Date(project.updatedAtMs).toISOString(),
		})).sort((left, right) => (
			right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id)
		));
		return validateSoundscaperDesktopProjectLibraryCatalogSnapshot({
			metadataRevision: metadata.revision,
			projects,
		});
	}

	async deleteProject(value: unknown): Promise<Readonly<SoundscaperDesktopProjectLibraryDeleteResult>> {
		const request = validateSoundscaperDesktopProjectLibraryDeleteRequest(value);
		const metadata = this.#catalog.readMetadata();
		assertMetadataRevision(metadata, request.expectedMetadataRevision);
		const current = exactProject(metadata, request.projectId);
		assertExpectedProject(current, request.expectedProject, 'delete');
		const projects = metadata.projects.filter(({ projectId }) => projectId !== request.projectId);
		const published = this.#catalog.publishMetadata({
			expectedRevision: request.expectedMetadataRevision,
			lease: this.#lease,
			metadata: {
				schemaVersion: 1,
				revision: increment(request.expectedMetadataRevision, 'metadata revision'),
				projects,
				media: this.#host.currentMedia(metadata, request.projectId),
			},
		});
		const result = validateSoundscaperDesktopProjectLibraryDeleteResult({
			projectId: request.projectId,
			metadataRevision: published.revision,
			deleted: true,
		});
		await this.#host.reclaimStorage().catch(() => undefined);
		return result;
	}

	async duplicateProject(
		value: unknown,
		signal?: AbortSignal,
	): Promise<Readonly<SoundscaperDesktopProjectLibraryTransferBundle>> {
		const request = validateSoundscaperDesktopProjectLibraryDuplicateRequest(value);
		throwIfAborted(signal);
		const metadata = this.#catalog.readMetadata();
		assertMetadataRevision(metadata, request.expectedMetadataRevision);
		const sourceRow = exactProject(metadata, request.sourceProjectId);
		assertExpectedProject(sourceRow, request.expectedSource, 'duplication source');
		if (metadata.projects.some(({ projectId }) => projectId === request.copyProjectId)) {
			throw new Error('Soundscaper desktop baseline project duplication destination already exists');
		}
		const sourceValue = await this.#host.readProjectBundle(request.sourceProjectId, signal);
		if (sourceValue === null) throw new Error('Soundscaper desktop baseline project duplication source is unavailable');
		const source = validateSoundscaperDesktopProjectLibraryHostBundle(
			sourceValue,
			request.sourceProjectId,
		);
		if (source.metadataRevision !== request.expectedMetadataRevision
			|| source.project.projectRevision !== request.expectedSource.projectRevision
			|| source.project.sha256 !== request.expectedSource.projectSha256) {
			throw new Error('Soundscaper desktop baseline project duplication source changed before publication');
		}
		const project = duplicateProjectDocument(source.document, request);
		const document = JSON.stringify(project);
		const projectSha256 = createHash('sha256').update(document, 'utf8').digest('hex');
		const bodies = createSoundscaperDesktopProjectLibraryTransferBodies(project, projectSha256);
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
		body: Readonly<SoundscaperDesktopProjectLibraryTransferBody>,
		signal?: AbortSignal,
	): AsyncGenerator<Uint8Array> {
		for (let offset = 0; offset < body.byteLength; offset += MAXIMUM_SOUNDSCAPER_TRANSFER_CHUNK_BYTES) {
			throwIfAborted(signal);
			const length = Math.min(MAXIMUM_SOUNDSCAPER_TRANSFER_CHUNK_BYTES, body.byteLength - offset);
			yield await this.#host.readBodyChunk(body, { offset, length, ...(signal ? { signal } : {}) });
		}
	}
}

function duplicateProjectDocument(
	document: string,
	request: Readonly<SoundscaperDesktopProjectLibraryDuplicateRequest>,
) {
	const source = validateSoundscaperDesktopCurrentProject(JSON.parse(document) as unknown);
	const project = structuredClone(source) as unknown as Record<string, unknown>;
	project.id = request.copyProjectId;
	project.title = request.title;
	project.revision = 0;
	project.createdAt = request.timestamp;
	project.updatedAt = request.timestamp;
	return validateSoundscaperDesktopCurrentProject(project);
}

function matchSourceBodies(
	source: readonly Readonly<SoundscaperDesktopProjectLibraryTransferBody>[],
	destination: readonly Readonly<SoundscaperDesktopProjectLibraryTransferBody>[],
): readonly Readonly<SoundscaperDesktopProjectLibraryTransferBody>[] {
	return destination.map((body) => {
		const candidates = source.filter((candidate) => sameBodyContent(candidate, body));
		if (candidates.length !== 1) {
			throw new Error('Soundscaper desktop baseline duplication source body ownership is incomplete or ambiguous');
		}
		return candidates[0]!;
	});
}

function sameBodyContent(
	left: Readonly<SoundscaperDesktopProjectLibraryTransferBody>,
	right: Readonly<SoundscaperDesktopProjectLibraryTransferBody>,
): boolean {
	return left.kind === right.kind && left.encoding === right.encoding
		&& left.sourceId === right.sourceId && left.storageKey === right.storageKey
		&& left.mimeType === right.mimeType && left.byteLength === right.byteLength
		&& left.sha256 === right.sha256;
}

function exactProject(
	metadata: Readonly<SoundscaperDesktopLibraryMetadata>,
	projectId: string,
): Readonly<SoundscaperDesktopLibraryProject> {
	const matches = metadata.projects.filter((project) => project.projectId === projectId);
	if (matches.length !== 1) throw new Error('Soundscaper desktop baseline current catalog project is unavailable');
	return matches[0]!;
}

function assertExpectedProject(
	project: Readonly<SoundscaperDesktopLibraryProject>,
	expected: Readonly<SoundscaperDesktopProjectLibraryExpectedProject>,
	label: string,
): void {
	if (project.projectRevision !== expected.projectRevision || project.sha256 !== expected.projectSha256) {
		throw new Error(`Soundscaper desktop baseline ${label} failed its exact project compare-and-swap`);
	}
}

function assertMetadataRevision(
	metadata: Readonly<SoundscaperDesktopLibraryMetadata>,
	expected: number,
): void {
	if (metadata.revision !== expected) {
		throw new Error('Soundscaper desktop baseline metadata revision failed compare-and-swap');
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
	if (value === Number.MAX_SAFE_INTEGER) throw new RangeError(`Soundscaper desktop baseline ${label} cannot advance`);
	return value + 1;
}

function throwIfAborted(signal?: AbortSignal): void {
	if (signal !== undefined && !(signal instanceof AbortSignal)) {
		throw new TypeError('Soundscaper desktop baseline lifecycle signal is invalid');
	}
	signal?.throwIfAborted();
}
