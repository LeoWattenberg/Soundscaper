/* SPDX-License-Identifier: AGPL-3.0-only */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

import type { EditorProjectRuntimeProfile } from '../common/editor/project-runtime-profile.ts';
import { isStrictlyHigherProjectRevision } from '../common/editor/project-revision-cas.ts';
import {
	type FramescaperDesktopV12BodyStore,
} from './desktop-project-library-v12-body-transfer.ts';
import {
	acquireFramescaperDesktopV28Bodies,
	prepareFramescaperDesktopV28PublicationBodies,
	uploadFramescaperDesktopV28PublicationBodies,
	validateFramescaperDesktopV28Bodies,
	type FramescaperDesktopV28BodyDescriptor,
} from './desktop-project-library-v28-body-transfer.ts';
import { assertFramescaperProjectV28Profile } from './editor-project-runtime-profile-v28.ts';
import { framescaperProjectStoreAuthorityV28 } from './editor-project-store-v28.ts';
import { cloneFramescaperProjectV28, type FramescaperProjectV28 } from './editor-project-v28.ts';

const GLOBAL_NAME = 'framescaperDesktop';
const API_FIELDS = [
	'connect', 'handshakeState', 'listProjects', 'readProjectBundle', 'readBodyChunk',
	'beginPublication', 'writePublicationChunk', 'finishPublication', 'abortPublication',
	'deleteProject', 'duplicateProject',
] as const;
const HANDSHAKE_FIELDS = [
	'kind', 'version', 'owner', 'projectSchemaVersion', 'scapeFormatVersions',
	'attachedScapeFormatVersion', 'storageDatabaseName', 'desktopLibrarySchemaVersion',
	'desktopDatabaseUserVersion', 'desktopLibraryScope',
] as const;
const BUNDLE_FIELDS = ['metadataRevision', 'project', 'document', 'bodies'] as const;
const ROW_FIELDS = [
	'id', 'projectId', 'name', 'metadataFile', 'preferredProduct', 'updatedAtMs',
	'projectSchemaVersion', 'projectRevision', 'byteLength', 'sha256',
] as const;
const CATALOG_FIELDS = ['metadataRevision', 'projects'] as const;
const SUMMARY_FIELDS = ['id', 'title', 'revision', 'updatedAt'] as const;
const DIGEST = /^[a-f0-9]{64}$/u;
const IDENTITY = Object.freeze({
	label: 'Framescaper desktop V19', librarySchemaVersion: 19,
	databaseUserVersion: 21, scopeVersion: 'v19', projectSchemaVersion: 28,
});

interface V19Bridge {
	connect(): Promise<unknown>;
	handshakeState(): unknown;
	listProjects(): Promise<unknown>;
	readProjectBundle(projectId: string): Promise<unknown>;
	readBodyChunk(request: unknown): Promise<unknown>;
	beginPublication(request: unknown): Promise<unknown>;
	writePublicationChunk(request: unknown): Promise<unknown>;
	finishPublication(request: unknown): Promise<unknown>;
	abortPublication(request: unknown): Promise<unknown>;
	deleteProject(request: unknown): Promise<unknown>;
	duplicateProject(request: unknown): Promise<unknown>;
}

interface V19ProjectRow {
	readonly projectId: string;
	readonly name: string;
	readonly updatedAtMs: number;
	readonly projectRevision: number;
	readonly byteLength: number;
	readonly sha256: string;
}

interface V19Bundle {
	readonly metadataRevision: number;
	readonly project: Readonly<V19ProjectRow>;
	readonly document: string;
	readonly bodies: readonly Readonly<FramescaperDesktopV28BodyDescriptor>[];
}

type V19Store = FramescaperDesktopV12BodyStore & Readonly<{ databaseName: string }>;

export interface FramescaperDesktopProjectLibraryV19ProjectSummary {
	readonly id: string;
	readonly title: string;
	readonly revision: number;
	readonly updatedAt: string;
}

export interface FramescaperDesktopProjectLibraryV19Renderer {
	listProjects(): Promise<readonly Readonly<FramescaperDesktopProjectLibraryV19ProjectSummary>[]>;
	readProject(projectId: string, options?: Readonly<{ signal?: AbortSignal }>): Promise<FramescaperProjectV28 | null>;
	publishProject(request: Readonly<{
		readonly project: unknown;
		readonly signal?: AbortSignal;
		readonly beforeFinish?: () => PromiseLike<void> | void;
	}>): Promise<FramescaperProjectV28>;
	deleteProject(projectId: string): Promise<void>;
	duplicateProject(sourceProjectId: string, options: Readonly<{
		readonly id: string;
		readonly title: string;
		readonly timestamp: string;
	}>): Promise<FramescaperProjectV28>;
}

