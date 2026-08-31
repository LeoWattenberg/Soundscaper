/* SPDX-License-Identifier: AGPL-3.0-only */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

import type { EditorProjectRuntimeProfile } from '../common/editor/project-runtime-profile.ts';
import { isStrictlyHigherProjectRevision } from '../common/editor/project-revision-cas.ts';
import { serializeScapeProjectDocument } from '../common/editor/scape-project-document.ts';
import {
	acquireFramescaperDesktopBodies,
	prepareFramescaperDesktopPublicationBodies,
	uploadFramescaperDesktopPublicationBodies,
	type FramescaperDesktopBodyBridge,
	type FramescaperDesktopBodyStore,
} from './desktop-project-library-body-transfer.ts';
import { validateFramescaperDesktopBodies, type FramescaperDesktopBodyDescriptor } from
	'./desktop-project-library-body-contract.ts';
import { FramescaperDesktopProjectLibraryCommittedError, FramescaperDesktopProjectLibraryIndeterminateError,
	reconcileFramescaperDesktopProjectLibraryCommit as reconcileCommitted } from
	'./desktop-project-library-errors.ts';
import {
	assertFramescaperDesktopPublicationBodyInventory,
	createFramescaperDesktopPublicationId,
	validateFramescaperDesktopPublicationAdmission,
} from './desktop-project-library-publication-admission.ts';
import {
	createFramescaperDesktopProjectLibraryShadow,
	type FramescaperDesktopProjectLibraryShadow,
} from './desktop-project-library-shadow.ts';
import { assertFramescaperProjectRuntimeProfile } from './editor-project-runtime-profile.ts';
import { framescaperProjectStoreAuthority } from './editor-project-store.ts';
import { cloneFramescaperProject, type FramescaperProject } from './editor-project.ts';

const GLOBAL_NAME = 'framescaperDesktop';
const API_FIELDS = [
	'connect', 'handshakeState', 'listProjects', 'readProjectBundle', 'readBodyChunk',
	'beginPublication', 'writePublicationChunk', 'finishPublication', 'abortPublication',
	'deleteProject', 'duplicateProject',
] as const;
const HANDSHAKE_FIELDS = [
	'kind', 'version', 'owner', 'schemaFamily', 'schemaVersion',
	'scapeFormatVersions', 'attachedScapeFormatVersion', 'storageDatabaseName',
	'desktopLibrarySchemaVersion', 'desktopDatabaseUserVersion', 'desktopLibraryScope',
] as const;
const BUNDLE_FIELDS = ['metadataRevision', 'project', 'document', 'bodies'] as const;
const ROW_FIELDS = [
	'id', 'projectId', 'name', 'metadataFile', 'preferredProduct', 'updatedAtMs',
	'schemaFamily', 'schemaVersion', 'projectRevision', 'byteLength', 'sha256',
] as const;
const CATALOG_FIELDS = ['metadataRevision', 'projects'] as const;
const SUMMARY_FIELDS = ['id', 'title', 'revision', 'updatedAt'] as const;
const DIGEST = /^[a-f0-9]{64}$/u;
const IDENTITY = Object.freeze({
	librarySchemaVersion: 1,
	databaseUserVersion: 1,
	schemaFamily: 'framescaper',
	schemaVersion: 1,
	databaseName: 'kw-media-framescaper-editor-v1',
	scope: Object.freeze(['kw.media', 'framescaper-project-library', 'v1']),
});

interface Bridge extends FramescaperDesktopBodyBridge {
	connect(): Promise<unknown>;
	handshakeState(): unknown;
	listProjects(): Promise<unknown>;
	readProjectBundle(projectId: string): Promise<unknown>;
	beginPublication(request: unknown): Promise<unknown>;
	finishPublication(request: unknown): Promise<unknown>;
	abortPublication(request: unknown): Promise<unknown>;
	deleteProject(request: unknown): Promise<unknown>;
	duplicateProject(request: unknown): Promise<unknown>;
}

interface ProjectRow {
	readonly projectId: string;
	readonly name: string;
	readonly updatedAtMs: number;
	readonly projectRevision: number;
	readonly byteLength: number;
	readonly sha256: string;
}

interface Bundle {
	readonly metadataRevision: number;
	readonly project: Readonly<ProjectRow>;
	readonly document: string;
	readonly bodies: readonly Readonly<FramescaperDesktopBodyDescriptor>[];
}

type Store = FramescaperDesktopBodyStore & Readonly<{
	databaseName: string;
	shadow: FramescaperDesktopProjectLibraryShadow;
}>;

