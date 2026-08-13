/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';

import {
	FramescaperDesktopProjectLibraryV10Catalog,
} from './project-library-v10-catalog.ts';
import {
	validateFramescaperDesktopCurrentProjectV18,
} from './project-library-v10-current-project.ts';
import type {
	FramescaperDesktopLibraryV10Metadata,
	FramescaperDesktopLibraryV10Project,
} from './project-library-v10-metadata.ts';
import {
	FramescaperDesktopProjectLibraryV10PublicationHost,
} from './project-library-v10-publication-host.ts';
import {
	validateFramescaperDesktopProjectLibraryV10LeaseToken,
	type FramescaperDesktopProjectLibraryV10Lease,
} from './project-library-v10-persistence-codecs.ts';
import {
	createFramescaperDesktopProjectLibraryV10TransferBodies,
	MAXIMUM_FRAMESCAPER_V10_TRANSFER_CHUNK_BYTES,
	validateFramescaperDesktopProjectLibraryV10HostBundle,
	validateFramescaperDesktopProjectLibraryV10ProjectId,
	type FramescaperDesktopProjectLibraryV10TransferBody,
	type FramescaperDesktopProjectLibraryV10TransferBundle,
} from './project-library-v10-transfer-contract.ts';

const CREATE_FIELDS = ['catalog', 'host', 'lease'] as const;
const DELETE_FIELDS = [
	'projectId', 'expectedMetadataRevision', 'expectedProject',
] as const;
const DUPLICATE_FIELDS = [
	'sourceProjectId', 'copyProjectId', 'title', 'timestamp',
	'expectedMetadataRevision', 'expectedSource',
] as const;
const EXPECTED_FIELDS = ['projectRevision', 'projectSha256'] as const;
const MAXIMUM_TITLE_BYTES = 1_024;

export interface FramescaperDesktopProjectLibraryV10ProjectSummary {
	readonly id: string;
	readonly title: string;
	readonly revision: number;
	readonly updatedAt: string;
}

export interface FramescaperDesktopProjectLibraryV10CatalogSnapshot {
	readonly metadataRevision: number;
	readonly projects: readonly Readonly<FramescaperDesktopProjectLibraryV10ProjectSummary>[];
}

export interface FramescaperDesktopProjectLibraryV10ExpectedProject {
	readonly projectRevision: number;
	readonly projectSha256: string;
}

export interface FramescaperDesktopProjectLibraryV10DeleteRequest {
	readonly projectId: string;
	readonly expectedMetadataRevision: number;
	readonly expectedProject: Readonly<FramescaperDesktopProjectLibraryV10ExpectedProject>;
}

export interface FramescaperDesktopProjectLibraryV10DeleteResult {
	readonly projectId: string;
	readonly metadataRevision: number;
	readonly deleted: true;
}

export interface FramescaperDesktopProjectLibraryV10DuplicateRequest {
	readonly sourceProjectId: string;
	readonly copyProjectId: string;
	readonly title: string;
	readonly timestamp: string;
	readonly expectedMetadataRevision: number;
	readonly expectedSource: Readonly<FramescaperDesktopProjectLibraryV10ExpectedProject>;
}

interface CreateOptions {
	readonly catalog: FramescaperDesktopProjectLibraryV10Catalog;
	readonly host: FramescaperDesktopProjectLibraryV10PublicationHost;
	readonly lease: FramescaperDesktopProjectLibraryV10Lease;
}

/** Main-only exact catalog/delete/duplicate authority for the selected V10 owner. */
export class FramescaperDesktopProjectLibraryV10LifecycleHost {
	readonly #catalog: FramescaperDesktopProjectLibraryV10Catalog;
	readonly #host: FramescaperDesktopProjectLibraryV10PublicationHost;
	readonly #lease: FramescaperDesktopProjectLibraryV10Lease;

	private constructor(options: CreateOptions) {
		this.#catalog = options.catalog;
		this.#host = options.host;
		this.#lease = options.lease;
	}

	static create(value: unknown): FramescaperDesktopProjectLibraryV10LifecycleHost {
		const options = closedRecord(value, CREATE_FIELDS, 'Framescaper V10 lifecycle host');
		if (!(options.catalog instanceof FramescaperDesktopProjectLibraryV10Catalog)
			|| !(options.host instanceof FramescaperDesktopProjectLibraryV10PublicationHost)) {
			throw new TypeError('Framescaper V10 lifecycle requires exact main catalog and publication owners');
		}
		const lease = validateFramescaperDesktopProjectLibraryV10LeaseToken(
			options.lease as FramescaperDesktopProjectLibraryV10Lease,
		);
		return Object.freeze(new FramescaperDesktopProjectLibraryV10LifecycleHost({
			catalog: options.catalog,
			host: options.host,
			lease,
		})) as FramescaperDesktopProjectLibraryV10LifecycleHost;
	}

