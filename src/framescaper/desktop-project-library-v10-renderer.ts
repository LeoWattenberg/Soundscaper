/* SPDX-License-Identifier: AGPL-3.0-only */

import { throwIfScapeAborted } from '../common/editor/scape-abort.ts';
import type { EditorProjectRuntimeProfile } from '../common/editor/project-runtime-profile.ts';
import { isStrictlyHigherProjectRevision } from '../common/editor/project-revision-cas.ts';
import { serializeScapeProjectDocument } from '../common/editor/scape-project-document.ts';
import { assertFramescaperProjectV18Profile } from './editor-project-v18-profile.ts';
import { cloneFramescaperProjectV18, type FramescaperProjectV18 } from './editor-project-v18.ts';
import {
	FRAMESCAPER_DESKTOP_V10_MAXIMUM_CHUNK_BYTES,
	framescaperDesktopV10BodiesForProject,
	resolveFramescaperDesktopV10RendererBridge,
	snapshotFramescaperDesktopV10Project,
	validateFramescaperDesktopV10Abort,
	validateFramescaperDesktopV10Acknowledgement,
	validateFramescaperDesktopV10Admission,
	validateFramescaperDesktopV10Bundle,
	validateFramescaperDesktopV10CatalogSnapshot,
	validateFramescaperDesktopV10ProjectId,
	validateFramescaperDesktopV10RendererHandshake,
	type FramescaperDesktopV10Body,
	type FramescaperDesktopV10BundleSnapshot,
	type FramescaperDesktopV10ProjectSummary,
	type FramescaperDesktopV10RendererBridge,
} from './desktop-project-library-v10-renderer-contract.ts';
import {
	framescaperDesktopV10ArchiveEntries,
	framescaperDesktopV10ArchiveManifest,
} from './desktop-project-library-v10-archive-projection.ts';
import {
	FramescaperDesktopProjectLibraryV10CommittedError,
	FramescaperDesktopProjectLibraryV10IndeterminateError,
	FramescaperDesktopV10RendererCatalog,
	type FramescaperDesktopV10RawShadowProjectStore,
} from './desktop-project-library-v10-renderer-catalog.ts';
import {
	createFramescaperDesktopV10PublicationId,
	createFramescaperDesktopV10RendererOperationId,
	FramescaperDesktopV10WitnessLedger,
	type FramescaperDesktopV10DuplicateOptions,
} from './desktop-project-library-v10-renderer-lifecycle.ts';
import {
	FramescaperDesktopV10DeleteIntents,
	reconcileFramescaperDesktopV10DeleteIntents,
	type FramescaperDesktopV10DeleteIntentStore,
} from './desktop-project-library-v10-delete-intents.ts';
import {
	FramescaperScapeArchiveV18,
	type FramescaperScapeArchiveBodyStoreV18,
} from './scape-project-preservation-v18.ts';

export interface FramescaperDesktopProjectLibraryV10RendererComposition {
	readonly store: FramescaperDesktopProjectLibraryV10ShadowStore;
	readonly archive: FramescaperScapeArchiveV18;
}

export interface FramescaperDesktopProjectLibraryV10ShadowStore extends
	FramescaperScapeArchiveBodyStoreV18, FramescaperDesktopV10RawShadowProjectStore {
	loadProject(
		projectId: string,
		options?: Readonly<{ revision?: number; signal?: AbortSignal }>,
	): PromiseLike<unknown> | unknown;
	getStatus(): unknown;
	readonly settingsRepository: FramescaperDesktopV10DeleteIntentStore;
	readonly linkedOriginalStoreService: Readonly<{
		deleteProject<Value>(projectId: string, operation: () => PromiseLike<Value> | Value): Promise<Value>;
	}>;
}

export interface FramescaperDesktopProjectLibraryV10Renderer {
	listProjects(): Promise<readonly Readonly<FramescaperDesktopV10ProjectSummary>[]>;
	readProject(projectId: string, options?: Readonly<{ signal?: AbortSignal }>): Promise<FramescaperProjectV18 | null>;
	publishProject(request: Readonly<{
		readonly project: unknown;
		readonly signal?: AbortSignal;
		readonly beforeFinish?: () => PromiseLike<void> | void;
	}> | unknown):
		Promise<FramescaperProjectV18>;
	deleteProject(projectId: string): Promise<void>;
	cleanupDeletedProject(projectId: string): Promise<boolean>;
	settleDeletedProject(projectId: string): Promise<boolean>;
	duplicateProject(
		sourceProjectId: string,
		options: Readonly<FramescaperDesktopV10DuplicateOptions>,
	): Promise<FramescaperProjectV18>;
}