export interface FramescaperDesktopProjectLibraryProjectSummary {
	readonly id: string;
	readonly title: string;
	readonly revision: number;
	readonly updatedAt: string;
}

interface RendererPublicationRequest {
	readonly project: unknown;
	readonly signal?: AbortSignal;
	readonly beforeFinish?: () => PromiseLike<void> | void;
}

export interface FramescaperDesktopProjectLibraryRenderer {
	listProjects(): Promise<readonly Readonly<FramescaperDesktopProjectLibraryProjectSummary>[]>;
	readProject(projectId: string, options?: Readonly<{ signal?: AbortSignal }>): Promise<FramescaperProject | null>;
	createScapeProjectIfAbsent(project: unknown): Promise<FramescaperProject | null>;
	publishProject(request: Readonly<RendererPublicationRequest>): Promise<FramescaperProject>;
	publishProjectIfCurrent(expected: unknown, project: unknown): Promise<FramescaperProject | null>;
	deleteProject(projectId: string): Promise<void>;
	deleteProjectIfCurrent(project: unknown): Promise<boolean>;
	duplicateProject(sourceProjectId: string, options: Readonly<{
		readonly id: string;
		readonly title: string;
		readonly timestamp: string;
	}>): Promise<FramescaperProject>;
}

const RENDERER_COMPOSITIONS = new WeakMap<object, Readonly<{
	profile: EditorProjectRuntimeProfile;
	store: object;
}>>();

export async function connectFramescaperDesktopProjectLibraryRenderer(
	profileValue: EditorProjectRuntimeProfile | unknown,
	storeValue: unknown,
): Promise<FramescaperDesktopProjectLibraryRenderer | null> {
	assertFramescaperProjectRuntimeProfile(profileValue);
	const store = durableStore(profileValue, storeValue);
	const bridge = resolveBridge();
	if (!bridge) return null;
	const handshake = await bridge.connect();
	validateHandshake(handshake, store.databaseName);
	if (bridge.handshakeState() !== 'admitted') {
		throw new TypeError('The Framescaper desktop bridge did not retain its admitted handshake.');
	}
	const renderer = Object.freeze(new Renderer(profileValue, bridge, store));
	RENDERER_COMPOSITIONS.set(renderer, Object.freeze({
		profile: profileValue,
		store: storeValue as object,
	}));
	return renderer;
}

export function assertFramescaperDesktopProjectLibraryRendererComposition(
	profileValue: EditorProjectRuntimeProfile | unknown,
	store: unknown,
	renderer: unknown,
): asserts renderer is FramescaperDesktopProjectLibraryRenderer {
	assertFramescaperProjectRuntimeProfile(profileValue);
	const composition = RENDERER_COMPOSITIONS.get(renderer as object);
	if (!composition || composition.profile !== profileValue || composition.store !== store) {
		throw new TypeError('The exact admitted Framescaper desktop renderer composition is required.');
	}
}

class Renderer implements FramescaperDesktopProjectLibraryRenderer {
	readonly #profile: EditorProjectRuntimeProfile;
	readonly #bridge: Bridge;
	readonly #store: Store;
	#tail: Promise<void> = Promise.resolve();

	constructor(profile: EditorProjectRuntimeProfile, bridge: Bridge, store: Store) {
		this.#profile = profile;
		this.#bridge = bridge;
		this.#store = store;
	}

