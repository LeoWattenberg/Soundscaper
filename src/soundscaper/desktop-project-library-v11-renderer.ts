/* SPDX-License-Identifier: AGPL-3.0-only */

import { throwIfScapeAborted } from '../common/editor/scape-abort.ts'
import { isStrictlyHigherProjectRevision } from '../common/editor/project-revision-cas.ts'
import type { EditorProjectRuntimeProfile } from '../common/editor/project-runtime-profile.ts'
import {
	assertSoundscaperProductionProfile,
	soundscaperProductionProjectClone,
	soundscaperProductionStoreAuthority,
} from './editor-project-production-profile.ts'
import type { SoundscaperProductionProject } from './editor-project-production-validation.ts'
import {
	soundscaperDesktopV11BodiesForProject,
	resolveSoundscaperDesktopV11RendererBridge,
	snapshotSoundscaperDesktopV11Project,
	validateSoundscaperDesktopV11Abort,
	validateSoundscaperDesktopV11Acknowledgement,
	validateSoundscaperDesktopV11Admission,
	validateSoundscaperDesktopV11Bundle,
	validateSoundscaperDesktopV11CatalogSnapshot,
	validateSoundscaperDesktopV11ProjectId,
	validateSoundscaperDesktopV11RendererHandshake,
	type SoundscaperDesktopV11Body,
	type SoundscaperDesktopV11BundleSnapshot,
	type SoundscaperDesktopV11ProjectSummary,
	type SoundscaperDesktopV11RendererBridge,
} from './desktop-project-library-v11-renderer-contract.ts'
import {
	acquireSoundscaperDesktopV11FreezeBodies,
	streamSoundscaperDesktopV11FreezeBody,
	type SoundscaperDesktopV11FreezeStore,
} from './desktop-project-library-v11-freeze-media.ts'
import {
	SoundscaperDesktopProjectLibraryV11CommittedError,
	SoundscaperDesktopProjectLibraryV11IndeterminateError,
	SoundscaperDesktopV11RendererCatalog,
	type SoundscaperDesktopV11RawShadowProjectStore,
} from './desktop-project-library-v11-renderer-catalog.ts'
import {
	createSoundscaperDesktopV11PublicationId,
	SoundscaperDesktopV11WitnessLedger,
	sameSoundscaperDesktopV11Project,
	type SoundscaperDesktopV11DuplicateOptions,
} from './desktop-project-library-v11-renderer-lifecycle.ts'
import {
	SoundscaperDesktopV11DeleteIntents,
	reconcileSoundscaperDesktopV11DeleteIntents,
	type SoundscaperDesktopV11DeleteIntentStore,
} from './desktop-project-library-v11-delete-intents.ts'
import {
	validateSoundscaperNativePluginStateBodyIdV1,
	validateSoundscaperNativePluginStateBodyRecordV1,
	validateSoundscaperNativePluginStateBytesV1,
	validateSoundscaperPersistedNativePluginStateBodyV1,
	type SoundscaperDesktopNativePluginStateBodyDescriptorV1,
	type SoundscaperDesktopNativePluginStateBodyRecordV1,
} from './desktop-native-plugin-state-transport-v1.ts'
export interface SoundscaperDesktopProjectLibraryV11RendererComposition {
	readonly store: SoundscaperDesktopProjectLibraryV11ShadowStore
}

export interface SoundscaperDesktopProjectLibraryV11ShadowStore extends
	SoundscaperDesktopV11FreezeStore, SoundscaperDesktopV11RawShadowProjectStore {
	readonly databaseName: string
	loadProject(projectId: string, options?: Readonly<{ signal?: AbortSignal }>): PromiseLike<unknown> | unknown
	getStatus(): unknown
	readonly projectRepository: SoundscaperDesktopV11RawShadowProjectStore['projectRepository'] & Readonly<{
		createForScapeImportIfAbsent(project: SoundscaperProductionProject): PromiseLike<unknown> | unknown
		saveIfCurrent(
			expected: SoundscaperProductionProject,
			project: SoundscaperProductionProject,
		): PromiseLike<unknown> | unknown
	}>
	readonly settingsRepository: SoundscaperDesktopV11DeleteIntentStore
	readonly linkedOriginalStoreService: Readonly<{
		deleteProject<Value>(projectId: string, operation: () => PromiseLike<Value> | Value): Promise<Value>
	}>
}