const RENDERER_COMPOSITIONS = new WeakMap<object, Readonly<{
	readonly profile: EditorProjectRuntimeProfile;
	readonly store: FramescaperDesktopProjectLibraryV10ShadowStore;
}>>();

export {
	FramescaperDesktopProjectLibraryV10CommittedError,
	FramescaperDesktopProjectLibraryV10IndeterminateError,
} from './desktop-project-library-v10-renderer-catalog.ts';

const COMPOSITION_FIELDS = ['store', 'archive'] as const;
const PUBLICATION_REQUIRED_FIELDS = ['project'] as const;
const PUBLICATION_OPTIONAL_FIELDS = ['signal', 'beforeFinish'] as const;
const SIGNAL_FIELDS = ['signal'] as const;

/** Connect the packaged V10 bridge only to one already-authenticated V18 shadow/archive pair. */
export async function connectFramescaperDesktopProjectLibraryV10Renderer(
	profileValue: EditorProjectRuntimeProfile | unknown,
	compositionValue: FramescaperDesktopProjectLibraryV10RendererComposition | unknown,
): Promise<FramescaperDesktopProjectLibraryV10Renderer | null> {
	assertFramescaperProjectV18Profile(profileValue);
	const profile = profileValue;
	const composition = allowedRecord(
		compositionValue, COMPOSITION_FIELDS, [], 'Framescaper desktop V10 renderer composition',
	);
	const store = composition.store as FramescaperDesktopProjectLibraryV10ShadowStore;
	const archive = composition.archive;
	if (!(archive instanceof FramescaperScapeArchiveV18)) {
		throw new TypeError('The exact Framescaper V18 archive is required for desktop reconciliation.');
	}
	archive.assertComposition(profile, store);
	const rawRepository = ownData(store, 'projectRepository', 'Framescaper V18 shadow store');
	if (typeof store.loadProject !== 'function' || !rawRepository || typeof rawRepository !== 'object'
		|| typeof inheritedData(rawRepository, 'deleteExact') !== 'function') {
		throw new TypeError('The exact Framescaper V18 shadow project store is required.');
	}
	const bridge = resolveFramescaperDesktopV10RendererBridge();
	if (!bridge) return null;
	const settingsRepository = ownData(store, 'settingsRepository', 'Framescaper V18 shadow store');
	const lifecycle = ownData(store, 'linkedOriginalStoreService', 'Framescaper V18 shadow store');
	if (!settingsRepository || typeof settingsRepository !== 'object'
		|| !lifecycle || typeof lifecycle !== 'object'
		|| typeof inheritedData(lifecycle, 'deleteProject') !== 'function'
		|| typeof inheritedData(store, 'getStatus') !== 'function') {
		throw new TypeError('The exact Framescaper V18 shadow project store is required.');
	}
	for (const method of ['putIfAbsent', 'deleteIfCurrent', 'listByPrefix'] as const) {
		if (typeof inheritedData(settingsRepository, method) !== 'function') {
			throw new TypeError('The exact durable Framescaper V18 settings repository is required.');
		}
	}
	const status = store.getStatus() as Readonly<Record<string, unknown>>;
	if (!status || status.state !== 'indexeddb' || status.persistent !== true) {
		throw new Error('The desktop V10 lifecycle requires a durable IndexedDB V18 shadow.');
	}
	const handshake = await bridge.connect();
	const databaseName = ownData(store, 'databaseName', 'Framescaper V18 shadow store');
	if (typeof databaseName !== 'string') throw new TypeError('The exact V18 shadow database identity is required.');
	validateFramescaperDesktopV10RendererHandshake(handshake, databaseName);
	if (bridge.handshakeState() !== 'admitted') {
		throw new TypeError('The Framescaper desktop V10 bridge did not retain its admitted handshake.');
	}
	const intents = new FramescaperDesktopV10DeleteIntents(
		settingsRepository as FramescaperDesktopV10DeleteIntentStore,
	);
	await reconcileFramescaperDesktopV10DeleteIntents({ profile, bridge, shadow: store, intents });
	const renderer = Object.freeze(new Renderer(profile, store, archive, bridge, intents));
	RENDERER_COMPOSITIONS.set(renderer, Object.freeze({ profile, store }));
	return renderer;
}