	listProjects(): Promise<readonly Readonly<FramescaperDesktopProjectLibraryProjectSummary>[]> {
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
			await acquireFramescaperDesktopBodies(
				snapshot.project,
				snapshot.bundle.project.sha256,
				snapshot.bundle.bodies,
				this.#bridge,
				this.#store,
				options.signal,
			);
			return this.#store.shadow.reconcileCommittedProject(snapshot.project, options.signal);
		});
	}

	publishProject(request: Readonly<RendererPublicationRequest>): Promise<FramescaperProject> {
		return this.#publishProject(request);
	}

	createScapeProjectIfAbsent(projectValue: unknown): Promise<FramescaperProject | null> {
		const project = cloneFramescaperProject(this.#profile, projectValue);
		if (project.revision !== 0) {
			throw new Error('Framescaper desktop Scape creation requires revision zero.');
		}
		return this.#publishProject({ project }, undefined, true);
	}

	publishProjectIfCurrent(expectedValue: unknown, projectValue: unknown): Promise<FramescaperProject | null> {
		const expected = cloneFramescaperProject(this.#profile, expectedValue);
		return this.#publishProject({ project: projectValue }, expected);
	}

	#publishProject(request: Readonly<RendererPublicationRequest>): Promise<FramescaperProject>;
	#publishProject(
		request: Readonly<RendererPublicationRequest>, expected: FramescaperProject,
	): Promise<FramescaperProject | null>;
	#publishProject(
		request: Readonly<RendererPublicationRequest>, expected: undefined, requireAbsent: true,
	): Promise<FramescaperProject | null>;
	#publishProject(
		request: Readonly<RendererPublicationRequest>, expected?: FramescaperProject, requireAbsent = false,
	): Promise<FramescaperProject | null> {
		return this.#exclusive(async () => {
			const project = cloneFramescaperProject(this.#profile, request.project);
			throwIfAborted(request.signal);
			const projectId = String(project.id);
			if (expected && String(expected.id) !== projectId) {
				throw new Error('Framescaper desktop conditional publication requires one project identity.');
			}
			const [catalogSnapshot, currentRaw] = await Promise.all([
				this.#bridge.listProjects(),
				this.#bridge.readProjectBundle(projectId),
			]);
			const current = currentRaw === null ? null : validateBundle(this.#profile, currentRaw, projectId);
			if (requireAbsent && current) return null;
			if (expected && (!current || !sameFramescaperDesktopProject(current.project, expected))) return null;
			if (current && !isStrictlyHigherProjectRevision(project.revision, current.project.revision)) {
				throw new Error('Framescaper desktop publication requires a strictly higher revision.');
			}
			const metadataRevision = catalog(catalogSnapshot).metadataRevision;
			if (current && current.bundle.metadataRevision !== metadataRevision) {
				throw new Error('Framescaper desktop catalog changed before publication.');
			}
			const projectSha256 = bytesToHex(sha256(new TextEncoder().encode(JSON.stringify(project))));
			const bodyInventory = await prepareFramescaperDesktopPublicationBodies(
				project, projectSha256, this.#store, request.signal, () => false,
			);
			const publicationId = createFramescaperDesktopPublicationId();
			let admitted = false;
			let finished = false;
			let finishing = false;
			try {
				const admission = validateFramescaperDesktopPublicationAdmission(
					await this.#bridge.beginPublication({
					publicationId,
					expectedMetadataRevision: metadataRevision,
					expectedProject: current ? {
						projectRevision: current.project.revision,
						projectSha256: current.bundle.project.sha256,
					} : null,
					project,
					bodies: bodyInventory.map(({ descriptor }) => descriptor),
				}), publicationId, bodyInventory.length);
				admitted = true;
				const requiredBodyIndexes = new Set(admission.requiredBodyIndexes);
				const preparedBodies = admission.requiredBodyIndexes.length === 0 ? bodyInventory
					: await prepareFramescaperDesktopPublicationBodies(
						project, projectSha256, this.#store, request.signal,
						(_descriptor, bodyIndex) => requiredBodyIndexes.has(bodyIndex),
					);
				assertFramescaperDesktopPublicationBodyInventory(bodyInventory, preparedBodies);
				await uploadFramescaperDesktopPublicationBodies(
					publicationId, preparedBodies, this.#bridge, this.#store, request.signal,
				);
				throwIfAborted(request.signal);
				if (request.beforeFinish) await request.beforeFinish();
				throwIfAborted(request.signal);
				finishing = true;
				const rawResult = await this.#bridge.finishPublication({ publicationId });
				finished = true;
				const result = validateBundle(this.#profile, rawResult, projectId);
				if (JSON.stringify(result.project) !== JSON.stringify(project)) {
					throw new Error('Framescaper publication readback changed the project.');
				}
				return await this.#store.shadow.reconcileCommittedProject(result.project);
			} catch (error) {
				if (admitted && !finished) {
					await this.#bridge.abortPublication({ publicationId }).catch(() => false);
				}
				if (finished) {
					throw new FramescaperDesktopProjectLibraryCommittedError(
						'publication', projectId, error,
					);
				}
				if (finishing) {
					throw new FramescaperDesktopProjectLibraryIndeterminateError(
						'publication', projectId, error,
					);
				}
				throw error;
			}
		});
	}

	deleteProject(projectIdValue: string): Promise<void> {
		const projectId = projectIdValue_(projectIdValue);
		return this.#exclusive(async () => {
			const raw = await this.#bridge.readProjectBundle(projectId);
			if (raw === null) {
				await this.#store.shadow.deleteCommittedProject(projectId);
				return;
			}
			await this.#deleteCurrentProject(projectId, validateBundle(this.#profile, raw, projectId));
		});
	}

	deleteProjectIfCurrent(projectValue: unknown): Promise<boolean> {
		const expected = cloneFramescaperProject(this.#profile, projectValue);
		const projectId = projectIdValue_(String(expected.id));
		return this.#exclusive(async () => {
			const raw = await this.#bridge.readProjectBundle(projectId);
			if (raw === null) return false;
			const current = validateBundle(this.#profile, raw, projectId);
			if (!sameFramescaperDesktopProject(current.project, expected)) return false;
			await this.#deleteCurrentProject(projectId, current);
			return true;
		});
	}
	duplicateProject(sourceProjectId: string, options: Readonly<{
		readonly id: string;
		readonly title: string;
		readonly timestamp: string;
	}>): Promise<FramescaperProject> {
		return this.#exclusive(async () => {
			const sourceId = projectIdValue_(sourceProjectId);
			const raw = await this.#bridge.readProjectBundle(sourceId);
			if (raw === null) throw new Error('Framescaper duplicate source is unavailable.');
			const source = validateBundle(this.#profile, raw, sourceId);
			const result = await this.#bridge.duplicateProject({
				sourceProjectId: sourceId,
				copyProjectId: projectIdValue_(options.id),
				title: text(options.title, 'project title'),
				timestamp: instant(options.timestamp),
				expectedMetadataRevision: source.bundle.metadataRevision,
				expectedSource: {
					projectRevision: source.project.revision,
					projectSha256: source.bundle.project.sha256,
				},
			});
			return reconcileCommitted('duplicate', options.id, async () => {
				const snapshot = validateBundle(this.#profile, result, options.id);
				await acquireFramescaperDesktopBodies(
					snapshot.project,
					snapshot.bundle.project.sha256,
					snapshot.bundle.bodies,
					this.#bridge,
					this.#store,
				);
				return this.#store.shadow.reconcileCommittedProject(snapshot.project);
			});
		});
	}

	#exclusive<Value>(operation: () => Promise<Value>): Promise<Value> {
		const result = this.#tail.then(operation, operation);
		this.#tail = result.then(() => undefined, () => undefined);
		return result;
	}

	async #deleteCurrentProject(projectId: string, current: Readonly<{
		readonly project: FramescaperProject;
		readonly bundle: Bundle;
	}>): Promise<void> {
		const result = exactRecord(await this.#bridge.deleteProject({
			projectId,
			expectedMetadataRevision: current.bundle.metadataRevision,
			expectedProject: {
				projectRevision: current.project.revision,
				projectSha256: current.bundle.project.sha256,
			},
		}), ['projectId', 'metadataRevision', 'deleted'], 'delete result');
		if (result.projectId !== projectId || result.deleted !== true) {
			throw new Error('Framescaper delete acknowledgement changed.');
		}
		await reconcileCommitted('delete', projectId, () => this.#store.shadow.deleteCommittedProject(projectId));
	}
}

