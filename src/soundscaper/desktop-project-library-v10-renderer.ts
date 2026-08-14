/* SPDX-License-Identifier: AGPL-3.0-only */

import { throwIfScapeAborted } from '../common/editor/scape-abort.ts'
import type { EditorProjectRuntimeProfile } from '../common/editor/project-runtime-profile.ts'
import { assertSoundscaperProjectV21Profile } from './editor-project-v21-profile.ts'
import { soundscaperProjectStoreAuthorityV21 } from './editor-project-store-v21.ts'
import { cloneSoundscaperProjectV21, type SoundscaperProjectV21 } from './editor-project-v21.ts'
import {
	soundscaperDesktopV10BodiesForProject,
	resolveSoundscaperDesktopV10RendererBridge,
	snapshotSoundscaperDesktopV10Project,
	validateSoundscaperDesktopV10Abort,
	validateSoundscaperDesktopV10Acknowledgement,
	validateSoundscaperDesktopV10Admission,
	validateSoundscaperDesktopV10Bundle,
	validateSoundscaperDesktopV10CatalogSnapshot,
	validateSoundscaperDesktopV10ProjectId,
	validateSoundscaperDesktopV10RendererHandshake,
	type SoundscaperDesktopV10Body,
	type SoundscaperDesktopV10BundleSnapshot,
	type SoundscaperDesktopV10ProjectSummary,
	type SoundscaperDesktopV10RendererBridge,
} from './desktop-project-library-v10-renderer-contract.ts'
import {
	acquireSoundscaperDesktopV10FreezeBodies,
	streamSoundscaperDesktopV10FreezeBody,
	type SoundscaperDesktopV10FreezeStore,
} from './desktop-project-library-v10-freeze-media.ts'
import {
	SoundscaperDesktopProjectLibraryV10CommittedError,
	SoundscaperDesktopProjectLibraryV10IndeterminateError,
	SoundscaperDesktopV10RendererCatalog,
	type SoundscaperDesktopV10RawShadowProjectStore,
} from './desktop-project-library-v10-renderer-catalog.ts'
import {
	createSoundscaperDesktopV10PublicationId,
	SoundscaperDesktopV10WitnessLedger,
	sameSoundscaperDesktopV10Project,
	type SoundscaperDesktopV10DuplicateOptions,
} from './desktop-project-library-v10-renderer-lifecycle.ts'
import {
	SoundscaperDesktopV10DeleteIntents,
	reconcileSoundscaperDesktopV10DeleteIntents,
	type SoundscaperDesktopV10DeleteIntentStore,
} from './desktop-project-library-v10-delete-intents.ts'

export interface SoundscaperDesktopProjectLibraryV10RendererComposition {
	readonly store: SoundscaperDesktopProjectLibraryV10ShadowStore
}

export interface SoundscaperDesktopProjectLibraryV10ShadowStore extends
	SoundscaperDesktopV10FreezeStore, SoundscaperDesktopV10RawShadowProjectStore {
	readonly databaseName: string
	loadProject(projectId: string, options?: Readonly<{ signal?: AbortSignal }>): PromiseLike<unknown> | unknown
	getStatus(): unknown
	readonly projectRepository: SoundscaperDesktopV10RawShadowProjectStore['projectRepository'] & Readonly<{
		createForScapeImportIfAbsent(project: SoundscaperProjectV21): PromiseLike<unknown> | unknown
		saveIfCurrent(
			expected: SoundscaperProjectV21,
			project: SoundscaperProjectV21,
		): PromiseLike<unknown> | unknown
	}>
	readonly settingsRepository: SoundscaperDesktopV10DeleteIntentStore
	readonly linkedOriginalStoreService: Readonly<{
		deleteProject<Value>(projectId: string, operation: () => PromiseLike<Value> | Value): Promise<Value>
	}>
}