/** Authenticate the renderer/store pair without exposing its bridge or private CAS witnesses. */
export function assertFramescaperDesktopProjectLibraryV10RendererComposition(
	profileValue: EditorProjectRuntimeProfile | unknown,
	store: unknown,
	renderer: unknown,
): asserts renderer is FramescaperDesktopProjectLibraryV10Renderer {
	assertFramescaperProjectV18Profile(profileValue);
	const composition = RENDERER_COMPOSITIONS.get(renderer as object);
	if (!composition || composition.profile !== profileValue || composition.store !== store) {
		throw new TypeError('The exact admitted Framescaper desktop V10 renderer composition is required.');
	}
}

class Renderer implements FramescaperDesktopProjectLibraryV10Renderer {
	readonly #profile: EditorProjectRuntimeProfile;
	readonly #store: FramescaperDesktopProjectLibraryV10ShadowStore;
	readonly #archive: FramescaperScapeArchiveV18;
	readonly #bridge: FramescaperDesktopV10RendererBridge;
	readonly #ledger: FramescaperDesktopV10WitnessLedger;
	readonly #catalog: FramescaperDesktopV10RendererCatalog;
	#tail: Promise<void> = Promise.resolve();

	constructor(
		profile: EditorProjectRuntimeProfile,
		store: FramescaperDesktopProjectLibraryV10ShadowStore,
		archive: FramescaperScapeArchiveV18,
		bridge: FramescaperDesktopV10RendererBridge,
		intents: FramescaperDesktopV10DeleteIntents,
	) {
		this.#profile = profile;
		this.#store = store;
		this.#archive = archive;
		this.#bridge = bridge;
		this.#ledger = new FramescaperDesktopV10WitnessLedger(profile);
		this.#catalog = new FramescaperDesktopV10RendererCatalog({
			profile,
			store,
			bridge,
			ledger: this.#ledger,
			intents,
			reconcile: (snapshot) => this.#reconcile(snapshot),
		});
	}

	listProjects(): Promise<readonly Readonly<FramescaperDesktopV10ProjectSummary>[]> {
		return this.#exclusive(() => this.#catalog.listProjects());
	}

	readProject(projectIdValue: string, optionsValue: Readonly<{ signal?: AbortSignal }> = {}) {
		const projectId = validateFramescaperDesktopV10ProjectId(projectIdValue);
		const signal = signalOptions(optionsValue);
		return this.#exclusive(async () => {
			throwIfScapeAborted(signal);
			const raw = await this.#bridge.readProjectBundle(projectId);
			throwIfScapeAborted(signal);
			if (raw === null) {
				const catalog = validateFramescaperDesktopV10CatalogSnapshot(await this.#bridge.listProjects());
				throwIfScapeAborted(signal);
				if (catalog.projects.some(({ id }) => id === projectId)) {
					throw new Error('The desktop V10 project bundle is absent from a catalog that still owns it.');
				}
				this.#ledger.rememberAbsent(projectId, catalog.metadataRevision);
				return null;
			}
			const snapshot = validateFramescaperDesktopV10Bundle(this.#profile, raw, projectId);
			const project = await this.#reconcile(snapshot, signal);
			this.#ledger.rememberCurrent(snapshot);
			return project;
		});
	}

	publishProject(requestValue: unknown) {
		const request = rendererPublicationRequest(this.#profile, requestValue);
		return this.#exclusive(() => this.#publishFromWitness(request));
	}

	deleteProject(projectIdValue: string): Promise<void> {
		return this.#exclusive(() => this.#catalog.deleteProject(projectIdValue));
	}

	cleanupDeletedProject(projectIdValue: string): Promise<boolean> {
		return this.#exclusive(() => this.#catalog.cleanupDeletedProject(projectIdValue));
	}

	settleDeletedProject(projectIdValue: string): Promise<boolean> {
		return this.#exclusive(() => this.#catalog.settleDeletedProject(projectIdValue));
	}

	duplicateProject(
		sourceProjectIdValue: string,
		optionsValue: Readonly<FramescaperDesktopV10DuplicateOptions>,
	): Promise<FramescaperProjectV18> {
		return this.#exclusive(() => this.#catalog.duplicateProject(sourceProjectIdValue, optionsValue));
	}

	async #publishFromWitness(request: RendererPublication): Promise<FramescaperProjectV18> {
		const projectId = validateFramescaperDesktopV10ProjectId(String(request.project.id));
		await this.#catalog.observeCatalog();
		const witness = this.#ledger.take(projectId);
		if (witness.kind === 'absent') {
			if (Number(request.project.revision) !== 0) {
				throw new Error('The desktop V10 absence witness can publish only fresh revision zero.');
			}
		} else if (!isStrictlyHigherProjectRevision(
			request.project.revision,
			witness.expectedProject.projectRevision,
		)) {
			throw new Error('The desktop V10 publication is stale against its private revision witness.');
		}
		try {
			return await this.#publish(Object.freeze({
				...request,
				expectedMetadataRevision: witness.expectedMetadataRevision,
				expectedProject: witness.kind === 'absent' ? null : witness.expectedProject,
			}));
		} catch (error) {
			this.#ledger.clear();
			throw error;
		}
	}

	async #publish(request: NormalizedPublication): Promise<FramescaperProjectV18> {
		throwIfScapeAborted(request.signal);
		const projectId = validateFramescaperDesktopV10ProjectId(String(request.project.id));
		const currentValue = await this.#store.loadProject(
			projectId,
			request.signal ? { signal: request.signal } : {},
		);
		const current = currentValue === null || currentValue === undefined
			? null
			: cloneFramescaperProjectV18(this.#profile, currentValue);
		assertLocalCas(this.#profile, current, request);
		throwIfScapeAborted(request.signal);
		const exported = await this.#archive.exportProject(
			request.project,
			request.signal ? { signal: request.signal } : {},
		);
		const planned = framescaperDesktopV10BodiesForProject(request.project, request.documentSha256);
		if (exported.formatVersion !== (planned.assets.length === 0 ? 1 : 2)
			|| JSON.stringify(exported.assets.map(({ descriptor }) => descriptor)) !== JSON.stringify(planned.assets)) {
			throw new Error('The V18 shadow export changed its exact proxy/timing publication plan.');
		}
		const publicationId = createFramescaperDesktopV10PublicationId();
		let committed = false;
		try {
			const admission = validateFramescaperDesktopV10Admission(await this.#bridge.beginPublication({
				publicationId,
				expectedMetadataRevision: request.expectedMetadataRevision,
				expectedProject: request.expectedProject,
				project: request.project,
				bodies: planned.bodies,
			}), planned.bodies.length);
			if (admission.publicationId !== publicationId) {
				throw new Error('The desktop V10 publication admission changed its renderer operation id.');
			}
			for (const [bodyIndex, asset] of exported.assets.entries()) {
				await this.#uploadBody(publicationId, bodyIndex, planned.bodies[bodyIndex]!, asset.body, request.signal);
			}
			await request.beforeFinish?.();
			throwIfScapeAborted(request.signal);
			const result = validateFramescaperDesktopV10Bundle(
				this.#profile,
				await this.#bridge.finishPublication({ publicationId }),
				projectId,
			);
			assertPublicationResult(request, result);
			committed = true;
			const reconciled = await this.#reconcile(result, request.signal);
			this.#ledger.commitSnapshot(request.expectedMetadataRevision, result);
			return reconciled;
		} catch (error) {
			if (error instanceof FramescaperDesktopProjectLibraryV10IndeterminateError) throw error;
			if (committed) {
				throw new FramescaperDesktopProjectLibraryV10CommittedError('publication', projectId, error);
			}
			let primary = error;
			try {
				validateFramescaperDesktopV10Abort(await this.#bridge.abortPublication({ publicationId }));
			} catch (cleanupError) {
				primary = new AggregateError(
					[error, cleanupError],
					'Framescaper desktop V10 publication and abort both failed.',
					{ cause: error },
				);
			}
			const recovered = await this.#catalog.recoverPublication(request, primary);
			if (recovered === null) throw primary;
			try {
				const reconciled = await this.#reconcile(recovered, request.signal);
				this.#ledger.commitSnapshot(request.expectedMetadataRevision, recovered);
				return reconciled;
			} catch (reconcileError) {
				throw new FramescaperDesktopProjectLibraryV10CommittedError(
					'publication', projectId, reconcileError,
				);
			}
		}
	}

	async #uploadBody(
		publicationId: string,
		bodyIndex: number,
		descriptor: Readonly<FramescaperDesktopV10Body>,
		body: Blob,
		signal?: AbortSignal,
	): Promise<void> {
		if (!(body instanceof Blob) || body.size !== descriptor.byteLength) {
			throw new Error('The V18 shadow body changed before desktop upload.');
		}
		for (let offset = 0; offset < body.size; offset += FRAMESCAPER_DESKTOP_V10_MAXIMUM_CHUNK_BYTES) {
			throwIfScapeAborted(signal);
			const nextOffset = Math.min(body.size, offset + FRAMESCAPER_DESKTOP_V10_MAXIMUM_CHUNK_BYTES);
			const bytes = new Uint8Array(await body.slice(offset, nextOffset).arrayBuffer());
			throwIfScapeAborted(signal);
			const acknowledgement = await this.#bridge.writePublicationChunk({
				publicationId, bodyIndex, offset, bytes,
			});
			validateFramescaperDesktopV10Acknowledgement(
				acknowledgement, bodyIndex, nextOffset, nextOffset === body.size,
			);
		}
	}

	async #reconcile(
		snapshot: Readonly<FramescaperDesktopV10BundleSnapshot>,
		signal?: AbortSignal,
	): Promise<FramescaperProjectV18> {
		throwIfScapeAborted(signal);
		const currentValue = await this.#store.loadProject(
			snapshot.bundle.project.projectId,
			signal ? { signal } : {},
		);
		const current = currentValue === null || currentValue === undefined
			? null
			: cloneFramescaperProjectV18(this.#profile, currentValue);
		if (current && sameProject(current, snapshot.project)) {
			await this.#archive.exportProject(snapshot.project, signal ? { signal } : {});
			return cloneFramescaperProjectV18(this.#profile, snapshot.project);
		}
		const publication = shadowPublication(current, snapshot.project);
		const result = await this.#archive.importProject({
			manifest: framescaperDesktopV10ArchiveManifest(snapshot),
			project: snapshot.project,
			decision: 'continue',
			entries: framescaperDesktopV10ArchiveEntries(snapshot, this.#bridge, signal),
			operationId: createFramescaperDesktopV10RendererOperationId(),
			publication,
			...(signal ? { signal } : {}),
		});
		if (result.status !== 'published') {
			throw new Error('The V18 renderer shadow changed before desktop reconciliation.');
		}
		return cloneFramescaperProjectV18(this.#profile, result.project);
	}

	#exclusive<Result>(operation: () => Promise<Result>): Promise<Result> {
		const admitted = this.#tail.then(operation, operation);
		this.#tail = admitted.then(() => undefined, () => undefined);
		return admitted;
	}
}