export interface SoundscaperDesktopProjectLibraryV11Renderer {
	listProjects(): Promise<readonly Readonly<SoundscaperDesktopV11ProjectSummary>[]>
	readProject(projectId: string, options?: Readonly<{ signal?: AbortSignal }>): Promise<SoundscaperProductionProject | null>
	createScapeProjectIfAbsent(project: unknown): Promise<SoundscaperProductionProject | null>
	publishProject(request: Readonly<{ readonly project: unknown; readonly signal?: AbortSignal }> | unknown):
		Promise<SoundscaperProductionProject>
	deleteProject(projectId: string): Promise<void>
	deleteProjectIfCurrent(project: unknown): Promise<boolean>
	cleanupDeletedProject(projectId: string): Promise<boolean>
	settleDeletedProject(projectId: string): Promise<boolean>
	duplicateProject(
		sourceProjectId: string,
		options: Readonly<SoundscaperDesktopV11DuplicateOptions>,
	): Promise<SoundscaperProductionProject>
	persistNativePluginState(bytes: Uint8Array): Promise<Readonly<SoundscaperDesktopNativePluginStateBodyDescriptorV1>>
	readNativePluginState(bodyId: string): Promise<Readonly<SoundscaperDesktopNativePluginStateBodyRecordV1> | null>
}

const RENDERER_COMPOSITIONS = new WeakMap<object, Readonly<{
	readonly profile: EditorProjectRuntimeProfile
	readonly store: SoundscaperDesktopProjectLibraryV11ShadowStore
}>>()

export {
	SoundscaperDesktopProjectLibraryV11CommittedError,
	SoundscaperDesktopProjectLibraryV11IndeterminateError,
} from './desktop-project-library-v11-renderer-catalog.ts'

const PUBLICATION_REQUIRED_FIELDS = ['project'] as const
const PUBLICATION_OPTIONAL_FIELDS = ['signal'] as const
const SIGNAL_FIELDS = ['signal'] as const

/** Connect the packaged V11 bridge only to one authenticated durable V21 shadow. */
export async function connectSoundscaperDesktopProjectLibraryV11Renderer(
	profileValue: EditorProjectRuntimeProfile | unknown,
	compositionValue: SoundscaperDesktopProjectLibraryV11RendererComposition | unknown,
): Promise<SoundscaperDesktopProjectLibraryV11Renderer | null> {
	assertSoundscaperProductionProfile(profileValue)
	const profile = profileValue
	const composition = allowedRecord(
		compositionValue, ['store'], [], 'Soundscaper desktop V11 renderer composition',
	)
	const store = composition.store as SoundscaperDesktopProjectLibraryV11ShadowStore
	soundscaperProductionStoreAuthority(profile, store)
	assertShadowStore(store)
	const bridge = resolveSoundscaperDesktopV11RendererBridge()
	if (!bridge) return null
	const status = store.getStatus() as Readonly<Record<string, unknown>>
	if (!status || status.state !== 'indexeddb' || status.persistent !== true) {
		throw new Error('The desktop V11 lifecycle requires a durable IndexedDB V21 shadow.')
	}
	const handshake = await bridge.connect()
	validateSoundscaperDesktopV11RendererHandshake(handshake, profile)
	if (bridge.handshakeState() !== 'admitted') {
		throw new TypeError('The Soundscaper desktop V11 bridge did not retain its admitted handshake.')
	}
	const intents = new SoundscaperDesktopV11DeleteIntents(store.settingsRepository)
	await reconcileSoundscaperDesktopV11DeleteIntents({ profile, bridge, shadow: store, intents })
	const renderer = Object.freeze(new Renderer(profile, store, bridge, intents))
	RENDERER_COMPOSITIONS.set(renderer, Object.freeze({ profile, store }))
	return renderer
}

/** Authenticate the renderer/store pair without exposing its bridge or CAS witnesses. */
export function assertSoundscaperDesktopProjectLibraryV11RendererComposition(
	profileValue: EditorProjectRuntimeProfile | unknown,
	store: unknown,
	renderer: unknown,
): asserts renderer is SoundscaperDesktopProjectLibraryV11Renderer {
	assertSoundscaperProductionProfile(profileValue)
	const composition = RENDERER_COMPOSITIONS.get(renderer as object)
	if (!composition || composition.profile !== profileValue || composition.store !== store) {
		throw new TypeError('The exact admitted Soundscaper desktop V11 renderer composition is required.')
	}
}