export interface SoundscaperDesktopProjectLibraryV10Renderer {
	listProjects(): Promise<readonly Readonly<SoundscaperDesktopV10ProjectSummary>[]>
	readProject(projectId: string, options?: Readonly<{ signal?: AbortSignal }>): Promise<SoundscaperProjectV21 | null>
	publishProject(request: Readonly<{ readonly project: unknown; readonly signal?: AbortSignal }> | unknown):
		Promise<SoundscaperProjectV21>
	deleteProject(projectId: string): Promise<void>
	cleanupDeletedProject(projectId: string): Promise<boolean>
	settleDeletedProject(projectId: string): Promise<boolean>
	duplicateProject(
		sourceProjectId: string,
		options: Readonly<SoundscaperDesktopV10DuplicateOptions>,
	): Promise<SoundscaperProjectV21>
}

const RENDERER_COMPOSITIONS = new WeakMap<object, Readonly<{
	readonly profile: EditorProjectRuntimeProfile
	readonly store: SoundscaperDesktopProjectLibraryV10ShadowStore
}>>()

export {
	SoundscaperDesktopProjectLibraryV10CommittedError,
	SoundscaperDesktopProjectLibraryV10IndeterminateError,
} from './desktop-project-library-v10-renderer-catalog.ts'

const PUBLICATION_REQUIRED_FIELDS = ['project'] as const
const PUBLICATION_OPTIONAL_FIELDS = ['signal'] as const
const SIGNAL_FIELDS = ['signal'] as const

/** Connect the packaged V10 bridge only to one authenticated durable V21 shadow. */
export async function connectSoundscaperDesktopProjectLibraryV10Renderer(
	profileValue: EditorProjectRuntimeProfile | unknown,
	compositionValue: SoundscaperDesktopProjectLibraryV10RendererComposition | unknown,
): Promise<SoundscaperDesktopProjectLibraryV10Renderer | null> {
	assertSoundscaperProjectV21Profile(profileValue)
	const profile = profileValue
	const composition = allowedRecord(
		compositionValue, ['store'], [], 'Soundscaper desktop V10 renderer composition',
	)
	const store = composition.store as SoundscaperDesktopProjectLibraryV10ShadowStore
	soundscaperProjectStoreAuthorityV21(profile, store)
	assertShadowStore(store)
	const bridge = resolveSoundscaperDesktopV10RendererBridge()
	if (!bridge) return null
	const status = store.getStatus() as Readonly<Record<string, unknown>>
	if (!status || status.state !== 'indexeddb' || status.persistent !== true) {
		throw new Error('The desktop V10 lifecycle requires a durable IndexedDB V21 shadow.')
	}
	const handshake = await bridge.connect()
	validateSoundscaperDesktopV10RendererHandshake(handshake, store.databaseName)
	if (bridge.handshakeState() !== 'admitted') {
		throw new TypeError('The Soundscaper desktop V10 bridge did not retain its admitted handshake.')
	}
	const intents = new SoundscaperDesktopV10DeleteIntents(store.settingsRepository)
	await reconcileSoundscaperDesktopV10DeleteIntents({ profile, bridge, shadow: store, intents })
	const renderer = Object.freeze(new Renderer(profile, store, bridge, intents))
	RENDERER_COMPOSITIONS.set(renderer, Object.freeze({ profile, store }))
	return renderer
}

/** Authenticate the renderer/store pair without exposing its bridge or CAS witnesses. */
export function assertSoundscaperDesktopProjectLibraryV10RendererComposition(
	profileValue: EditorProjectRuntimeProfile | unknown,
	store: unknown,
	renderer: unknown,
): asserts renderer is SoundscaperDesktopProjectLibraryV10Renderer {
	assertSoundscaperProjectV21Profile(profileValue)
	const composition = RENDERER_COMPOSITIONS.get(renderer as object)
	if (!composition || composition.profile !== profileValue || composition.store !== store) {
		throw new TypeError('The exact admitted Soundscaper desktop V10 renderer composition is required.')
	}
}

class Renderer implements SoundscaperDesktopProjectLibraryV10Renderer {
	readonly #profile: EditorProjectRuntimeProfile
	readonly #store: SoundscaperDesktopProjectLibraryV10ShadowStore
	readonly #bridge: SoundscaperDesktopV10RendererBridge
	readonly #ledger: SoundscaperDesktopV10WitnessLedger
	readonly #catalog: SoundscaperDesktopV10RendererCatalog
	#tail: Promise<void> = Promise.resolve()

