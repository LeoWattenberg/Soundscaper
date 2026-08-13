/* SPDX-License-Identifier: AGPL-3.0-only */

import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

import {
	createFramescaperDesktopProjectLibraryV10Paths,
	type FramescaperDesktopProjectLibraryV10Handshake,
	type FramescaperDesktopProjectLibraryV10Paths,
} from './project-library-v10-contract.ts';
import {
	assertFramescaperDesktopProjectLibraryV10DatabaseIdentity,
} from './project-library-v10-database.ts';
import {
	createFramescaperDesktopProjectLibraryV10HandshakeGate,
	type FramescaperDesktopProjectLibraryV10HandshakeState,
} from './project-library-v10-handshake-gate.ts';
import {
	planFramescaperDesktopProjectLibraryV10Publication,
	type FramescaperDesktopProjectLibraryV10PublicationBodyInput,
	type FramescaperDesktopProjectLibraryV10PublicationCheckpoint,
} from './project-library-v10-publication-contract.ts';
import {
	cleanupFramescaperDesktopProjectLibraryV10Stages,
	materializeFramescaperDesktopProjectLibraryV10Publication,
	readFramescaperDesktopProjectLibraryV10File,
	readFramescaperDesktopProjectLibraryV10FileRange,
	stageFramescaperDesktopProjectLibraryV10Publication,
} from './project-library-v10-publication-files.ts';
import {
	assertFramescaperDesktopProjectLibraryV10PublicationLease,
	commitFramescaperDesktopProjectLibraryV10Publication,
	markFramescaperDesktopProjectLibraryV10PublicationMaterialized,
	prepareFramescaperDesktopProjectLibraryV10Publication,
	readFramescaperDesktopProjectLibraryV10MetadataSnapshot,
	readFramescaperDesktopProjectLibraryV10PendingPublication,
	readFramescaperDesktopProjectLibraryV10PublicationById,
	settleFramescaperDesktopProjectLibraryV10Publication,
} from './project-library-v10-publication-persistence.ts';
import type { FramescaperDesktopProjectLibraryV10Lease } from './project-library-v10-persistence-codecs.ts';
import {
	sameFramescaperDesktopProjectLibraryV10TransferBody,
	validateFramescaperDesktopProjectLibraryV10ProjectId,
	validateFramescaperDesktopProjectLibraryV10TransferBody,
	type FramescaperDesktopProjectLibraryV10TransferBody,
	type FramescaperDesktopProjectLibraryV10TransferBundle,
} from './project-library-v10-transfer-contract.ts';

export type {
	FramescaperDesktopProjectLibraryV10PublicationBodyInput,
	FramescaperDesktopProjectLibraryV10PublicationCheckpoint,
};

export interface FramescaperDesktopProjectLibraryV10PublicationRecovery {
	readonly outcome: 'clean' | 'committed';
	readonly projectId: string | null;
	readonly projectRevision: number | null;
	readonly metadataRevision: number | null;
}

const CREATE_FIELDS = ['database', 'appDataPath', 'checkpoint', 'now', 'randomId'] as const;
const RECOVER_FIELDS = ['lease'] as const;
const READ_FIELDS = ['offset', 'length', 'signal'] as const;
const ID = /^[a-f0-9]{48}$/u;

interface CreateOptions {
	readonly database: DatabaseSync;
	readonly appDataPath: string;
	readonly checkpoint?: (phase: FramescaperDesktopProjectLibraryV10PublicationCheckpoint) => void;
	readonly now?: () => number;
	readonly randomId?: () => string;
}

/** Dormant concrete main owner for exact V18 document and two-body publication. */
export class FramescaperDesktopProjectLibraryV10PublicationHost {
	readonly paths: Readonly<FramescaperDesktopProjectLibraryV10Paths>;
	readonly #checkpoint: (phase: FramescaperDesktopProjectLibraryV10PublicationCheckpoint) => void;
	readonly #database: DatabaseSync;
	readonly #gate = createFramescaperDesktopProjectLibraryV10HandshakeGate();
	readonly #now: () => number;
	readonly #randomId: () => string;
	#operationActive = false;

	private constructor(options: CreateOptions) {
		this.#database = options.database;
		this.paths = createFramescaperDesktopProjectLibraryV10Paths(options.appDataPath);
		this.#checkpoint = options.checkpoint ?? (() => {});
		this.#now = options.now ?? Date.now;
		this.#randomId = options.randomId ?? (() => randomBytes(24).toString('hex'));
	}