class Renderer implements SoundscaperDesktopProjectLibraryV11Renderer {
	readonly #profile: EditorProjectRuntimeProfile
	readonly #store: SoundscaperDesktopProjectLibraryV11ShadowStore
	readonly #bridge: SoundscaperDesktopV11RendererBridge
	readonly #ledger: SoundscaperDesktopV11WitnessLedger
	readonly #catalog: SoundscaperDesktopV11RendererCatalog
	#tail: Promise<void> = Promise.resolve()

	constructor(
		profile: EditorProjectRuntimeProfile,
		store: SoundscaperDesktopProjectLibraryV11ShadowStore,
		bridge: SoundscaperDesktopV11RendererBridge,
		intents: SoundscaperDesktopV11DeleteIntents,
	) {
		this.#profile = profile
		this.#store = store
		this.#bridge = bridge
		this.#ledger = new SoundscaperDesktopV11WitnessLedger(profile)
		this.#catalog = new SoundscaperDesktopV11RendererCatalog({
			profile,
			store,
			bridge,
			ledger: this.#ledger,
			intents,
			reconcile: (snapshot) => this.#reconcile(snapshot),
		})
	}

	listProjects(): Promise<readonly Readonly<SoundscaperDesktopV11ProjectSummary>[]> {
		return this.#exclusive(() => this.#catalog.listProjects())
	}

	readProject(projectIdValue: string, optionsValue: Readonly<{ signal?: AbortSignal }> = {}) {
		const projectId = validateSoundscaperDesktopV11ProjectId(projectIdValue)
		const signal = signalOptions(optionsValue)
		return this.#exclusive(() => this.#readProject(projectId, signal))
	}

	createScapeProjectIfAbsent(projectValue: unknown): Promise<SoundscaperProductionProject | null> {
		const request = rendererPublicationRequest(this.#profile, { project: projectValue })
		const projectId = validateSoundscaperDesktopV11ProjectId(String(request.project.id))
		return this.#exclusive(async () => {
			if (await this.#readProject(projectId, request.signal) !== null) return null
			return this.#publishFromWitness(request, true)
		})
	}

	publishProject(requestValue: unknown) {
		const request = rendererPublicationRequest(this.#profile, requestValue)
		return this.#exclusive(() => this.#publishFromWitness(request))
	}

	deleteProject(projectIdValue: string): Promise<void> {
		return this.#exclusive(() => this.#catalog.deleteProject(projectIdValue))
	}

	deleteProjectIfCurrent(projectValue: unknown): Promise<boolean> {
		const expected = soundscaperProductionProjectClone(this.#profile, projectValue)
		const projectId = validateSoundscaperDesktopV11ProjectId(String(expected.id))
		return this.#exclusive(async () => {
			const current = await this.#readProject(projectId)
			if (current === null || !sameSoundscaperDesktopV11Project(current, expected)) return false
			await this.#catalog.deleteProject(projectId)
			if (!await this.#catalog.settleDeletedProject(projectId)) {
				throw new Error('The exact Scape rollback delete could not be settled.')
			}
			return true
		})
	}

	cleanupDeletedProject(projectIdValue: string): Promise<boolean> {
		return this.#exclusive(() => this.#catalog.cleanupDeletedProject(projectIdValue))
	}

	settleDeletedProject(projectIdValue: string): Promise<boolean> {
		return this.#exclusive(() => this.#catalog.settleDeletedProject(projectIdValue))
	}

	duplicateProject(sourceProjectId: string, options: Readonly<SoundscaperDesktopV11DuplicateOptions>) {
		return this.#exclusive(() => this.#catalog.duplicateProject(sourceProjectId, options))
	}
	persistNativePluginState(bytesValue: Uint8Array) {
		const bytes = validateSoundscaperNativePluginStateBytesV1(bytesValue)
		return this.#exclusive(async () => validateSoundscaperPersistedNativePluginStateBodyV1(
			await this.#bridge.persistNativePluginState(bytes),
			bytes,
		))
	}

	readNativePluginState(bodyIdValue: string) {
		const bodyId = validateSoundscaperNativePluginStateBodyIdV1(bodyIdValue)
		return this.#exclusive(async () => {
			const result = await this.#bridge.readNativePluginState(bodyId)
			return result === null ? null : validateSoundscaperNativePluginStateBodyRecordV1(result)
		})
	}

	async #publishFromWitness(
		request: RendererPublication,
		allowImportedRevision = false,
	): Promise<SoundscaperProductionProject> {
		const projectId = validateSoundscaperDesktopV11ProjectId(String(request.project.id))
		await this.#catalog.observeCatalog()
		const witness = this.#ledger.take(projectId)
		if (witness.kind === 'absent') {
			if (!allowImportedRevision && Number(request.project.revision) !== 0) {
				throw new Error('The desktop V11 absence witness can publish only fresh revision zero.')
			}
		} else if (!isStrictlyHigherProjectRevision(
			request.project.revision,
			witness.expectedProject.projectRevision,
		)) {
			throw new Error('The desktop V11 publication is stale against its private revision witness.')
		}
		try {
			return await this.#publish(Object.freeze({
				...request,
				allowImportedRevision,
				expectedMetadataRevision: witness.expectedMetadataRevision,
				expectedProject: witness.kind === 'absent' ? null : witness.expectedProject,
			}))
		} catch (error) {
			this.#ledger.clear()
			throw error
		}
	}

	async #readProject(
		projectId: string,
		signal?: AbortSignal,
	): Promise<SoundscaperProductionProject | null> {
		throwIfScapeAborted(signal)
		const raw = await this.#bridge.readProjectBundle(projectId)
		throwIfScapeAborted(signal)
		if (raw === null) {
			const catalog = validateSoundscaperDesktopV11CatalogSnapshot(await this.#bridge.listProjects())
			throwIfScapeAborted(signal)
			if (catalog.projects.some(({ id }) => id === projectId)) {
				throw new Error('The desktop V11 project bundle is absent from a catalog that still owns it.')
			}
			this.#ledger.rememberAbsent(projectId, catalog.metadataRevision)
			return null
		}
		const snapshot = validateSoundscaperDesktopV11Bundle(this.#profile, raw, projectId)
		const project = await this.#reconcile(snapshot, signal)
		this.#ledger.rememberCurrent(snapshot)
		return project
	}

	async #publish(request: NormalizedPublication): Promise<SoundscaperProductionProject> {
		throwIfScapeAborted(request.signal)
		const projectId = validateSoundscaperDesktopV11ProjectId(String(request.project.id))
		const currentValue = await this.#store.loadProject(
			projectId, request.signal ? { signal: request.signal } : {},
		)
		const current = currentValue == null ? null : soundscaperProductionProjectClone(this.#profile, currentValue)
		assertLocalCas(this.#profile, current, request)
		const planned = soundscaperDesktopV11BodiesForProject(
			this.#profile, request.project, request.documentSha256,
		)
		const publicationId = createSoundscaperDesktopV11PublicationId()
		let committed = false
		try {
			const admission = validateSoundscaperDesktopV11Admission(await this.#bridge.beginPublication({
				publicationId,
				expectedMetadataRevision: request.expectedMetadataRevision,
				expectedProject: request.expectedProject,
				project: request.project,
				bodies: planned.bodies,
			}), planned.bodies.length)
			if (admission.publicationId !== publicationId) {
				throw new Error('The desktop V11 publication admission changed its renderer operation id.')
			}
			for (const [bodyIndex, body] of planned.bodies.entries()) {
				await this.#uploadBody(publicationId, bodyIndex, body, request.project, request.signal)
			}
			throwIfScapeAborted(request.signal)
			const result = validateSoundscaperDesktopV11Bundle(
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
			if (error instanceof SoundscaperDesktopProjectLibraryV11IndeterminateError) throw error
			if (committed) {
				throw new SoundscaperDesktopProjectLibraryV11CommittedError('publication', projectId, error)
			}
			let primary = error
			try { validateSoundscaperDesktopV11Abort(await this.#bridge.abortPublication({ publicationId })) }
			catch (cleanupError) {
				primary = new AggregateError(
					[error, cleanupError],
					'Soundscaper desktop V11 publication and abort both failed.',
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
				throw new SoundscaperDesktopProjectLibraryV11CommittedError(
					'publication', projectId, reconcileError,
				)
			}
		}
	}

	async #uploadBody(
		publicationId: string,
		bodyIndex: number,
		descriptor: Readonly<SoundscaperDesktopV11Body>,
		project: SoundscaperProductionProject,
		signal?: AbortSignal,
	): Promise<void> {
		await streamSoundscaperDesktopV11FreezeBody(
			project,
			descriptor,
			this.#store,
			async (offset, bytes, final) => {
				const acknowledgement = await this.#bridge.writePublicationChunk({
					publicationId, bodyIndex, offset, bytes,
				})
				validateSoundscaperDesktopV11Acknowledgement(
					acknowledgement, bodyIndex, offset + bytes.byteLength, final,
				)
			},
			signal,
		)
	}

	async #reconcile(
		snapshot: Readonly<SoundscaperDesktopV11BundleSnapshot>,
		signal?: AbortSignal,
	): Promise<SoundscaperProductionProject> {
		throwIfScapeAborted(signal)
		const currentValue = await this.#store.loadProject(
			snapshot.bundle.project.projectId, signal ? { signal } : {},
		)
		const current = currentValue == null ? null : soundscaperProductionProjectClone(this.#profile, currentValue)
		const mode = shadowMode(current, snapshot.project)
		const acquisition = await acquireSoundscaperDesktopV11FreezeBodies(
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
			if (result == null) throw new Error('The renderer shadow changed before desktop reconciliation.')
			const project = soundscaperProductionProjectClone(this.#profile, result)
			if (!sameSoundscaperDesktopV11Project(project, snapshot.project)) {
				throw new Error('The renderer shadow changed its desktop project document.')
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
	readonly project: SoundscaperProductionProject
	readonly document: string
	readonly documentSha256: string
	readonly signal?: AbortSignal
}

interface NormalizedPublication extends RendererPublication {
	readonly allowImportedRevision: boolean
	readonly expectedMetadataRevision: number
	readonly expectedProject: Readonly<{ readonly projectRevision: number; readonly projectSha256: string }> | null
}

function rendererPublicationRequest(profile: EditorProjectRuntimeProfile, value: unknown): RendererPublication {
	const raw = allowedRecord(
		value, PUBLICATION_REQUIRED_FIELDS, PUBLICATION_OPTIONAL_FIELDS, 'Soundscaper desktop V11 publication',
	)
	const snapshot = snapshotSoundscaperDesktopV11Project(profile, raw.project)
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
	current: SoundscaperProductionProject | null,
	request: NormalizedPublication,
): void {
	if (request.expectedProject === null) {
		if (current !== null || (!request.allowImportedRevision && Number(request.project.revision) !== 0)) {
			throw new Error('Desktop create requires an absent V21 shadow and fresh revision zero.')
		}
		return
	}
	if (!current || String(current.id) !== String(request.project.id)) {
		throw new Error('Desktop publication requires its exact reconciled V21 shadow base.')
	}
	const snapshot = snapshotSoundscaperDesktopV11Project(profile, current)
	if (Number(current.revision) !== request.expectedProject.projectRevision
		|| snapshot.sha256 !== request.expectedProject.projectSha256
		|| !isStrictlyHigherProjectRevision(request.project.revision, current.revision)) {
		throw new Error('The V21 shadow failed the desktop publication compare-and-swap.')
	}
}

function assertPublicationResult(
	request: NormalizedPublication,
	result: Readonly<SoundscaperDesktopV11BundleSnapshot>,
): void {
	if (result.bundle.metadataRevision !== request.expectedMetadataRevision + 1
		|| result.bundle.document !== request.document
		|| result.bundle.project.sha256 !== request.documentSha256) {
		throw new Error('The committed desktop V11 publication changed its requested project.')
	}
}

function shadowMode(
	current: SoundscaperProductionProject | null,
	project: SoundscaperProductionProject,
): 'create' | 'same' | 'update' {
	if (current === null) {
		return 'create'
	}
	if (sameSoundscaperDesktopV11Project(current, project)) return 'same'
	const revision = Number(current.revision)
	if (String(current.id) !== String(project.id) || !Number.isSafeInteger(revision)
		|| !isStrictlyHigherProjectRevision(project.revision, revision)) {
		throw new Error('Desktop reconciliation requires a strictly higher V21 shadow revision.')
	}
	return 'update'
}

function assertShadowStore(value: unknown): asserts value is SoundscaperDesktopProjectLibraryV11ShadowStore {
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
	const raw = allowedRecord(value, [], SIGNAL_FIELDS, 'Soundscaper desktop V11 read options')
	return raw.signal === undefined ? undefined : abortSignal(raw.signal)
}

function abortSignal(value: unknown): AbortSignal {
	if (!(value instanceof AbortSignal)) throw new TypeError('A Soundscaper desktop V11 AbortSignal is required.')
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