function sameFramescaperDesktopProject(left: FramescaperProject, right: FramescaperProject): boolean {
	return serializeScapeProjectDocument(left) === serializeScapeProjectDocument(right);
}

function resolveBridge(): Bridge | null {
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
		if (typeof api[field] !== 'function') {
			throw new TypeError(`The Framescaper desktop bridge requires ${field}.`);
		}
	}
	const target = projectLibrary.value as object;
	return Object.freeze(Object.fromEntries(API_FIELDS.map((field) => [
		field,
		(...args: unknown[]) => (api[field] as (...values: unknown[]) => unknown).apply(target, args),
	]))) as unknown as Bridge;
}

function validateHandshake(value: unknown, databaseName: string): void {
	const handshake = exactRecord(value, HANDSHAKE_FIELDS, 'Framescaper desktop handshake');
	if (handshake.kind !== 'framescaper-project-library-handshake' || handshake.version !== 1
		|| handshake.owner !== 'framescaper'
		|| handshake.schemaFamily !== IDENTITY.schemaFamily
		|| handshake.schemaVersion !== IDENTITY.schemaVersion
		|| handshake.attachedScapeFormatVersion !== 1
		|| handshake.storageDatabaseName !== databaseName
		|| handshake.desktopLibrarySchemaVersion !== IDENTITY.librarySchemaVersion
		|| handshake.desktopDatabaseUserVersion !== IDENTITY.databaseUserVersion
		|| JSON.stringify(handshake.scapeFormatVersions) !== '[1]'
		|| JSON.stringify(handshake.desktopLibraryScope) !== JSON.stringify(IDENTITY.scope)) {
		throw new TypeError('The Framescaper desktop handshake identity is unsupported.');
	}
}