	static create(value: unknown): FramescaperDesktopProjectLibraryV10PublicationHost {
		const options = snapshotOptions(value);
		if (!(options.database instanceof DatabaseSync) || typeof options.appDataPath !== 'string') {
			throw new TypeError('Framescaper V10 publication host requires database and appData path');
		}
		for (const field of ['checkpoint', 'now', 'randomId'] as const) {
			if (options[field] !== undefined && typeof options[field] !== 'function') {
				throw new TypeError(`Framescaper V10 publication host ${field} must be a function`);
			}
		}
		return Object.freeze(new FramescaperDesktopProjectLibraryV10PublicationHost({
			database: options.database,
			appDataPath: options.appDataPath,
			...(options.checkpoint === undefined ? {} : { checkpoint: options.checkpoint as CreateOptions['checkpoint'] }),
			...(options.now === undefined ? {} : { now: options.now as CreateOptions['now'] }),
			...(options.randomId === undefined ? {} : { randomId: options.randomId as CreateOptions['randomId'] }),
		})) as FramescaperDesktopProjectLibraryV10PublicationHost;
	}

	get localHandshake(): Readonly<FramescaperDesktopProjectLibraryV10Handshake> {
		return this.#gate.local;
	}

	handshakeState(): FramescaperDesktopProjectLibraryV10HandshakeState {
		return this.#gate.state();
	}

	acceptHandshake(value: unknown): Readonly<FramescaperDesktopProjectLibraryV10Handshake> {
		return this.#gate.accept(value);
	}

	async publish(value: unknown): Promise<Readonly<FramescaperDesktopProjectLibraryV10TransferBundle>> {
		this.#assertOperational();
		return this.#exclusive(async () => {
			const now = this.#timestamp();
			assertFramescaperDesktopProjectLibraryV10DatabaseIdentity(this.#database);
			const current = readFramescaperDesktopProjectLibraryV10MetadataSnapshot(this.#database);
			const entryId = this.#newId();
			const plan = planFramescaperDesktopProjectLibraryV10Publication(
				value,
				current.metadata,
				entryId,
				now,
			);
			assertFramescaperDesktopProjectLibraryV10PublicationLease(
				this.#database,
				plan.lease,
				now,
			);
			this.#assertPreflight(plan.bundle.project.projectId, plan.bundle.project.projectRevision);
			const transactionId = this.#newId();
			const stages = await stageFramescaperDesktopProjectLibraryV10Publication(
				this.paths,
				transactionId,
				plan,
			);
			let prepared = false;
			try {
				prepareFramescaperDesktopProjectLibraryV10Publication(
					this.#database,
					transactionId,
					plan,
					stages,
					now,
				);
				prepared = true;
			} catch (error) {
				await cleanupFramescaperDesktopProjectLibraryV10Stages(this.paths.libraryRoot, stages);
				throw error;
			}
			if (!prepared) throw new Error('Framescaper V10 publication did not prepare');
			this.#checkpoint('prepared');
			await materializeFramescaperDesktopProjectLibraryV10Publication(this.paths.libraryRoot, stages);
			markFramescaperDesktopProjectLibraryV10PublicationMaterialized(
				this.#database,
				transactionId,
				plan.lease,
				now,
			);
			this.#checkpoint('materialized');
			const publication = readFramescaperDesktopProjectLibraryV10PublicationById(
				this.#database,
				transactionId,
			);
			commitFramescaperDesktopProjectLibraryV10Publication(
				this.#database,
				publication,
				plan.lease,
				now,
			);
			this.#checkpoint('committed');
			await materializeFramescaperDesktopProjectLibraryV10Publication(
				this.paths.libraryRoot,
				publication.stages,
			);
			settleFramescaperDesktopProjectLibraryV10Publication(
				this.#database,
				transactionId,
				plan.lease,
				now,
			);
			this.#checkpoint('complete');
			return plan.bundle;
		});
	}