const RENDERER_COMPOSITIONS = new WeakMap<object, Readonly<{
	profile: EditorProjectRuntimeProfile;
	store: object;
}>>();

/** Connect the selected pathless public bridge to one exact durable V28 browser shadow. */
export async function connectFramescaperDesktopProjectLibraryV19Renderer(
	profileValue: EditorProjectRuntimeProfile | unknown,
	storeValue: unknown,
): Promise<FramescaperDesktopProjectLibraryV19Renderer | null> {
	assertFramescaperProjectV28Profile(profileValue);
	const store = durableStore(profileValue, storeValue);
	const bridge = resolveBridge();
	if (!bridge) return null;
	const handshake = await bridge.connect();
	validateHandshake(handshake, store.databaseName);
	if (bridge.handshakeState() !== 'admitted') {
		throw new TypeError('The Framescaper desktop V19 bridge did not retain its admitted handshake.');
	}
	const renderer = Object.freeze(new Renderer(profileValue, bridge, store));
	RENDERER_COMPOSITIONS.set(renderer, Object.freeze({ profile: profileValue, store: storeValue as object }));
	return renderer;
}

export function assertFramescaperDesktopProjectLibraryV19RendererComposition(
	profileValue: EditorProjectRuntimeProfile | unknown,
	store: unknown,
	renderer: unknown,
): asserts renderer is FramescaperDesktopProjectLibraryV19Renderer {
	assertFramescaperProjectV28Profile(profileValue);
	const composition = RENDERER_COMPOSITIONS.get(renderer as object);
	if (!composition || composition.profile !== profileValue || composition.store !== store) {
		throw new TypeError('The exact admitted Framescaper desktop V19 renderer composition is required.');
	}
}

class Renderer implements FramescaperDesktopProjectLibraryV19Renderer {
	readonly #profile: EditorProjectRuntimeProfile;
	readonly #bridge: V19Bridge;
	readonly #store: V19Store;
	#tail: Promise<void> = Promise.resolve();

	constructor(profile: EditorProjectRuntimeProfile, bridge: V19Bridge, store: V19Store) {
		this.#profile = profile;
		this.#bridge = bridge;
		this.#store = store;
	}

	listProjects(): Promise<readonly Readonly<FramescaperDesktopProjectLibraryV19ProjectSummary>[]> {
		return this.#exclusive(async () => catalog(await this.#bridge.listProjects()).projects);
	}