	constructor(
		profile: EditorProjectRuntimeProfile,
		store: SoundscaperDesktopProjectLibraryV10ShadowStore,
		bridge: SoundscaperDesktopV10RendererBridge,
		intents: SoundscaperDesktopV10DeleteIntents,
	) {
		this.#profile = profile
		this.#store = store
		this.#bridge = bridge
		this.#ledger = new SoundscaperDesktopV10WitnessLedger(profile)
		this.#catalog = new SoundscaperDesktopV10RendererCatalog({
			profile,
			store,
			bridge,
			ledger: this.#ledger,
			intents,
			reconcile: (snapshot) => this.#reconcile(snapshot),
		})
	}

	listProjects(): Promise<readonly Readonly<SoundscaperDesktopV10ProjectSummary>[]> {
		return this.#exclusive(() => this.#catalog.listProjects())
	}

	readProject(projectIdValue: string, optionsValue: Readonly<{ signal?: AbortSignal }> = {}) {
		const projectId = validateSoundscaperDesktopV10ProjectId(projectIdValue)
		const signal = signalOptions(optionsValue)
		return this.#exclusive(async () => {
			throwIfScapeAborted(signal)
			const raw = await this.#bridge.readProjectBundle(projectId)
			throwIfScapeAborted(signal)
			if (raw === null) {
				const catalog = validateSoundscaperDesktopV10CatalogSnapshot(await this.#bridge.listProjects())
				throwIfScapeAborted(signal)
				if (catalog.projects.some(({ id }) => id === projectId)) {
					throw new Error('The desktop V10 project bundle is absent from a catalog that still owns it.')
				}
				this.#ledger.rememberAbsent(projectId, catalog.metadataRevision)
				return null
			}
			const snapshot = validateSoundscaperDesktopV10Bundle(this.#profile, raw, projectId)
			const project = await this.#reconcile(snapshot, signal)
			this.#ledger.rememberCurrent(snapshot)
			return project
		})
	}

	publishProject(requestValue: unknown) {
		const request = rendererPublicationRequest(this.#profile, requestValue)
		return this.#exclusive(() => this.#publishFromWitness(request))
	}

	deleteProject(projectIdValue: string): Promise<void> {
		return this.#exclusive(() => this.#catalog.deleteProject(projectIdValue))
	}

	cleanupDeletedProject(projectIdValue: string): Promise<boolean> {
		return this.#exclusive(() => this.#catalog.cleanupDeletedProject(projectIdValue))
	}

	settleDeletedProject(projectIdValue: string): Promise<boolean> {
		return this.#exclusive(() => this.#catalog.settleDeletedProject(projectIdValue))
	}

	duplicateProject(sourceProjectId: string, options: Readonly<SoundscaperDesktopV10DuplicateOptions>) {
		return this.#exclusive(() => this.#catalog.duplicateProject(sourceProjectId, options))
	}

	async #publishFromWitness(request: RendererPublication): Promise<SoundscaperProjectV21> {
		const projectId = validateSoundscaperDesktopV10ProjectId(String(request.project.id))
		await this.#catalog.observeCatalog()
		const witness = this.#ledger.take(projectId)
		if (witness.kind === 'absent') {
			if (Number(request.project.revision) !== 0) {
				throw new Error('The desktop V10 absence witness can publish only fresh revision zero.')
			}
		} else if (!isStrictlyHigherProjectRevision(
			request.project.revision,
			witness.expectedProject.projectRevision,
		)) {
			throw new Error('The desktop V10 publication is stale against its private revision witness.')
		}
		try {
			return await this.#publish(Object.freeze({
				...request,
				expectedMetadataRevision: witness.expectedMetadataRevision,
				expectedProject: witness.kind === 'absent' ? null : witness.expectedProject,
			}))
		} catch (error) {
			this.#ledger.clear()
			throw error
		}
	}

	async #publish(request: NormalizedPublication): Promise<SoundscaperProjectV21> {
		throwIfScapeAborted(request.signal)
		const projectId = validateSoundscaperDesktopV10ProjectId(String(request.project.id))
		const currentValue = await this.#store.loadProject(
			projectId, request.signal ? { signal: request.signal } : {},
		)
		const current = currentValue == null ? null : cloneSoundscaperProjectV21(currentValue)
		assertLocalCas(this.#profile, current, request)
		const planned = soundscaperDesktopV10BodiesForProject(request.project, request.documentSha256)
		const publicationId = createSoundscaperDesktopV10PublicationId()
		let committed = false
		try {
			const admission = validateSoundscaperDesktopV10Admission(await this.#bridge.beginPublication({
				publicationId,
				expectedMetadataRevision: request.expectedMetadataRevision,
				expectedProject: request.expectedProject,
				project: request.project,
				bodies: planned.bodies,
			}), planned.bodies.length)
			if (admission.publicationId !== publicationId) {
				throw new Error('The desktop V10 publication admission changed its renderer operation id.')
			}
			for (const [bodyIndex, body] of planned.bodies.entries()) {
				await this.#uploadBody(publicationId, bodyIndex, body, request.project, request.signal)
			}
			throwIfScapeAborted(request.signal)
			const result = validateSoundscaperDesktopV10Bundle(
				this.#profile,
				await this.#bridge.finishPublication({ publicationId }),
				projectId,
			)
			assertPublicationResult(request, result)
			committed = true
			const reconciled = await this.#reconcile(result, request.signal)
			this.#ledger.commitSnapshot(request.expectedMetadataRevision, result)
			return reconciled
		} catch (error) {
			if (error instanceof SoundscaperDesktopProjectLibraryV10IndeterminateError) throw error
			if (committed) {
				throw new SoundscaperDesktopProjectLibraryV10CommittedError('publication', projectId, error)
			}
			let primary = error
			try { validateSoundscaperDesktopV10Abort(await this.#bridge.abortPublication({ publicationId })) }
			catch (cleanupError) {
				primary = new AggregateError(
					[error, cleanupError],
					'Soundscaper desktop V10 publication and abort both failed.',
					{ cause: error },
				)
			}
			const recovered = await this.#catalog.recoverPublication(request, primary)
			if (recovered === null) throw primary
			try {
				const reconciled = await this.#reconcile(recovered, request.signal)
				this.#ledger.commitSnapshot(request.expectedMetadataRevision, recovered)
				return reconciled
			} catch (reconcileError) {
				throw new SoundscaperDesktopProjectLibraryV10CommittedError(
					'publication', projectId, reconcileError,
				)
			}
		}
	}

	async #uploadBody(
		publicationId: string,
		bodyIndex: number,
		descriptor: Readonly<SoundscaperDesktopV10Body>,
		project: SoundscaperProjectV21,
		signal?: AbortSignal,
	): Promise<void> {
		await streamSoundscaperDesktopV10FreezeBody(
			project,
			descriptor,
			this.#store,
			async (offset, bytes, final) => {
				const acknowledgement = await this.#bridge.writePublicationChunk({
					publicationId, bodyIndex, offset, bytes,
				})
				validateSoundscaperDesktopV10Acknowledgement(
					acknowledgement, bodyIndex, offset + bytes.byteLength, final,
				)
			},
			signal,
		)
	}

	async #reconcile(
		snapshot: Readonly<SoundscaperDesktopV10BundleSnapshot>,
		signal?: AbortSignal,
	): Promise<SoundscaperProjectV21> {
		throwIfScapeAborted(signal)
		const currentValue = await this.#store.loadProject(
			snapshot.bundle.project.projectId, signal ? { signal } : {},
		)
		const current = currentValue == null ? null : cloneSoundscaperProjectV21(currentValue)
		const mode = shadowMode(current, snapshot.project)
		const acquisition = await acquireSoundscaperDesktopV10FreezeBodies(
			snapshot, this.#bridge, this.#store, signal,
		)
		try {
			let result: unknown
			if (mode === 'same') {
				result = acquisition.acquiredBodyCount === 0
					? current
					: await this.#store.projectRepository.saveIfCurrent(current!, current!)
			} else if (mode === 'create') {
				result = await this.#store.projectRepository.createForScapeImportIfAbsent(snapshot.project)
			} else {
				result = await this.#store.projectRepository.saveIfCurrent(current!, snapshot.project)
			}
			if (result == null) throw new Error('The V21 renderer shadow changed before desktop reconciliation.')
			const project = cloneSoundscaperProjectV21(result)
			if (!sameSoundscaperDesktopV10Project(project, snapshot.project)) {
				throw new Error('The V21 renderer shadow changed its desktop project document.')
			}
			acquisition.commit()
			return project
		} catch (error) {
			try { await acquisition.rollback() }
			catch (cleanupError) {
				throw new AggregateError(
					[error, cleanupError],
					'Soundscaper desktop shadow reconciliation and freeze cleanup failed.',
				)
			}
			throw error
		}
	}

	#exclusive<Result>(operation: () => Promise<Result>): Promise<Result> {
		const admitted = this.#tail.then(operation, operation)
		this.#tail = admitted.then(() => undefined, () => undefined)
		return admitted
	}
}