	async recover(value: unknown): Promise<Readonly<FramescaperDesktopProjectLibraryV10PublicationRecovery>> {
		this.#assertOperational();
		const options = snapshotRequired(value, RECOVER_FIELDS, 'Framescaper V10 publication recovery');
		const lease = options.lease as FramescaperDesktopProjectLibraryV10Lease;
		return this.#exclusive(async () => {
			const now = this.#timestamp();
			assertFramescaperDesktopProjectLibraryV10DatabaseIdentity(this.#database);
			assertFramescaperDesktopProjectLibraryV10PublicationLease(this.#database, lease, now);
			let publication = readFramescaperDesktopProjectLibraryV10PendingPublication(this.#database);
			if (!publication) return freezeRecovery('clean', null);
			if (publication.state === 'prepared') {
				await materializeFramescaperDesktopProjectLibraryV10Publication(
					this.paths.libraryRoot,
					publication.stages,
				);
				markFramescaperDesktopProjectLibraryV10PublicationMaterialized(
					this.#database,
					publication.transactionId,
					lease,
					now,
				);
				this.#checkpoint('materialized');
				publication = readFramescaperDesktopProjectLibraryV10PublicationById(
					this.#database,
					publication.transactionId,
				);
			}
			if (publication.state === 'materialized') {
				await materializeFramescaperDesktopProjectLibraryV10Publication(
					this.paths.libraryRoot,
					publication.stages,
				);
				commitFramescaperDesktopProjectLibraryV10Publication(
					this.#database,
					publication,
					lease,
					now,
				);
				this.#checkpoint('committed');
				publication = readFramescaperDesktopProjectLibraryV10PublicationById(
					this.#database,
					publication.transactionId,
				);
			}
			if (publication.state === 'committed') {
				await materializeFramescaperDesktopProjectLibraryV10Publication(
					this.paths.libraryRoot,
					publication.stages,
				);
				settleFramescaperDesktopProjectLibraryV10Publication(
					this.#database,
					publication.transactionId,
					lease,
					now,
				);
				this.#checkpoint('complete');
			}
			return freezeRecovery('committed', publication);
		});
	}

	async readProjectBundle(projectIdValue: string, signal?: AbortSignal): Promise<unknown> {
		this.#assertOperational();
		signal?.throwIfAborted();
		assertFramescaperDesktopProjectLibraryV10DatabaseIdentity(this.#database);
		const projectId = validateFramescaperDesktopProjectLibraryV10ProjectId(projectIdValue);
		const current = readFramescaperDesktopProjectLibraryV10MetadataSnapshot(this.#database);
		const project = current.metadata.projects.find((candidate) => candidate.projectId === projectId);
		if (!project) return null;
		const revision = this.#database.prepare(`
			SELECT relative_file AS relativeFile, byte_length AS byteLength,
				project_sha256 AS sha256, document_json AS document
			FROM project_revisions WHERE project_id = ? AND project_revision = ?
		`).get(projectId, project.projectRevision) as Record<string, unknown> | undefined;
		if (!revision || revision.relativeFile !== project.metadataFile
			|| revision.byteLength !== project.byteLength || revision.sha256 !== project.sha256
			|| typeof revision.document !== 'string') {
			throw new Error('Framescaper V10 current project revision is missing or inconsistent');
		}
		const bytes = await readFramescaperDesktopProjectLibraryV10File(
			this.paths.libraryRoot,
			`projects/${project.metadataFile}`,
			project.byteLength,
			project.sha256,
			signal,
		);
		const document = new TextDecoder().decode(bytes);
		if (document !== revision.document) {
			throw new Error('Framescaper V10 project file disagrees with its immutable revision');
		}
		const bodyRows = this.#database.prepare(`
			SELECT body.descriptor_json AS descriptor
			FROM project_revision_bodies AS ownership
			JOIN managed_bodies AS body ON body.body_id = ownership.body_id
			WHERE ownership.project_id = ? AND ownership.project_revision = ?
			ORDER BY ownership.ordinal
		`).all(projectId, project.projectRevision) as Record<string, unknown>[];
		const bodies = Object.freeze(bodyRows.map(({ descriptor }) => {
			if (typeof descriptor !== 'string') throw new TypeError('Framescaper V10 body descriptor is invalid');
			return validateFramescaperDesktopProjectLibraryV10TransferBody(JSON.parse(descriptor) as unknown);
		}));
		return Object.freeze({ metadata: current.metadata, document, bodies });
	}

	async readBodyChunk(
		bodyValue: Readonly<FramescaperDesktopProjectLibraryV10TransferBody>,
		optionsValue: Readonly<{ offset: number; length: number; signal?: AbortSignal }>,
	): Promise<Uint8Array> {
		this.#assertOperational();
		assertFramescaperDesktopProjectLibraryV10DatabaseIdentity(this.#database);
		const body = validateFramescaperDesktopProjectLibraryV10TransferBody(bodyValue);
		const options = snapshotAllowed(optionsValue, READ_FIELDS, ['offset', 'length'], 'Framescaper V10 body read');
		const bodyId = body.kind === 'video-proxy' ? body.bindingId : `t${body.sha256}`;
		const row = this.#database.prepare(`
			SELECT descriptor_json AS descriptor, relative_file AS relativeFile,
				byte_length AS byteLength, sha256
			FROM managed_bodies WHERE body_id = ? AND state = 'published'
		`).get(bodyId) as Record<string, unknown> | undefined;
		if (!row || typeof row.descriptor !== 'string' || typeof row.relativeFile !== 'string') {
			throw new Error('Framescaper V10 managed body is unavailable');
		}
		const persisted = validateFramescaperDesktopProjectLibraryV10TransferBody(
			JSON.parse(row.descriptor) as unknown,
		);
		if (!sameFramescaperDesktopProjectLibraryV10TransferBody(body, persisted)
			|| row.byteLength !== body.byteLength || row.sha256 !== body.sha256) {
			throw new Error('Framescaper V10 managed body identity changed');
		}
		const signal = options.signal;
		if (signal !== undefined && !(signal instanceof AbortSignal)) {
			throw new TypeError('Framescaper V10 body read signal is invalid');
		}
		return readFramescaperDesktopProjectLibraryV10FileRange(
			this.paths.libraryRoot,
			`media/${row.relativeFile}`,
			body.byteLength,
			body.sha256,
			nonNegativeInteger(options.offset, 'body read offset'),
			positiveInteger(options.length, 'body read length'),
			signal as AbortSignal | undefined,
		);
	}

	#assertOperational(): void {
		this.#gate.assertOperational();
	}

	#assertPreflight(projectId: string, projectRevision: number): void {
		if (this.#database.prepare(`
			SELECT 1 AS pending FROM publication_journal
			WHERE state IN ('prepared', 'materialized', 'committed') LIMIT 1
		`).get()) throw new Error('Framescaper V10 publication recovery is required');
		if (this.#database.prepare(`
			SELECT 1 AS pending FROM metadata_journal
			WHERE state IN ('prepared', 'committed') LIMIT 1
		`).get()) throw new Error('Framescaper V10 metadata recovery is required before body publication');
		if (this.#database.prepare(`
			SELECT 1 AS occupied FROM project_revisions
			WHERE project_id = ? AND project_revision = ?
		`).get(projectId, projectRevision)) {
			throw new Error('Framescaper V10 next project revision is occupied');
		}
	}

	#exclusive<Result>(operation: () => Promise<Result>): Promise<Result> {
		if (this.#operationActive) return Promise.reject(new Error('Framescaper V10 publication operation is busy'));
		this.#operationActive = true;
		let result: Promise<Result>;
		try { result = operation(); }
		catch (error) { this.#operationActive = false; return Promise.reject(error); }
		return result.finally(() => { this.#operationActive = false; });
	}

	#newId(): string {
		const value = this.#randomId();
		if (!ID.test(value)) throw new TypeError('Framescaper V10 publication id generator is invalid');
		return value;
	}

	#timestamp(): number {
		return nonNegativeInteger(this.#now(), 'publication timestamp');
	}
}

function freezeRecovery(
	outcome: 'clean' | 'committed',
	publication: Readonly<{
		readonly bundle: Readonly<FramescaperDesktopProjectLibraryV10TransferBundle>;
	}> | null,
): Readonly<FramescaperDesktopProjectLibraryV10PublicationRecovery> {
	return Object.freeze({
		outcome,
		projectId: publication?.bundle.project.projectId ?? null,
		projectRevision: publication?.bundle.project.projectRevision ?? null,
		metadataRevision: publication?.bundle.metadataRevision ?? null,
	});
}

function snapshotOptions(value: unknown): Readonly<Record<typeof CREATE_FIELDS[number], unknown>> {
	return snapshotAllowed(value, CREATE_FIELDS, ['database', 'appDataPath'], 'Framescaper V10 publication options');
}

function snapshotRequired<const Field extends string>(
	value: unknown,
	fields: readonly Field[],
	name: string,
): Readonly<Record<Field, unknown>> {
	return snapshotAllowed(value, fields, fields, name);
}

function snapshotAllowed<const Field extends string>(
	value: unknown,
	fields: readonly Field[],
	required: readonly Field[],
	name: string,
): Readonly<Record<Field, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
		throw new TypeError(`${name} must be a plain record`);
	}
	const keys = Reflect.ownKeys(value);
	if (keys.some((key) => typeof key !== 'string' || !fields.includes(key as Field))) {
		throw new TypeError(`${name} has unsupported fields`);
	}
	const result = Object.create(null) as Record<Field, unknown>;
	for (const field of fields) {
		const descriptor = Object.getOwnPropertyDescriptor(value, field);
		if (!descriptor) {
			if (required.includes(field)) throw new TypeError(`${name}.${field} is required`);
			result[field] = undefined;
			continue;
		}
		if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`${name}.${field} must be an own enumerable data property`);
		}
		result[field] = descriptor.value;
	}
	return result;
}

function nonNegativeInteger(value: unknown, label: string): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
		throw new RangeError(`Framescaper V10 ${label} must be a non-negative safe integer`);
	}
	return value;
}

function positiveInteger(value: unknown, label: string): number {
	const result = nonNegativeInteger(value, label);
	if (result === 0) throw new RangeError(`Framescaper V10 ${label} must be positive`);
	return result;
}