	listProjects(): Readonly<FramescaperDesktopProjectLibraryV10CatalogSnapshot> {
		const metadata = this.#catalog.readMetadata();
		const projects = metadata.projects.map((project) => Object.freeze({
			id: project.projectId,
			title: project.name,
			revision: project.projectRevision,
			updatedAt: new Date(project.updatedAtMs).toISOString(),
		})).sort((left, right) => (
			right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id)
		));
		return Object.freeze({
			metadataRevision: metadata.revision,
			projects: Object.freeze(projects),
		});
	}

	deleteProject(value: unknown): Readonly<FramescaperDesktopProjectLibraryV10DeleteResult> {
		const request = deleteRequest(value);
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
		return Object.freeze({
			projectId: request.projectId,
			metadataRevision: published.revision,
			deleted: true,
		});
	}

	async duplicateProject(
		value: unknown,
		signal?: AbortSignal,
	): Promise<Readonly<FramescaperDesktopProjectLibraryV10TransferBundle>> {
		const request = duplicateRequest(value);
		throwIfAborted(signal);
		const metadata = this.#catalog.readMetadata();
		assertMetadataRevision(metadata, request.expectedMetadataRevision);
		const sourceRow = exactProject(metadata, request.sourceProjectId);
		assertExpectedProject(sourceRow, request.expectedSource, 'duplication source');
		if (metadata.projects.some(({ projectId }) => projectId === request.copyProjectId)) {
			throw new Error('Framescaper V10 project duplication destination already exists');
		}
		const sourceValue = await this.#host.readProjectBundle(request.sourceProjectId, signal);
		if (sourceValue === null) throw new Error('Framescaper V10 project duplication source is unavailable');
		const source = validateFramescaperDesktopProjectLibraryV10HostBundle(
			sourceValue,
			request.sourceProjectId,
		);
		if (source.metadataRevision !== request.expectedMetadataRevision
			|| source.project.projectRevision !== request.expectedSource.projectRevision
			|| source.project.sha256 !== request.expectedSource.projectSha256) {
			throw new Error('Framescaper V10 project duplication source changed before publication');
		}
		const project = duplicateProjectDocument(source.document, request);
		const document = JSON.stringify(project);
		const projectSha256 = createHash('sha256').update(document, 'utf8').digest('hex');
		const bodies = createFramescaperDesktopProjectLibraryV10TransferBodies(project, projectSha256);
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
		});
	}

	async *#bodyChunks(
		body: Readonly<FramescaperDesktopProjectLibraryV10TransferBody>,
		signal?: AbortSignal,
	): AsyncGenerator<Uint8Array> {
		for (let offset = 0; offset < body.byteLength; offset += MAXIMUM_FRAMESCAPER_V10_TRANSFER_CHUNK_BYTES) {
			throwIfAborted(signal);
			const length = Math.min(MAXIMUM_FRAMESCAPER_V10_TRANSFER_CHUNK_BYTES, body.byteLength - offset);
			yield await this.#host.readBodyChunk(body, { offset, length, ...(signal ? { signal } : {}) });
		}
	}
}

function duplicateProjectDocument(
	document: string,
	request: Readonly<FramescaperDesktopProjectLibraryV10DuplicateRequest>,
) {
	const source = validateFramescaperDesktopCurrentProjectV18(JSON.parse(document) as unknown);
	const project = structuredClone(source) as unknown as Record<string, unknown>;
	project.id = request.copyProjectId;
	project.title = request.title;
	project.revision = 0;
	project.createdAt = request.timestamp;
	project.updatedAt = request.timestamp;
	project.multicameraGroups = (project.multicameraGroups as Record<string, unknown>[]).map((group) => ({
		...group,
		projectId: request.copyProjectId,
	}));
	return validateFramescaperDesktopCurrentProjectV18(project);
}

function matchSourceBodies(
	source: readonly Readonly<FramescaperDesktopProjectLibraryV10TransferBody>[],
	destination: readonly Readonly<FramescaperDesktopProjectLibraryV10TransferBody>[],
): readonly Readonly<FramescaperDesktopProjectLibraryV10TransferBody>[] {
	return destination.map((body) => {
		const candidates = source.filter((candidate) => sameBodyContent(candidate, body));
		if (candidates.length !== 1) {
			throw new Error('Framescaper V10 duplication source body ownership is incomplete or ambiguous');
		}
		return candidates[0]!;
	});
}

