/* SPDX-License-Identifier: AGPL-3.0-only */

import { throwIfScapeAborted } from '../common/editor/scape-abort.ts'
import { isStrictlyHigherProjectRevision } from '../common/editor/project-revision-cas.ts'
import type { EditorProjectRuntimeProfile } from '../common/editor/project-runtime-profile.ts'
import {
	assertSoundscaperProjectProfile,
	soundscaperProjectClone,
} from './editor-project-profile.ts'
import { soundscaperProjectStoreAuthority } from './editor-project-store.ts'
import type { SoundscaperProject } from './editor-project-validation.ts'
import {
	soundscaperDesktopBodiesForProject,
	resolveSoundscaperDesktopRendererBridge,
	snapshotSoundscaperDesktopProject,
	validateSoundscaperDesktopAbort,
	validateSoundscaperDesktopAcknowledgement,
	validateSoundscaperDesktopAdmission,
	validateSoundscaperDesktopBundle,
	validateSoundscaperDesktopCatalogSnapshot,
	validateSoundscaperDesktopProjectId,
	validateSoundscaperDesktopRendererHandshake,
	type SoundscaperDesktopBody,
	type SoundscaperDesktopBundleSnapshot,
	type SoundscaperDesktopProjectSummary,
	type SoundscaperDesktopRendererBridge,
} from './desktop-project-library-renderer-contract.ts'
import {
	acquireSoundscaperDesktopFreezeBodies,
	streamSoundscaperDesktopFreezeBody,
	type SoundscaperDesktopFreezeStore,
} from './desktop-project-library-freeze-media.ts'
import {
	SoundscaperDesktopProjectLibraryCommittedError,
	SoundscaperDesktopProjectLibraryIndeterminateError,
	SoundscaperDesktopRendererCatalog,
	type SoundscaperDesktopRawShadowProjectStore,
} from './desktop-project-library-renderer-catalog.ts'
import {
	createSoundscaperDesktopPublicationId,
	SoundscaperDesktopWitnessLedger,
	sameSoundscaperDesktopProject,
	type SoundscaperDesktopDuplicateOptions,
} from './desktop-project-library-renderer-lifecycle.ts'
import {
	SoundscaperDesktopDeleteIntents,
	reconcileSoundscaperDesktopDeleteIntents,
	type SoundscaperDesktopDeleteIntentStore,
} from './desktop-project-library-delete-intents.ts'
import {
	validateSoundscaperNativePluginStateBodyIdV1,
	validateSoundscaperNativePluginStateBodyRecordV1,
	validateSoundscaperNativePluginStateBytesV1,
	validateSoundscaperPersistedNativePluginStateBodyV1,
	type SoundscaperDesktopNativePluginStateBodyDescriptorV1,
	type SoundscaperDesktopNativePluginStateBodyRecordV1,
} from './desktop-native-plugin-state-transport-v1.ts'
export interface SoundscaperDesktopProjectLibraryRendererComposition {
	readonly store: SoundscaperDesktopProjectLibraryShadowStore
}

export interface SoundscaperDesktopProjectLibraryShadowStore extends
	SoundscaperDesktopFreezeStore, SoundscaperDesktopRawShadowProjectStore {
	readonly databaseName: string
	loadProject(projectId: string, options?: Readonly<{ signal?: AbortSignal }>): PromiseLike<unknown> | unknown
	getStatus(): unknown
	readonly projectRepository: SoundscaperDesktopRawShadowProjectStore['projectRepository'] & Readonly<{
		createForScapeImportIfAbsent(project: SoundscaperProject): PromiseLike<unknown> | unknown
		saveIfCurrent(
			expected: SoundscaperProject,
			project: SoundscaperProject,
		): PromiseLike<unknown> | unknown
	}>
	readonly settingsRepository: SoundscaperDesktopDeleteIntentStore
	readonly linkedOriginalStoreService: Readonly<{
		deleteProject<Value>(projectId: string, operation: () => PromiseLike<Value> | Value): Promise<Value>
	}>
}