interface RendererPublication {
	readonly project: SoundscaperProjectV21
	readonly document: string
	readonly documentSha256: string
	readonly signal?: AbortSignal
}

interface NormalizedPublication extends RendererPublication {
	readonly expectedMetadataRevision: number
	readonly expectedProject: Readonly<{ readonly projectRevision: number; readonly projectSha256: string }> | null
}

function rendererPublicationRequest(profile: EditorProjectRuntimeProfile, value: unknown): RendererPublication {
	const raw = allowedRecord(
		value, PUBLICATION_REQUIRED_FIELDS, PUBLICATION_OPTIONAL_FIELDS, 'Soundscaper desktop V10 publication',
	)
	const snapshot = snapshotSoundscaperDesktopV10Project(profile, raw.project)
	const signal = raw.signal === undefined ? undefined : abortSignal(raw.signal)
	return Object.freeze({
		project: snapshot.project,
		document: snapshot.document,
		documentSha256: snapshot.sha256,
		...(signal ? { signal } : {}),
	})
}

function assertLocalCas(
	profile: EditorProjectRuntimeProfile,
	current: SoundscaperProjectV21 | null,
	request: NormalizedPublication,
): void {
	if (request.expectedProject === null) {
		if (current !== null || Number(request.project.revision) !== 0) {
			throw new Error('Desktop create requires an absent V21 shadow and fresh revision zero.')
		}
		return
	}
	if (!current || String(current.id) !== String(request.project.id)) {
		throw new Error('Desktop publication requires its exact reconciled V21 shadow base.')
	}
	const snapshot = snapshotSoundscaperDesktopV10Project(profile, current)
	if (Number(current.revision) !== request.expectedProject.projectRevision
		|| snapshot.sha256 !== request.expectedProject.projectSha256
		|| !isStrictlyHigherProjectRevision(request.project.revision, current.revision)) {
		throw new Error('The V21 shadow failed the desktop publication compare-and-swap.')
	}
}