function validateBundle(
	profile: EditorProjectRuntimeProfile,
	value: unknown,
	expectedProjectId: string,
): Readonly<{ bundle: Readonly<Bundle>; project: FramescaperProject }> {
	const raw = exactRecord(value, BUNDLE_FIELDS, 'Framescaper desktop bundle');
	const row = projectRow(raw.project, expectedProjectId);
	if (typeof raw.document !== 'string') throw new TypeError('The Framescaper desktop document is invalid.');
	const bytes = new TextEncoder().encode(raw.document);
	if (bytes.byteLength !== row.byteLength || bytesToHex(sha256(bytes)) !== row.sha256) {
		throw new Error('The Framescaper desktop document changed bytes or digest.');
	}
	const project = cloneFramescaperProject(profile, JSON.parse(raw.document) as unknown);
	if (project.id !== row.projectId || project.title !== row.name || project.revision !== row.projectRevision) {
		throw new Error('The Framescaper desktop project disagrees with its descriptor.');
	}
	const bodies = validateFramescaperDesktopBodies(project, row.sha256, raw.bodies);
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

function projectRow(value: unknown, expectedProjectId: string): Readonly<ProjectRow> {
	const row = exactRecord(value, ROW_FIELDS, 'Framescaper desktop project row');
	if (row.projectId !== projectIdValue_(expectedProjectId)
		|| row.preferredProduct !== 'framescaper'
		|| row.schemaFamily !== IDENTITY.schemaFamily
		|| row.schemaVersion !== IDENTITY.schemaVersion
		|| typeof row.sha256 !== 'string' || !DIGEST.test(row.sha256)) {
		throw new TypeError('The Framescaper desktop project row is invalid.');
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
	projects: readonly Readonly<FramescaperDesktopProjectLibraryProjectSummary>[];
}> {
	const raw = exactRecord(value, CATALOG_FIELDS, 'Framescaper desktop catalog');
	if (!Array.isArray(raw.projects) || raw.projects.length > 10_000) {
		throw new TypeError('The Framescaper desktop catalog is invalid.');
	}
	return Object.freeze({
		metadataRevision: nonNegative(raw.metadataRevision, 'metadata revision'),
		projects: Object.freeze(raw.projects.map((value) => {
			const summary = exactRecord(value, SUMMARY_FIELDS, 'Framescaper desktop project summary');
			return Object.freeze({
				id: projectIdValue_(summary.id),
				title: text(summary.title, 'project title'),
				revision: nonNegative(summary.revision, 'project revision'),
				updatedAt: instant(summary.updatedAt),
			});
		})),
	});
}

function durableStore(profile: EditorProjectRuntimeProfile, value: unknown): Store {
	if (!value || typeof value !== 'object') {
		throw new TypeError('The exact Framescaper shadow store is required.');
	}
	framescaperProjectStoreAuthority(profile, value);
	const record = value as Record<string, unknown>;
	const status = typeof record.getStatus === 'function'
		? (record.getStatus as () => unknown).call(value) as Record<string, unknown>
		: record;
	if (status?.persistent !== true) {
		throw new Error('The Framescaper desktop lifecycle requires a durable shadow.');
	}
	const databaseName = typeof record.databaseName === 'string' ? record.databaseName : status.databaseName;
	if (databaseName !== IDENTITY.databaseName) {
		throw new TypeError('The exact Framescaper v1 shadow database identity is required.');
	}
	const methods = Object.freeze(Object.fromEntries([
		'getMediaAssetMetadata', 'loadMediaAsset', 'beginMediaAssetWrite',
	].map((field) => {
		const method = inheritedData(value, field);
		if (typeof method !== 'function') {
			throw new TypeError(`The exact Framescaper body store requires ${field}.`);
		}
		return [field, (...args: unknown[]) => method.apply(value, args)];
	})));
	return Object.freeze({
		databaseName,
		...methods,
		shadow: createFramescaperDesktopProjectLibraryShadow(profile, value),
	}) as unknown as Store;
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
	if (!Number.isFinite(Date.parse(result))) throw new TypeError('The Framescaper project timestamp is invalid.');
	return result;
}

function text(value: unknown, label: string): string {
	if (typeof value !== 'string' || value.length < 1 || value.length > 4_096) {
		throw new TypeError(`The Framescaper ${label} is invalid.`);
	}
	return value;
}

function nonNegative(value: unknown, label: string): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
		throw new RangeError(`The Framescaper ${label} is invalid.`);
	}
	return value;
}

function positive(value: unknown, label: string): number {
	const result = nonNegative(value, label);
	if (result < 1) throw new RangeError(`The Framescaper ${label} must be positive.`);
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
	for (const field of fields) {
		const descriptor = Object.getOwnPropertyDescriptor(value, field);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`${label}.${field} must be an own data property.`);
		}
		output[field] = descriptor.value;
	}
	return output;
}