	readProject(projectIdValue: string, options: Readonly<{ signal?: AbortSignal }> = {}) {
		const projectId = projectIdValue_(projectIdValue);
		return this.#exclusive(async () => {
			throwIfAborted(options.signal);
			const raw = await this.#bridge.readProjectBundle(projectId);
			throwIfAborted(options.signal);
			if (raw === null) return null;
			const snapshot = validateBundle(this.#profile, raw, projectId);
			await acquireFramescaperDesktopV28Bodies(
				snapshot.project, snapshot.bundle.project.sha256, snapshot.bundle.bodies,
				this.#bridge, this.#store, options.signal,
			);
			return snapshot.project;
		});
	}

	publishProject(request: Readonly<{
		readonly project: unknown;
		readonly signal?: AbortSignal;
		readonly beforeFinish?: () => PromiseLike<void> | void;
	}>): Promise<FramescaperProjectV28> {
		return this.#exclusive(async () => {
			const project = cloneFramescaperProjectV28(this.#profile, request.project);
			throwIfAborted(request.signal);
			const projectId = String(project.id);
			const [catalogSnapshot, currentRaw] = await Promise.all([
				this.#bridge.listProjects(),
				this.#bridge.readProjectBundle(projectId),
			]);
			const current = currentRaw === null ? null : validateBundle(this.#profile, currentRaw, projectId);
			if (current && !isStrictlyHigherProjectRevision(project.revision, current.project.revision)) {
				throw new Error('Framescaper desktop V19 publication requires a strictly higher revision.');
			}
			const metadataRevision = catalog(catalogSnapshot).metadataRevision;
			if (current && current.bundle.metadataRevision !== metadataRevision) {
				throw new Error('Framescaper desktop V19 catalog changed before publication.');
			}
			const projectSha256 = bytesToHex(sha256(new TextEncoder().encode(JSON.stringify(project))));
			const preparedBodies = await prepareFramescaperDesktopV28PublicationBodies(
				project, projectSha256, this.#store, request.signal,
			);
			const publicationId = randomPublicationId();
			let admitted = false;
			try {
				const admission = exactRecord(await this.#bridge.beginPublication({
					publicationId,
					expectedMetadataRevision: metadataRevision,
					expectedProject: current ? {
						projectRevision: current.project.revision,
						projectSha256: current.bundle.project.sha256,
					} : null,
					project,
					bodies: preparedBodies.map(({ descriptor }) => descriptor),
				}), ['publicationId', 'maximumChunkBytes', 'bodyCount'], 'V19 publication admission');
				if (admission.publicationId !== publicationId || admission.maximumChunkBytes !== 4 * 1024 * 1024
					|| admission.bodyCount !== preparedBodies.length) {
					throw new Error('Framescaper V19 publication admission changed.');
				}
				admitted = true;
				await uploadFramescaperDesktopV28PublicationBodies(
					publicationId, preparedBodies, this.#bridge, this.#store, request.signal,
				);
				throwIfAborted(request.signal);
				if (request.beforeFinish) await request.beforeFinish();
				throwIfAborted(request.signal);
				const result = validateBundle(
					this.#profile, await this.#bridge.finishPublication({ publicationId }), projectId,
				);
				if (JSON.stringify(result.project) !== JSON.stringify(project)) {
					throw new Error('Framescaper V19 publication readback changed the project.');
				}
				return result.project;
			} catch (error) {
				if (admitted) await this.#bridge.abortPublication({ publicationId }).catch(() => false);
				throw error;
			}
		});
	}

	deleteProject(projectIdValue: string): Promise<void> {
		const projectId = projectIdValue_(projectIdValue);
		return this.#exclusive(async () => {
			const raw = await this.#bridge.readProjectBundle(projectId);
			if (raw === null) return;
			const current = validateBundle(this.#profile, raw, projectId);
			const result = exactRecord(await this.#bridge.deleteProject({
				projectId,
				expectedMetadataRevision: current.bundle.metadataRevision,
				expectedProject: {
					projectRevision: current.project.revision,
					projectSha256: current.bundle.project.sha256,
				},
			}), ['projectId', 'metadataRevision', 'deleted'], 'V19 delete result');
			if (result.projectId !== projectId || result.deleted !== true) {
				throw new Error('Framescaper V19 delete acknowledgement changed.');
			}
		});
	}

	duplicateProject(sourceProjectId: string, options: Readonly<{
		readonly id: string; readonly title: string; readonly timestamp: string;
	}>): Promise<FramescaperProjectV28> {
		return this.#exclusive(async () => {
			const sourceId = projectIdValue_(sourceProjectId);
			const raw = await this.#bridge.readProjectBundle(sourceId);
			if (raw === null) throw new Error('Framescaper V19 duplicate source is unavailable.');
			const source = validateBundle(this.#profile, raw, sourceId);
			const result = await this.#bridge.duplicateProject({
				sourceProjectId: sourceId,
				copyProjectId: projectIdValue_(options.id),
				title: options.title,
				timestamp: options.timestamp,
				expectedMetadataRevision: source.bundle.metadataRevision,
				expectedSource: {
					projectRevision: source.project.revision,
					projectSha256: source.bundle.project.sha256,
				},
			});
			const snapshot = validateBundle(this.#profile, result, options.id);
			await acquireFramescaperDesktopV28Bodies(
				snapshot.project, snapshot.bundle.project.sha256, snapshot.bundle.bodies,
				this.#bridge, this.#store,
			);
			return snapshot.project;
		});
	}

	#exclusive<Value>(operation: () => Promise<Value>): Promise<Value> {
		const result = this.#tail.then(operation, operation);
		this.#tail = result.then(() => undefined, () => undefined);
		return result;
	}
}

function resolveBridge(): V19Bridge | null {
	const descriptor = Object.getOwnPropertyDescriptor(globalThis, GLOBAL_NAME);
	if (!descriptor) return null;
	if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError('The Framescaper desktop global must be an own data property.');
	}
	const desktop = exactRecord(descriptor.value, ['v1'], 'Framescaper desktop bridge');
	if (!Object.isFrozen(descriptor.value)) throw new TypeError('The Framescaper desktop bridge must be frozen.');
	const v1 = recordWithOwnData(desktop.v1, 'Framescaper desktop v1 bridge');
	const projectLibrary = Object.getOwnPropertyDescriptor(v1, 'projectLibrary');
	if (!projectLibrary) return null;
	if (!projectLibrary.enumerable || !Object.hasOwn(projectLibrary, 'value')) {
		throw new TypeError('The Framescaper desktop project library must be an own data property.');
	}
	if (!Object.isFrozen(v1)) throw new TypeError('The Framescaper desktop v1 bridge must be frozen.');
	const api = exactRecord(projectLibrary.value, API_FIELDS, 'Framescaper desktop project-library bridge');
	if (!Object.isFrozen(projectLibrary.value)) {
		throw new TypeError('The Framescaper desktop project-library bridge must be frozen.');
	}
	for (const field of API_FIELDS) {
		if (typeof api[field] !== 'function') throw new TypeError(`The Framescaper desktop V19 bridge requires ${field}.`);
	}
	const target = projectLibrary.value as object;
	return Object.freeze(Object.fromEntries(API_FIELDS.map((field) => [
		field,
		(...args: unknown[]) => (api[field] as (...values: unknown[]) => unknown).apply(target, args),
	]))) as unknown as V19Bridge;
}