function assertPublicationResult(
	request: NormalizedPublication,
	result: Readonly<SoundscaperDesktopV10BundleSnapshot>,
): void {
	if (result.bundle.metadataRevision !== request.expectedMetadataRevision + 1
		|| result.bundle.document !== request.document
		|| result.bundle.project.sha256 !== request.documentSha256) {
		throw new Error('The committed desktop V10 publication changed its requested project.')
	}
}

function shadowMode(
	current: SoundscaperProjectV21 | null,
	project: SoundscaperProjectV21,
): 'create' | 'same' | 'update' {
	if (current === null) {
		if (Number(project.revision) !== 0) throw new Error('Desktop reconciliation create requires revision zero.')
		return 'create'
	}
	if (sameSoundscaperDesktopV10Project(current, project)) return 'same'
	const revision = Number(current.revision)
	if (String(current.id) !== String(project.id) || !Number.isSafeInteger(revision)
		|| !isStrictlyHigherProjectRevision(project.revision, revision)) {
		throw new Error('Desktop reconciliation requires a strictly higher V21 shadow revision.')
	}
	return 'update'
}

function isStrictlyHigherProjectRevision(nextValue: unknown, currentValue: unknown): boolean {
	return typeof nextValue === 'number' && Number.isSafeInteger(nextValue)
		&& typeof currentValue === 'number' && Number.isSafeInteger(currentValue)
		&& nextValue > currentValue
}

