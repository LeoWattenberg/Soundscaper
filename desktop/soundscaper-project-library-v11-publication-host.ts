/* SPDX-License-Identifier: AGPL-3.0-only */

import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

import {
	createSoundscaperDesktopProjectLibraryV11Paths,
	type SoundscaperDesktopProjectLibraryV11Handshake,
	type SoundscaperDesktopProjectLibraryV11Paths,
} from './soundscaper-project-library-v11-contract.ts';
import {
	assertSoundscaperDesktopProjectLibraryV11DatabaseIdentity,
} from './soundscaper-project-library-v11-database.ts';
import {
	createSoundscaperDesktopProjectLibraryV11HandshakeGate,
	type SoundscaperDesktopProjectLibraryV11HandshakeState,
} from './soundscaper-project-library-v11-handshake-gate.ts';
import {
	planSoundscaperDesktopProjectLibraryV11Publication,
	type SoundscaperDesktopProjectLibraryV11PublicationBodyInput,
	type SoundscaperDesktopProjectLibraryV11PublicationCheckpoint,
} from './soundscaper-project-library-v11-publication-contract.ts';
import {
	cleanupSoundscaperDesktopProjectLibraryV11Stages,
	materializeSoundscaperDesktopProjectLibraryV11Publication,
	readSoundscaperDesktopProjectLibraryV11File,
	readSoundscaperDesktopProjectLibraryV11FileRange,
	stageSoundscaperDesktopProjectLibraryV11Publication,
	type SoundscaperDesktopProjectLibraryV11PublicationStage,
} from './soundscaper-project-library-v11-publication-files.ts';
import {
	assertSoundscaperDesktopProjectLibraryV11PublicationLease,
	commitSoundscaperDesktopProjectLibraryV11Publication,
	markSoundscaperDesktopProjectLibraryV11PublicationMaterialized,
	prepareSoundscaperDesktopProjectLibraryV11Publication,
	readSoundscaperDesktopProjectLibraryV11MetadataSnapshot,
	readSoundscaperDesktopProjectLibraryV11PendingPublication,
	readSoundscaperDesktopProjectLibraryV11PublicationById,
	settleSoundscaperDesktopProjectLibraryV11Publication,
} from './soundscaper-project-library-v11-publication-persistence.ts';
import type { SoundscaperDesktopProjectLibraryV11Lease } from './soundscaper-project-library-v11-persistence-codecs.ts';
import {
	sameSoundscaperDesktopProjectLibraryV11TransferBody,
	validateSoundscaperDesktopProjectLibraryV11ProjectId,
	validateSoundscaperDesktopProjectLibraryV11TransferBody,
	type SoundscaperDesktopProjectLibraryV11TransferBody,
	type SoundscaperDesktopProjectLibraryV11TransferBundle,
} from './soundscaper-project-library-v11-transfer-contract.ts';

export type {
	SoundscaperDesktopProjectLibraryV11PublicationBodyInput,
	SoundscaperDesktopProjectLibraryV11PublicationCheckpoint,
};

export interface SoundscaperDesktopProjectLibraryV11PublicationRecovery {
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
	readonly checkpoint?: (phase: SoundscaperDesktopProjectLibraryV11PublicationCheckpoint) => void;
	readonly now?: () => number;
	readonly randomId?: () => string;
}

/** Concrete main owner for exact V21 document and freeze-body publication. */
export class SoundscaperDesktopProjectLibraryV11PublicationHost {
	readonly paths: Readonly<SoundscaperDesktopProjectLibraryV11Paths>;
	readonly #checkpoint: (phase: SoundscaperDesktopProjectLibraryV11PublicationCheckpoint) => void;
	readonly #database: DatabaseSync;
	readonly #gate = createSoundscaperDesktopProjectLibraryV11HandshakeGate();
	readonly #now: () => number;
	readonly #randomId: () => string;
	#operationActive = false;

	private constructor(options: CreateOptions) {
		this.#database = options.database;
		this.paths = createSoundscaperDesktopProjectLibraryV11Paths(options.appDataPath);
		this.#checkpoint = options.checkpoint ?? (() => {});
		this.#now = options.now ?? Date.now;
		this.#randomId = options.randomId ?? (() => randomBytes(24).toString('hex'));
	}