function recordWithOwnData(value: unknown, label: string): Readonly<Record<string, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
		throw new TypeError(`${label} must be a plain record.`);
	}
	for (const key of Reflect.ownKeys(value)) {
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (typeof key !== 'string' || !descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`${label} must contain only own data properties.`);
		}
	}
	return value as Readonly<Record<string, unknown>>;
}

function validateHandshake(value: unknown, databaseName: string): void {
	const handshake = exactRecord(value, HANDSHAKE_FIELDS, 'Framescaper desktop V19 handshake');
	if (handshake.kind !== 'framescaper-project-library-handshake' || handshake.version !== 1
		|| handshake.owner !== 'framescaper' || handshake.projectSchemaVersion !== IDENTITY.projectSchemaVersion
		|| handshake.attachedScapeFormatVersion !== 2 || handshake.storageDatabaseName !== databaseName
		|| handshake.desktopLibrarySchemaVersion !== IDENTITY.librarySchemaVersion
		|| handshake.desktopDatabaseUserVersion !== IDENTITY.databaseUserVersion
		|| JSON.stringify(handshake.scapeFormatVersions) !== '[1,2]'
		|| JSON.stringify(handshake.desktopLibraryScope)
			!== JSON.stringify(['kw.media', 'scape-project-library', IDENTITY.scopeVersion])) {
		throw new TypeError('The Framescaper desktop V19 handshake identity is unsupported.');
	}
}

function validateBundle(profile: EditorProjectRuntimeProfile, value: unknown, expectedProjectId: string): Readonly<{
	bundle: Readonly<V19Bundle>; project: FramescaperProjectV28;
}> {
	const raw = exactRecord(value, BUNDLE_FIELDS, 'Framescaper desktop V19 bundle');
	const row = projectRow(raw.project, expectedProjectId);
	if (typeof raw.document !== 'string') throw new TypeError('The Framescaper desktop V19 document is invalid.');
	const bytes = new TextEncoder().encode(raw.document);
	if (bytes.byteLength !== row.byteLength || bytesToHex(sha256(bytes)) !== row.sha256) {
		throw new Error('The Framescaper desktop V19 document changed bytes or digest.');
	}
	const project = cloneFramescaperProjectV28(profile, JSON.parse(raw.document) as unknown);
	if (project.id !== row.projectId || project.title !== row.name || project.revision !== row.projectRevision) {
		throw new Error('The Framescaper desktop V19 project disagrees with its descriptor.');
	}
	const bodies = validateFramescaperDesktopV28Bodies(project, row.sha256, raw.bodies);
	return Object.freeze({
		bundle: Object.freeze({
			metadataRevision: nonNegative(raw.metadataRevision, 'metadata revision'),
			project: row,
			document: raw.document,
			bodies,
		}),
		project,
	});
}

function projectRow(value: unknown, expectedProjectId: string): Readonly<V19ProjectRow> {
	const row = exactRecord(value, ROW_FIELDS, 'Framescaper desktop V19 project row');
	if (row.projectId !== projectIdValue_(expectedProjectId) || row.preferredProduct !== 'framescaper'
		|| row.projectSchemaVersion !== IDENTITY.projectSchemaVersion
		|| typeof row.sha256 !== 'string' || !DIGEST.test(row.sha256)) {
		throw new TypeError('The Framescaper desktop V19 project row is invalid.');
	}
	return Object.freeze({
		projectId: row.projectId,
		name: text(row.name, 'project name'),
		updatedAtMs: nonNegative(row.updatedAtMs, 'project timestamp'),
		projectRevision: nonNegative(row.projectRevision, 'project revision'),
		byteLength: positive(row.byteLength, 'project byte length'),
		sha256: row.sha256,
	});
}