function assertShadowStore(value: unknown): asserts value is SoundscaperDesktopProjectLibraryV10ShadowStore {
	if (!value || typeof value !== 'object') throw new TypeError('The exact Soundscaper V21 shadow store is required.')
	const repository = ownData(value, 'projectRepository', 'Soundscaper V21 shadow store')
	const settings = ownData(value, 'settingsRepository', 'Soundscaper V21 shadow store')
	const lifecycle = ownData(value, 'linkedOriginalStoreService', 'Soundscaper V21 shadow store')
	if (!repository || typeof repository !== 'object' || !settings || typeof settings !== 'object'
		|| !lifecycle || typeof lifecycle !== 'object') {
		throw new TypeError('The exact Soundscaper V21 shadow repositories are required.')
	}
	for (const method of ['deleteExact', 'createForScapeImportIfAbsent', 'saveIfCurrent'] as const) {
		if (typeof inheritedData(repository, method) !== 'function') {
			throw new TypeError(`The Soundscaper V21 shadow project repository requires ${method}.`)
		}
	}
	for (const method of ['putIfAbsent', 'deleteIfCurrent', 'listByPrefix'] as const) {
		if (typeof inheritedData(settings, method) !== 'function') {
			throw new TypeError(`The Soundscaper V21 settings repository requires ${method}.`)
		}
	}
	for (const method of [
		'loadProject', 'getStatus', 'getSourceMetadata', 'readSourceChunks',
		'beginSourceWrite', 'discardSourceIfCurrent',
	] as const) {
		if (typeof inheritedData(value, method) !== 'function') {
			throw new TypeError(`The Soundscaper V21 shadow store requires ${method}.`)
		}
	}
	if (typeof inheritedData(lifecycle, 'deleteProject') !== 'function'
		|| typeof ownData(value, 'databaseName', 'Soundscaper V21 shadow store') !== 'string') {
		throw new TypeError('The exact Soundscaper V21 shadow lifecycle is required.')
	}
}

function signalOptions(value: unknown): AbortSignal | undefined {
	const raw = allowedRecord(value, [], SIGNAL_FIELDS, 'Soundscaper desktop V10 read options')
	return raw.signal === undefined ? undefined : abortSignal(raw.signal)
}

function abortSignal(value: unknown): AbortSignal {
	if (!(value instanceof AbortSignal)) throw new TypeError('A Soundscaper desktop V10 AbortSignal is required.')
	return value
}

function allowedRecord<const Required extends string, const Optional extends string>(
	value: unknown,
	required: readonly Required[],
	optional: readonly Optional[],
	name: string,
): Record<Required | Optional, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
		throw new TypeError(`${name} must be a plain record.`)
	}
	const allowed = new Set<string>([...required, ...optional])
	const keys = Reflect.ownKeys(value)
	if (keys.some((key) => typeof key !== 'string' || !allowed.has(key))) {
		throw new TypeError(`${name} has unsupported fields.`)
	}
	const result = Object.create(null) as Record<Required | Optional, unknown>
	for (const field of required) result[field] = ownData(value, field, name)
	for (const field of optional) if (Object.hasOwn(value, field)) result[field] = ownData(value, field, name)
	return result
}

function ownData(value: object, field: string, name: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(value, field)
	if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError(`${name}.${field} must be an own data property.`)
	}
	return descriptor.value
}

function inheritedData(value: object, field: string): unknown {
	let candidate: object | null = value
	while (candidate) {
		const descriptor = Object.getOwnPropertyDescriptor(candidate, field)
		if (descriptor) return Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined
		candidate = Object.getPrototypeOf(candidate) as object | null
	}
	return undefined
}