export interface SoundscaperDesktopProjectLibraryRenderer {
	listProjects(): Promise<readonly Readonly<SoundscaperDesktopProjectSummary>[]>
	readProject(projectId: string, options?: Readonly<{ signal?: AbortSignal }>): Promise<SoundscaperProject | null>
	createScapeProjectIfAbsent(project: unknown): Promise<SoundscaperProject | null>
	publishProject(request: Readonly<{ readonly project: unknown; readonly signal?: AbortSignal }> | unknown):
		Promise<SoundscaperProject>
	deleteProject(projectId: string): Promise<void>
	deleteProjectIfCurrent(project: unknown): Promise<boolean>
	cleanupDeletedProject(projectId: string): Promise<boolean>
	settleDeletedProject(projectId: string): Promise<boolean>
	duplicateProject(
		sourceProjectId: string,
		options: Readonly<SoundscaperDesktopDuplicateOptions>,
	): Promise<SoundscaperProject>
	persistNativePluginState(bytes: Uint8Array): Promise<Readonly<SoundscaperDesktopNativePluginStateBodyDescriptorV1>>
	readNativePluginState(bodyId: string): Promise<Readonly<SoundscaperDesktopNativePluginStateBodyRecordV1> | null>
}

const RENDERER_COMPOSITIONS = new WeakMap<object, Readonly<{
	readonly profile: EditorProjectRuntimeProfile
	readonly store: SoundscaperDesktopProjectLibraryShadowStore
}>>()

export {
	SoundscaperDesktopProjectLibraryCommittedError,
	SoundscaperDesktopProjectLibraryIndeterminateError,
} from './desktop-project-library-renderer-catalog.ts'

const PUBLICATION_REQUIRED_FIELDS = ['project'] as const
const PUBLICATION_OPTIONAL_FIELDS = ['signal'] as const
const SIGNAL_FIELDS = ['signal'] as const

/** Connect the packaged  bridge only to one authenticated durable V21 shadow. */
export async function connectSoundscaperDesktopProjectLibraryRenderer(
	profileValue: EditorProjectRuntimeProfile | unknown,
	compositionValue: SoundscaperDesktopProjectLibraryRendererComposition | unknown,
): Promise<SoundscaperDesktopProjectLibraryRenderer | null> {
	assertSoundscaperProjectProfile(profileValue)
	const profile = profileValue
	const composition = allowedRecord(
		compositionValue, ['store'], [], 'Soundscaper desktop  renderer composition',
	)
	const store = composition.store as SoundscaperDesktopProjectLibraryShadowStore
	soundscaperProjectStoreAuthority(profile, store)
	assertShadowStore(store)
	const bridge = resolveSoundscaperDesktopRendererBridge()
	if (!bridge) return null
	const status = store.getStatus() as Readonly<Record<string, unknown>>
	if (!status || status.state !== 'indexeddb' || status.persistent !== true) {
		throw new Error('The desktop  lifecycle requires a durable IndexedDB V21 shadow.')
	}
	const handshake = await bridge.connect()
	validateSoundscaperDesktopRendererHandshake(handshake, profile)
	if (bridge.handshakeState() !== 'admitted') {
		throw new TypeError('The Soundscaper desktop  bridge did not retain its admitted handshake.')
	}
	const intents = new SoundscaperDesktopDeleteIntents(store.settingsRepository)
	await reconcileSoundscaperDesktopDeleteIntents({ profile, bridge, shadow: store, intents })
	const renderer = Object.freeze(new Renderer(profile, store, bridge, intents))
	RENDERER_COMPOSITIONS.set(renderer, Object.freeze({ profile, store }))
	return renderer
}