function catalog(value: unknown): Readonly<{
	metadataRevision: number;
	projects: readonly Readonly<FramescaperDesktopProjectLibraryV19ProjectSummary>[];
}> {
	const raw = exactRecord(value, CATALOG_FIELDS, 'Framescaper desktop V19 catalog');
	if (!Array.isArray(raw.projects) || raw.projects.length > 10_000) throw new TypeError('The V19 catalog is invalid.');
	return Object.freeze({
		metadataRevision: nonNegative(raw.metadataRevision, 'metadata revision'),
		projects: Object.freeze(raw.projects.map((value) => {
			const summary = exactRecord(value, SUMMARY_FIELDS, 'Framescaper desktop V19 project summary');
			return Object.freeze({
				id: projectIdValue_(summary.id),
				title: text(summary.title, 'project title'),
				revision: nonNegative(summary.revision, 'project revision'),
				updatedAt: instant(summary.updatedAt),
			});
		})),
	});
}

function durableStore(profile: EditorProjectRuntimeProfile, value: unknown): V19Store {
	if (!value || typeof value !== 'object') throw new TypeError('The exact V28 shadow store is required.');
	framescaperProjectStoreAuthorityV28(profile, value);
	const record = value as Record<string, unknown>;
	const status = typeof record.getStatus === 'function'
		? (record.getStatus as () => unknown).call(value) as Record<string, unknown>
		: record;
	if (status?.persistent !== true) throw new Error('The desktop V19 lifecycle requires a durable V28 shadow.');
	const databaseName = typeof record.databaseName === 'string' ? record.databaseName : status.databaseName;
	if (databaseName !== 'kw-media-framescaper-editor-v28') {
		throw new TypeError('The exact V28 shadow database identity is required.');
	}
	const methods = Object.freeze(Object.fromEntries([
		'getMediaAssetMetadata', 'loadMediaAsset', 'beginMediaAssetWrite',
	].map((field) => {
		const method = inheritedData(value, field);
		if (typeof method !== 'function') throw new TypeError(`The exact V28 body store requires ${field}.`);
		return [field, (...args: unknown[]) => method.apply(value, args)];
	})));
	return Object.freeze({ databaseName, ...methods }) as unknown as V19Store;
}

function inheritedData(value: object, field: string): ((...args: unknown[]) => unknown) | undefined {
	let candidate: object | null = value;
	while (candidate) {
		const descriptor = Object.getOwnPropertyDescriptor(candidate, field);
		if (descriptor) return Object.hasOwn(descriptor, 'value')
			? descriptor.value as ((...args: unknown[]) => unknown) | undefined : undefined;
		candidate = Object.getPrototypeOf(candidate) as object | null;
	}
	return undefined;
}

function randomPublicationId(): string {
	const bytes = new Uint8Array(24);
	if (!globalThis.crypto?.getRandomValues) throw new Error('Web Crypto is required for V19 publication identities.');
	globalThis.crypto.getRandomValues(bytes);
	return bytesToHex(bytes);
}

function throwIfAborted(signal?: AbortSignal): void {
	if (signal?.aborted) throw signal.reason ?? new DOMException('The operation was aborted.', 'AbortError');
}

function projectIdValue_(value: unknown): string {
	if (typeof value !== 'string' || !/^[\x21-\x7e]{1,256}$/u.test(value)) {
		throw new TypeError('A bounded printable Framescaper desktop project id is required.');
	}
	return value;
}

function instant(value: unknown): string {
	const result = text(value, 'project timestamp');
	if (!Number.isFinite(Date.parse(result))) throw new TypeError('The Framescaper V19 project timestamp is invalid.');
	return result;
}

function text(value: unknown, label: string): string {
	if (typeof value !== 'string' || value.length < 1 || value.length > 4_096) {
		throw new TypeError(`The Framescaper V19 ${label} is invalid.`);
	}
	return value;
}

function nonNegative(value: unknown, label: string): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
		throw new RangeError(`The Framescaper V19 ${label} is invalid.`);
	}
	return value;
}

function positive(value: unknown, label: string): number {
	const result = nonNegative(value, label);
	if (result < 1) throw new RangeError(`The Framescaper V19 ${label} must be positive.`);
	return result;
}

function exactRecord<const Field extends string>(
	value: unknown,
	fields: readonly Field[],
	label: string,
): Readonly<Record<Field, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
		throw new TypeError(`${label} must be a plain record.`);
	}
	const keys = Reflect.ownKeys(value);
	if (keys.length !== fields.length
		|| keys.some((key) => typeof key !== 'string' || !fields.includes(key as Field))) {
		throw new TypeError(`${label} has unsupported fields.`);
	}
	const output = Object.create(null) as Record<Field, unknown>;
	for (const field of fields) output[field] = (value as Record<Field, unknown>)[field];
	return output;
}