	static create(value: unknown): SoundscaperDesktopProjectLibraryV11PublicationHost {
		const options = snapshotOptions(value);
		if (!(options.database instanceof DatabaseSync) || typeof options.appDataPath !== 'string') {
			throw new TypeError('Soundscaper V11 publication host requires database and appData path');
		}
		for (const field of ['checkpoint', 'now', 'randomId'] as const) {
			if (options[field] !== undefined && typeof options[field] !== 'function') {
				throw new TypeError(`Soundscaper V11 publication host ${field} must be a function`);
			}
		}
		return Object.freeze(new SoundscaperDesktopProjectLibraryV11PublicationHost({
			database: options.database,
			appDataPath: options.appDataPath,
			...(options.checkpoint === undefined ? {} : { checkpoint: options.checkpoint as CreateOptions['checkpoint'] }),
			...(options.now === undefined ? {} : { now: options.now as CreateOptions['now'] }),
			...(options.randomId === undefined ? {} : { randomId: options.randomId as CreateOptions['randomId'] }),
		})) as SoundscaperDesktopProjectLibraryV11PublicationHost;
	}

	get localHandshake(): Readonly<SoundscaperDesktopProjectLibraryV11Handshake> {
		return this.#gate.local;
	}

	handshakeState(): SoundscaperDesktopProjectLibraryV11HandshakeState {
		return this.#gate.state();
	}

	acceptHandshake(value: unknown): Readonly<SoundscaperDesktopProjectLibraryV11Handshake> {
		return this.#gate.accept(value);
	}

	async publish(
		value: unknown,
		signal?: AbortSignal,
	): Promise<Readonly<SoundscaperDesktopProjectLibraryV11TransferBundle>> {
		this.#assertOperational();
		return this.#exclusive(async () => {
			throwIfAborted(signal);
			const now = this.#timestamp();
			assertSoundscaperDesktopProjectLibraryV11DatabaseIdentity(this.#database);
			const current = readSoundscaperDesktopProjectLibraryV11MetadataSnapshot(this.#database);
			const entryId = this.#newId();
			const plan = planSoundscaperDesktopProjectLibraryV11Publication(
				value,
				current.metadata,
				entryId,
				now,
			);
			assertSoundscaperDesktopProjectLibraryV11PublicationLease(
				this.#database,
				plan.lease,
				now,
			);
			this.#assertPreflight(plan.bundle.project.projectId, plan.bundle.project.projectRevision);
			const transactionId = this.#newId();
			const stages = await stageSoundscaperDesktopProjectLibraryV11Publication(
				this.paths,
				transactionId,
				plan,
				signal,
			);
			let prepared = false;
			try {
				throwIfAborted(signal);
				prepareSoundscaperDesktopProjectLibraryV11Publication(
					this.#database,
					transactionId,
					plan,
					stages,
					now,
				);
				prepared = true;
			} catch (error) {
				await cleanupSoundscaperDesktopProjectLibraryV11Stages(this.paths.libraryRoot, stages);
				throw error;
			}
			if (!prepared) throw new Error('Soundscaper V11 publication did not prepare');
			this.#checkpoint('prepared');
			let committed = false;
			try {
				await materializeSoundscaperDesktopProjectLibraryV11Publication(
					this.paths.libraryRoot, stages, signal,
				);
				throwIfAborted(signal);
				markSoundscaperDesktopProjectLibraryV11PublicationMaterialized(
					this.#database,
					transactionId,
					plan.lease,
					now,
				);
				this.#checkpoint('materialized');
				const publication = readSoundscaperDesktopProjectLibraryV11PublicationById(
					this.#database,
					transactionId,
				);
				throwIfAborted(signal);
				commitSoundscaperDesktopProjectLibraryV11Publication(
					this.#database,
					publication,
					plan.lease,
					now,
				);
				committed = true;
				this.#checkpoint('committed');
				await materializeSoundscaperDesktopProjectLibraryV11Publication(
					this.paths.libraryRoot,
					publication.stages,
				);
				settleSoundscaperDesktopProjectLibraryV11Publication(
					this.#database,
					transactionId,
					plan.lease,
					now,
				);
				this.#checkpoint('complete');
				return plan.bundle;
			} catch (error) {
				if (!committed && signal?.aborted === true) {
					await this.#abandon(transactionId, plan.lease, stages);
				}
				throw error;
			}
		});
	}