interface NormalizedPublication {
	readonly expectedMetadataRevision: number;
	readonly expectedProject: Readonly<{ readonly projectRevision: number; readonly projectSha256: string }> | null;
	readonly project: FramescaperProjectV18;
	readonly document: string;
	readonly documentSha256: string;
	readonly signal?: AbortSignal;
	readonly beforeFinish?: () => PromiseLike<void> | void;
}

interface RendererPublication {
	readonly project: FramescaperProjectV18;
	readonly document: string;
	readonly documentSha256: string;
	readonly signal?: AbortSignal;
	readonly beforeFinish?: () => PromiseLike<void> | void;
}

function rendererPublicationRequest(profile: EditorProjectRuntimeProfile, value: unknown): RendererPublication {
	const raw = allowedRecord(
		value, PUBLICATION_REQUIRED_FIELDS, PUBLICATION_OPTIONAL_FIELDS, 'Framescaper desktop V10 publication',
	);
	const snapshot = snapshotFramescaperDesktopV10Project(profile, raw.project);
	const signal = raw.signal === undefined ? undefined : abortSignal(raw.signal);
	const beforeFinish = raw.beforeFinish === undefined
		? undefined
		: callback(raw.beforeFinish, 'Framescaper desktop V10 before-finish callback');
	return Object.freeze({
		project: snapshot.project,
		document: snapshot.document,
		documentSha256: snapshot.sha256,
		...(signal ? { signal } : {}),
		...(beforeFinish ? { beforeFinish } : {}),
	});
}