/** Authenticate the renderer/store pair without exposing its bridge or CAS witnesses. */
export function assertSoundscaperDesktopProjectLibraryRendererComposition(
	profileValue: EditorProjectRuntimeProfile | unknown,
	store: unknown,
	renderer: unknown,
): asserts renderer is SoundscaperDesktopProjectLibraryRenderer {
	assertSoundscaperProjectProfile(profileValue)
	const composition = RENDERER_COMPOSITIONS.get(renderer as object)
	if (!composition || composition.profile !== profileValue || composition.store !== store) {
		throw new TypeError('The exact admitted Soundscaper desktop  renderer composition is required.')
	}
}

class Renderer implements SoundscaperDesktopProjectLibraryRenderer {
	readonly #profile: EditorProjectRuntimeProfile
	readonly #store: SoundscaperDesktopProjectLibraryShadowStore
	readonly #bridge: SoundscaperDesktopRendererBridge
	readonly #ledger: SoundscaperDesktopWitnessLedger
	readonly #catalog: SoundscaperDesktopRendererCatalog
	#tail: Promise<void> = Promise.resolve()

	constructor(
		profile: EditorProjectRuntimeProfile,
		store: SoundscaperDesktopProjectLibraryShadowStore,
		bridge: SoundscaperDesktopRendererBridge,
		intents: SoundscaperDesktopDeleteIntents,
	) {
		this.#profile = profile
		this.#store = store
		this.#bridge = bridge
		this.#ledger = new SoundscaperDesktopWitnessLedger(profile)
		this.#catalog = new SoundscaperDesktopRendererCatalog({
			profile,
			store,
			bridge,
			ledger: this.#ledger,
			intents,
			reconcile: (snapshot) => this.#reconcile(snapshot),
		})
	}

	listProjects(): Promise<readonly Readonly<SoundscaperDesktopProjectSummary>[]> {
		return this.#exclusive(() => this.#catalog.listProjects())
	}

	readProject(projectIdValue: string, optionsValue: Readonly<{ signal?: AbortSignal }> = {}) {
		const projectId = validateSoundscaperDesktopProjectId(projectIdValue)
		const signal = signalOptions(optionsValue)
		return this.#exclusive(() => this.#readProject(projectId, signal))
	}

	createScapeProjectIfAbsent(projectValue: unknown): Promise<SoundscaperProject | null> {
		const request = rendererPublicationRequest(this.#profile, { project: projectValue })
		const projectId = validateSoundscaperDesktopProjectId(String(request.project.id))
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
		const expected = soundscaperProjectClone(this.#profile, projectValue)
		const projectId = validateSoundscaperDesktopProjectId(String(expected.id))
		return this.#exclusive(async () => {
			const current = await this.#readProject(projectId)
			if (current === null || !sameSoundscaperDesktopProject(current, expected)) return false
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

	duplicateProject(sourceProjectId: string, options: Readonly<SoundscaperDesktopDuplicateOptions>) {
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
	): Promise<SoundscaperProject> {
		const projectId = validateSoundscaperDesktopProjectId(String(request.project.id))
		await this.#catalog.observeCatalog()
		const witness = this.#ledger.take(projectId)
		if (witness.kind === 'absent') {
			if (!allowImportedRevision && Number(request.project.revision) !== 0) {
				throw new Error('The desktop  absence witness can publish only fresh revision zero.')
			}
		} else if (!isStrictlyHigherProjectRevision(
			request.project.revision,
			witness.expectedProject.projectRevision,
		)) {
			throw new Error('The desktop  publication is stale against its private revision witness.')
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
	): Promise<SoundscaperProject | null> {
		throwIfScapeAborted(signal)
		const raw = await this.#bridge.readProjectBundle(projectId)
		throwIfScapeAborted(signal)
		if (raw === null) {
			const catalog = validateSoundscaperDesktopCatalogSnapshot(await this.#bridge.listProjects())
			throwIfScapeAborted(signal)
			if (catalog.projects.some(({ id }) => id === projectId)) {
				throw new Error('The desktop  project bundle is absent from a catalog that still owns it.')
			}
			this.#ledger.rememberAbsent(projectId, catalog.metadataRevision)
			return null
		}
		const snapshot = validateSoundscaperDesktopBundle(this.#profile, raw, projectId)
		const project = await this.#reconcile(snapshot, signal)
		this.#ledger.rememberCurrent(snapshot)
		return project
	}

	async #publish(request: NormalizedPublication): Promise<SoundscaperProject> {
		throwIfScapeAborted(request.signal)
		const projectId = validateSoundscaperDesktopProjectId(String(request.project.id))
		const currentValue = await this.#store.loadProject(
			projectId, request.signal ? { signal: request.signal } : {},
		)
		const current = currentValue == null ? null : soundscaperProjectClone(this.#profile, currentValue)
		assertLocalCas(this.#profile, current, request)
		const planned = soundscaperDesktopBodiesForProject(
			this.#profile, request.project, request.documentSha256,
		)
		const publicationId = createSoundscaperDesktopPublicationId()
		let committed = false
		try {
			const admission = validateSoundscaperDesktopAdmission(await this.#bridge.beginPublication({
				publicationId,
				expectedMetadataRevision: request.expectedMetadataRevision,
				expectedProject: request.expectedProject,
				project: request.project,
				bodies: planned.bodies,
			}), planned.bodies.length)
			if (admission.publicationId !== publicationId) {
				throw new Error('The desktop  publication admission changed its renderer operation id.')
			}
			for (const [bodyIndex, body] of planned.bodies.entries()) {
				await this.#uploadBody(publicationId, bodyIndex, body, request.project, request.signal)
			}
			throwIfScapeAborted(request.signal)
			const result = validateSoundscaperDesktopBundle(
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
			if (error instanceof SoundscaperDesktopProjectLibraryIndeterminateError) throw error
			if (committed) {
				throw new SoundscaperDesktopProjectLibraryCommittedError('publication', projectId, error)
			}
			let primary = error
			try { validateSoundscaperDesktopAbort(await this.#bridge.abortPublication({ publicationId })) }
			catch (cleanupError) {
				primary = new AggregateError(
					[error, cleanupError],
					'Soundscaper desktop  publication and abort both failed.',
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
				throw new SoundscaperDesktopProjectLibraryCommittedError(
					'publication', projectId, reconcileError,
				)
			}
		}
	}

	async #uploadBody(
		publicationId: string,
		bodyIndex: number,
		descriptor: Readonly<SoundscaperDesktopBody>,
		project: SoundscaperProject,
		signal?: AbortSignal,
	): Promise<void> {
		await streamSoundscaperDesktopFreezeBody(
			project,
			descriptor,
			this.#store,
			async (offset, bytes, final) => {
				const acknowledgement = await this.#bridge.writePublicationChunk({
					publicationId, bodyIndex, offset, bytes,
				})
				validateSoundscaperDesktopAcknowledgement(
					acknowledgement, bodyIndex, offset + bytes.byteLength, final,
				)
			},
			signal,
		)
	}

	async #reconcile(
		snapshot: Readonly<SoundscaperDesktopBundleSnapshot>,
		signal?: AbortSignal,
	): Promise<SoundscaperProject> {
		throwIfScapeAborted(signal)
		const currentValue = await this.#store.loadProject(
			snapshot.bundle.project.projectId, signal ? { signal } : {},
		)
		const current = currentValue == null ? null : soundscaperProjectClone(this.#profile, currentValue)
		const mode = shadowMode(current, snapshot.project)
		const acquisition = await acquireSoundscaperDesktopFreezeBodies(
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
			const project = soundscaperProjectClone(this.#profile, result)
			if (!sameSoundscaperDesktopProject(project, snapshot.project)) {
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
	readonly project: SoundscaperProject
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
		value, PUBLICATION_REQUIRED_FIELDS, PUBLICATION_OPTIONAL_FIELDS, 'Soundscaper desktop  publication',
	)
	const snapshot = snapshotSoundscaperDesktopProject(profile, raw.project)
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
	current: SoundscaperProject | null,
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
	const snapshot = snapshotSoundscaperDesktopProject(profile, current)
	if (Number(current.revision) !== request.expectedProject.projectRevision
		|| snapshot.sha256 !== request.expectedProject.projectSha256
		|| !isStrictlyHigherProjectRevision(request.project.revision, current.revision)) {
		throw new Error('The V21 shadow failed the desktop publication compare-and-swap.')
	}
}

function assertPublicationResult(
	request: NormalizedPublication,
	result: Readonly<SoundscaperDesktopBundleSnapshot>,
): void {
	if (result.bundle.metadataRevision !== request.expectedMetadataRevision + 1
		|| result.bundle.document !== request.document
		|| result.bundle.project.sha256 !== request.documentSha256) {
		throw new Error('The committed desktop  publication changed its requested project.')
	}
}

function shadowMode(
	current: SoundscaperProject | null,
	project: SoundscaperProject,
): 'create' | 'same' | 'update' {
	if (current === null) {
		return 'create'
	}
	if (sameSoundscaperDesktopProject(current, project)) return 'same'
	const revision = Number(current.revision)
	if (String(current.id) !== String(project.id) || !Number.isSafeInteger(revision)
		|| !isStrictlyHigherProjectRevision(project.revision, revision)) {
		throw new Error('Desktop reconciliation requires a strictly higher V21 shadow revision.')
	}
	return 'update'
}

function assertShadowStore(value: unknown): asserts value is SoundscaperDesktopProjectLibraryShadowStore {
	if (!value || typeof value !== 'object') throw new TypeError('The exact Soundscaper baseline shadow store is required.')
	const repository = ownData(value, 'projectRepository', 'Soundscaper baseline shadow store')
	const settings = ownData(value, 'settingsRepository', 'Soundscaper baseline shadow store')
	const lifecycle = ownData(value, 'linkedOriginalStoreService', 'Soundscaper baseline shadow store')
	if (!repository || typeof repository !== 'object' || !settings || typeof settings !== 'object'
		|| !lifecycle || typeof lifecycle !== 'object') {
		throw new TypeError('The exact Soundscaper baseline shadow repositories are required.')
	}
	for (const method of ['deleteExact', 'createForScapeImportIfAbsent', 'saveIfCurrent'] as const) {
		if (typeof inheritedData(repository, method) !== 'function') {
			throw new TypeError(`The Soundscaper baseline shadow project repository requires ${method}.`)
		}
	}
	for (const method of ['putIfAbsent', 'deleteIfCurrent', 'listByPrefix'] as const) {
		if (typeof inheritedData(settings, method) !== 'function') {
			throw new TypeError(`The Soundscaper baseline settings repository requires ${method}.`)
		}
	}
	for (const method of [
		'loadProject', 'getStatus', 'getSourceMetadata', 'readSourceChunks',
		'beginSourceWrite', 'discardSourceIfCurrent',
	] as const) {
		if (typeof inheritedData(value, method) !== 'function') {
			throw new TypeError(`The Soundscaper baseline shadow store requires ${method}.`)
		}
	}
	if (typeof inheritedData(lifecycle, 'deleteProject') !== 'function'
		|| typeof ownData(value, 'databaseName', 'Soundscaper baseline shadow store') !== 'string') {
		throw new TypeError('The exact Soundscaper baseline shadow lifecycle is required.')
	}
}

function signalOptions(value: unknown): AbortSignal | undefined {
	const raw = allowedRecord(value, [], SIGNAL_FIELDS, 'Soundscaper desktop  read options')
	return raw.signal === undefined ? undefined : abortSignal(raw.signal)
}

function abortSignal(value: unknown): AbortSignal {
	if (!(value instanceof AbortSignal)) throw new TypeError('A Soundscaper desktop  AbortSignal is required.')
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