	async recover(value: unknown): Promise<Readonly<SoundscaperDesktopProjectLibraryV11PublicationRecovery>> {
		this.#assertOperational();
		const options = snapshotRequired(value, RECOVER_FIELDS, 'Soundscaper V11 publication recovery');
		const lease = options.lease as SoundscaperDesktopProjectLibraryV11Lease;
		return this.#exclusive(async () => {
			const now = this.#timestamp();
			assertSoundscaperDesktopProjectLibraryV11DatabaseIdentity(this.#database);
			assertSoundscaperDesktopProjectLibraryV11PublicationLease(this.#database, lease, now);
			let publication = readSoundscaperDesktopProjectLibraryV11PendingPublication(this.#database);
			if (!publication) return freezeRecovery('clean', null);
			if (publication.state === 'prepared') {
				await materializeSoundscaperDesktopProjectLibraryV11Publication(
					this.paths.libraryRoot,
					publication.stages,
				);
				markSoundscaperDesktopProjectLibraryV11PublicationMaterialized(
					this.#database,
					publication.transactionId,
					lease,
					now,
				);
				this.#checkpoint('materialized');
				publication = readSoundscaperDesktopProjectLibraryV11PublicationById(
					this.#database,
					publication.transactionId,
				);
			}
			if (publication.state === 'materialized') {
				await materializeSoundscaperDesktopProjectLibraryV11Publication(
					this.paths.libraryRoot,
					publication.stages,
				);
				commitSoundscaperDesktopProjectLibraryV11Publication(
					this.#database,
					publication,
					lease,
					now,
				);
				this.#checkpoint('committed');
				publication = readSoundscaperDesktopProjectLibraryV11PublicationById(
					this.#database,
					publication.transactionId,
				);
			}
			if (publication.state === 'committed') {
				await materializeSoundscaperDesktopProjectLibraryV11Publication(
					this.paths.libraryRoot,
					publication.stages,
				);
				settleSoundscaperDesktopProjectLibraryV11Publication(
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
		assertSoundscaperDesktopProjectLibraryV11DatabaseIdentity(this.#database);
		const projectId = validateSoundscaperDesktopProjectLibraryV11ProjectId(projectIdValue);
		const current = readSoundscaperDesktopProjectLibraryV11MetadataSnapshot(this.#database);
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
			throw new Error('Soundscaper V11 current project revision is missing or inconsistent');
		}
		const bytes = await readSoundscaperDesktopProjectLibraryV11File(
			this.paths.libraryRoot,
			`projects/${project.metadataFile}`,
			project.byteLength,
			project.sha256,
			signal,
		);
		const document = new TextDecoder().decode(bytes);
		if (document !== revision.document) {
			throw new Error('Soundscaper V11 project file disagrees with its immutable revision');
		}
		const bodyRows = this.#database.prepare(`
			SELECT body.descriptor_json AS descriptor
			FROM project_revision_bodies AS ownership
			JOIN managed_bodies AS body ON body.body_id = ownership.body_id
			WHERE ownership.project_id = ? AND ownership.project_revision = ?
			ORDER BY ownership.ordinal
		`).all(projectId, project.projectRevision) as Record<string, unknown>[];
		const bodies = Object.freeze(bodyRows.map(({ descriptor }) => {
			if (typeof descriptor !== 'string') throw new TypeError('Soundscaper V11 body descriptor is invalid');
			return validateSoundscaperDesktopProjectLibraryV11TransferBody(JSON.parse(descriptor) as unknown);
		}));
		return Object.freeze({ metadata: current.metadata, document, bodies });
	}

	async readBodyChunk(
		bodyValue: Readonly<SoundscaperDesktopProjectLibraryV11TransferBody>,
		optionsValue: Readonly<{ offset: number; length: number; signal?: AbortSignal }>,
	): Promise<Uint8Array> {
		this.#assertOperational();
		assertSoundscaperDesktopProjectLibraryV11DatabaseIdentity(this.#database);
		const body = validateSoundscaperDesktopProjectLibraryV11TransferBody(bodyValue);
		const options = snapshotAllowed(optionsValue, READ_FIELDS, ['offset', 'length'], 'Soundscaper V11 body read');
		const bodyId = body.bindingId;
		const row = this.#database.prepare(`
			SELECT descriptor_json AS descriptor, relative_file AS relativeFile,
				byte_length AS byteLength, sha256
			FROM managed_bodies WHERE body_id = ? AND state = 'published'
		`).get(bodyId) as Record<string, unknown> | undefined;
		if (!row || typeof row.descriptor !== 'string' || typeof row.relativeFile !== 'string') {
			throw new Error('Soundscaper V11 managed body is unavailable');
		}
		const persisted = validateSoundscaperDesktopProjectLibraryV11TransferBody(
			JSON.parse(row.descriptor) as unknown,
		);
		if (!sameSoundscaperDesktopProjectLibraryV11TransferBody(body, persisted)
			|| row.byteLength !== body.byteLength || row.sha256 !== body.sha256) {
			throw new Error('Soundscaper V11 managed body identity changed');
		}
		const signal = options.signal;
		if (signal !== undefined && !(signal instanceof AbortSignal)) {
			throw new TypeError('Soundscaper V11 body read signal is invalid');
		}
		return readSoundscaperDesktopProjectLibraryV11FileRange(
			this.paths.libraryRoot,
			`media/${row.relativeFile}`,
			body.byteLength,
			body.sha256,
			nonNegativeInteger(options.offset, 'body read offset'),
			positiveInteger(options.length, 'body read length'),
			signal as AbortSignal | undefined,
		);
	}

	/**
	 * Recovery rolls a journalled publication forward, so an abandoned one has to
	 * leave no journal row behind rather than a pending one the next recovery
	 * pass would make canonical. Only a publication that has not committed is
	 * rolled back: once its revision and metadata are in place the publication is
	 * atomic, and abandoning it there would break that guarantee. Materialized
	 * files are content-addressed and unreferenced without the journal row, so a
	 * later publication reuses or ignores them.
	 */
	async #abandon(
		transactionId: string,
		lease: SoundscaperDesktopProjectLibraryV11Lease,
		stages: readonly Readonly<SoundscaperDesktopProjectLibraryV11PublicationStage>[],
	): Promise<void> {
		if (this.#holdsLease(lease)) {
			this.#database.prepare(`
				DELETE FROM publication_journal
				WHERE transaction_id = ? AND state IN ('prepared', 'materialized')
			`).run(transactionId);
		}
		await cleanupSoundscaperDesktopProjectLibraryV11Stages(this.paths.libraryRoot, stages)
			.catch(() => undefined);
	}

	#holdsLease(lease: SoundscaperDesktopProjectLibraryV11Lease): boolean {
		try {
			assertSoundscaperDesktopProjectLibraryV11PublicationLease(this.#database, lease, this.#timestamp());
			return true;
		} catch { return false; }
	}

	#assertOperational(): void {
		this.#gate.assertOperational();
	}

	#assertPreflight(projectId: string, projectRevision: number): void {
		if (this.#database.prepare(`
			SELECT 1 AS pending FROM publication_journal
			WHERE state IN ('prepared', 'materialized', 'committed') LIMIT 1
		`).get()) throw new Error('Soundscaper V11 publication recovery is required');
		if (this.#database.prepare(`
			SELECT 1 AS pending FROM metadata_journal
			WHERE state IN ('prepared', 'committed') LIMIT 1
		`).get()) throw new Error('Soundscaper V11 metadata recovery is required before body publication');
		if (this.#database.prepare(`
			SELECT 1 AS occupied FROM project_revisions
			WHERE project_id = ? AND project_revision = ?
		`).get(projectId, projectRevision)) {
			throw new Error('Soundscaper V11 next project revision is occupied');
		}
	}

	#exclusive<Result>(operation: () => Promise<Result>): Promise<Result> {
		if (this.#operationActive) return Promise.reject(new Error('Soundscaper V11 publication operation is busy'));
		this.#operationActive = true;
		let result: Promise<Result>;
		try { result = operation(); }
		catch (error) { this.#operationActive = false; return Promise.reject(error); }
		return result.finally(() => { this.#operationActive = false; });
	}

	#newId(): string {
		const value = this.#randomId();
		if (!ID.test(value)) throw new TypeError('Soundscaper V11 publication id generator is invalid');
		return value;
	}

	#timestamp(): number {
		return nonNegativeInteger(this.#now(), 'publication timestamp');
	}
}

function freezeRecovery(
	outcome: 'clean' | 'committed',
	publication: Readonly<{
		readonly bundle: Readonly<SoundscaperDesktopProjectLibraryV11TransferBundle>;
	}> | null,
): Readonly<SoundscaperDesktopProjectLibraryV11PublicationRecovery> {
	return Object.freeze({
		outcome,
		projectId: publication?.bundle.project.projectId ?? null,
		projectRevision: publication?.bundle.project.projectRevision ?? null,
		metadataRevision: publication?.bundle.metadataRevision ?? null,
	});
}

function snapshotOptions(value: unknown): Readonly<Record<typeof CREATE_FIELDS[number], unknown>> {
	return snapshotAllowed(value, CREATE_FIELDS, ['database', 'appDataPath'], 'Soundscaper V11 publication options');
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
		throw new RangeError(`Soundscaper V11 ${label} must be a non-negative safe integer`);
	}
	return value;
}

function positiveInteger(value: unknown, label: string): number {
	const result = nonNegativeInteger(value, label);
	if (result === 0) throw new RangeError(`Soundscaper V11 ${label} must be positive`);
	return result;
}

function throwIfAborted(signal?: AbortSignal): void { signal?.throwIfAborted(); }