function assertLocalCas(
	profile: EditorProjectRuntimeProfile,
	current: FramescaperProjectV18 | null,
	request: NormalizedPublication,
): void {
	if (request.expectedProject === null) {
		if (current !== null || Number(request.project.revision) !== 0) {
			throw new Error('Desktop create requires an absent V18 shadow and fresh revision zero.');
		}
		return;
	}
	if (!current || String(current.id) !== String(request.project.id)) {
		throw new Error('Desktop publication requires its exact reconciled V18 shadow base.');
	}
	const snapshot = snapshotFramescaperDesktopV10Project(profile, current);
	if (Number(current.revision) !== request.expectedProject.projectRevision
		|| snapshot.sha256 !== request.expectedProject.projectSha256
		|| !isStrictlyHigherProjectRevision(request.project.revision, current.revision)) {
		throw new Error('The V18 shadow failed the desktop publication compare-and-swap.');
	}
}

function assertPublicationResult(
	request: NormalizedPublication,
	result: Readonly<FramescaperDesktopV10BundleSnapshot>,
): void {
	if (result.bundle.metadataRevision !== request.expectedMetadataRevision + 1
		|| result.bundle.document !== request.document
		|| result.bundle.project.sha256 !== request.documentSha256) {
		throw new Error('The committed desktop V10 publication changed its requested project.');
	}
}