function sameBodyContent(
	left: Readonly<FramescaperDesktopProjectLibraryV10TransferBody>,
	right: Readonly<FramescaperDesktopProjectLibraryV10TransferBody>,
): boolean {
	return left.kind === right.kind && left.encoding === right.encoding
		&& left.sourceId === right.sourceId && left.storageKey === right.storageKey
		&& left.mimeType === right.mimeType && left.byteLength === right.byteLength
		&& left.sha256 === right.sha256;
}

function deleteRequest(value: unknown): Readonly<FramescaperDesktopProjectLibraryV10DeleteRequest> {
	const raw = closedRecord(value, DELETE_FIELDS, 'Framescaper V10 delete request');
	return Object.freeze({
		projectId: validateFramescaperDesktopProjectLibraryV10ProjectId(raw.projectId),
		expectedMetadataRevision: nonNegativeInteger(raw.expectedMetadataRevision, 'expected metadata revision'),
		expectedProject: expectedProject(raw.expectedProject),
	});
}

function duplicateRequest(value: unknown): Readonly<FramescaperDesktopProjectLibraryV10DuplicateRequest> {
	const raw = closedRecord(value, DUPLICATE_FIELDS, 'Framescaper V10 duplicate request');
	const timestamp = canonicalTimestamp(raw.timestamp);
	return Object.freeze({
		sourceProjectId: validateFramescaperDesktopProjectLibraryV10ProjectId(raw.sourceProjectId),
		copyProjectId: validateFramescaperDesktopProjectLibraryV10ProjectId(raw.copyProjectId),
		title: boundedTitle(raw.title),
		timestamp,
		expectedMetadataRevision: nonNegativeInteger(raw.expectedMetadataRevision, 'expected metadata revision'),
		expectedSource: expectedProject(raw.expectedSource),
	});
}

function expectedProject(value: unknown): Readonly<FramescaperDesktopProjectLibraryV10ExpectedProject> {
	const raw = closedRecord(value, EXPECTED_FIELDS, 'Framescaper V10 expected project');
	return Object.freeze({
		projectRevision: nonNegativeInteger(raw.projectRevision, 'expected project revision'),
		projectSha256: digest(raw.projectSha256, 'expected project'),
	});
}

function exactProject(
	metadata: Readonly<FramescaperDesktopLibraryV10Metadata>,
	projectId: string,
): Readonly<FramescaperDesktopLibraryV10Project> {
	const matches = metadata.projects.filter((project) => project.projectId === projectId);
	if (matches.length !== 1) throw new Error('Framescaper V10 current catalog project is unavailable');
	return matches[0]!;
}

function assertExpectedProject(
	project: Readonly<FramescaperDesktopLibraryV10Project>,
	expected: Readonly<FramescaperDesktopProjectLibraryV10ExpectedProject>,
	label: string,
): void {
	if (project.projectRevision !== expected.projectRevision || project.sha256 !== expected.projectSha256) {
		throw new Error(`Framescaper V10 ${label} failed its exact project compare-and-swap`);
	}
}

function assertMetadataRevision(
	metadata: Readonly<FramescaperDesktopLibraryV10Metadata>,
	expected: number,
): void {
	if (metadata.revision !== expected) {
		throw new Error('Framescaper V10 metadata revision failed compare-and-swap');
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

function boundedTitle(value: unknown): string {
	if (typeof value !== 'string' || !value.trim()
		|| new TextEncoder().encode(value).byteLength > MAXIMUM_TITLE_BYTES) {
		throw new TypeError('Framescaper V10 duplicate title is invalid');
	}
	return value;
}

function canonicalTimestamp(value: unknown): string {
	if (typeof value !== 'string') throw new TypeError('Framescaper V10 duplicate timestamp is invalid');
	const time = Date.parse(value);
	if (!Number.isFinite(time) || new Date(time).toISOString() !== value) {
		throw new TypeError('Framescaper V10 duplicate timestamp is invalid');
	}
	return value;
}

function nonNegativeInteger(value: unknown, label: string): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
		throw new RangeError(`Framescaper V10 ${label} must be a non-negative safe integer`);
	}
	return value;
}

function digest(value: unknown, label: string): string {
	if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) {
		throw new TypeError(`Framescaper V10 ${label} digest is invalid`);
	}
	return value;
}

function increment(value: number, label: string): number {
	if (value === Number.MAX_SAFE_INTEGER) throw new RangeError(`Framescaper V10 ${label} cannot advance`);
	return value + 1;
}

function throwIfAborted(signal?: AbortSignal): void {
	if (signal !== undefined && !(signal instanceof AbortSignal)) {
		throw new TypeError('Framescaper V10 lifecycle signal is invalid');
	}
	signal?.throwIfAborted();
}