function shadowPublication(current: FramescaperProjectV18 | null, project: FramescaperProjectV18) {
	if (current === null) return Object.freeze({ mode: 'create' as const });
	if (String(current.id) !== String(project.id)
		|| !isStrictlyHigherProjectRevision(project.revision, Number(current.revision))) {
		throw new Error('Desktop reconciliation requires a strictly higher V18 shadow revision.');
	}
	return Object.freeze({ mode: 'compare-and-swap' as const, expected: current, project });
}

function sameProject(left: FramescaperProjectV18, right: FramescaperProjectV18): boolean {
	return serializeScapeProjectDocument(left) === serializeScapeProjectDocument(right);
}

function signalOptions(value: unknown): AbortSignal | undefined {
	const raw = allowedRecord(value, [], SIGNAL_FIELDS, 'Framescaper desktop V10 read options');
	return raw.signal === undefined ? undefined : abortSignal(raw.signal);
}

function abortSignal(value: unknown): AbortSignal {
	if (!(value instanceof AbortSignal)) throw new TypeError('A Framescaper desktop V10 AbortSignal is required.');
	return value;
}

function callback(value: unknown, name: string): () => PromiseLike<void> | void {
	if (typeof value !== 'function') throw new TypeError(`${name} is required.`);
	return value as () => PromiseLike<void> | void;
}

function allowedRecord<const Required extends string, const Optional extends string>(
	value: unknown,
	required: readonly Required[],
	optional: readonly Optional[],
	name: string,
): Record<Required | Optional, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
		throw new TypeError(`${name} must be a plain record.`);
	}
	const allowed = new Set<string>([...required, ...optional]);
	const keys = Reflect.ownKeys(value);
	if (keys.some((key) => typeof key !== 'string' || !allowed.has(key))) throw new TypeError(`${name} has unsupported fields.`);
	const result = Object.create(null) as Record<Required | Optional, unknown>;
	for (const field of required) result[field] = ownData(value, field, name);
	for (const field of optional) if (Object.hasOwn(value, field)) result[field] = ownData(value, field, name);
	return result;
}

function ownData(value: object, field: string, name: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(value, field);
	if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError(`${name}.${field} must be an own data property.`);
	}
	return descriptor.value;
}

function inheritedData(value: object, field: string): unknown {
	let candidate: object | null = value;
	while (candidate) {
		const descriptor = Object.getOwnPropertyDescriptor(candidate, field);
		if (descriptor) return Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
		candidate = Object.getPrototypeOf(candidate) as object | null;
	}
	return undefined;
}
