/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { register } from 'node:module'
import test, { type TestContext } from 'node:test'

import {
	createSoundscaperDesktopProjectLibraryV10Handshake,
} from '../desktop/soundscaper-project-library-v10-contract.ts'
import { createDefaultMixerGraphV21 } from '../src/common/editor/mixer-graph-v21.ts'
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import {
	connectSoundscaperDesktopProjectLibraryV10Renderer,
	type SoundscaperDesktopProjectLibraryV10ShadowStore,
} from '../src/soundscaper/desktop-project-library-v10-renderer.ts'
import {
	soundscaperDesktopV10BodiesForProject,
	snapshotSoundscaperDesktopV10Project,
	type SoundscaperDesktopV10Body,
} from '../src/soundscaper/desktop-project-library-v10-renderer-contract.ts'
import {
	createSoundscaperDesktopProjectStoreV10Adapter,
} from '../src/soundscaper/desktop-project-library-v10-store-adapter.ts'
import { createProjectSaveService } from '../src/common/editor/controller/project-save-service.ts'
import { SOUNDSCAPER_V23_PROJECT_RUNTIME_PROFILE } from '../src/soundscaper/editor-project-runtime-profile-v23.ts'
import { createSoundscaperEditorProjectEnvironmentV23 } from '../src/soundscaper/editor-project-environment-v23.ts'
import { createSoundscaperProjectStoreV23 } from '../src/soundscaper/editor-project-store-v23.ts'
import {
	cloneSoundscaperProjectV23,
	createSoundscaperProjectV23,
	type SoundscaperProjectV23,
} from '../src/soundscaper/editor-project-v23.ts'
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js'

const assetLoader = `
	export async function resolve(specifier, context, nextResolve) {
		if (specifier === '@ffmpeg/core?url' || specifier === '@ffmpeg/core/wasm?url') {
			return { url: 'data:text/javascript,export default "mock-ffmpeg-asset"', shortCircuit: true };
		}
		return nextResolve(specifier, context);
	}
`
register(`data:text/javascript,${encodeURIComponent(assetLoader)}`, import.meta.url)

const NOW = '2026-08-14T12:00:00.000Z'
const PCM = canonicalPcm([0.25, -0.5])
const PCM_SHA256 = digest(PCM)

test('renderer and store adapter preserve exact V23 production state and canonical freeze PCM', async (context) => {
	const store = await durableStore(context)
	const project = productionProject('soundscaper-renderer-v23')
	const bridge = new BridgeFixture(project, PCM)
	installBridge(context, bridge.api)
	const renderer = await connectSoundscaperDesktopProjectLibraryV10Renderer(
		SOUNDSCAPER_V23_PROJECT_RUNTIME_PROFILE,
		{ store: store as unknown as SoundscaperDesktopProjectLibraryV10ShadowStore },
	)
	assert.ok(renderer)
	const desktopStore = createSoundscaperDesktopProjectStoreV10Adapter(
		SOUNDSCAPER_V23_PROJECT_RUNTIME_PROFILE,
		{ localStore: store, desktopProjectLibrary: renderer },
	)

	const loaded = await desktopStore.loadProject(String(project.id)) as SoundscaperProjectV23
	assert.deepEqual(productionState(loaded), productionState(project))
	assert.deepEqual(await storedSamples(store, 'derived:freeze-source'), [0.25, -0.5])

	const next = structuredClone(project) as SoundscaperProjectV23 & { revision: number; title: string; updatedAt: string }
	next.revision = 1
	next.title = 'Published exact V23'
	next.updatedAt = '2026-08-14T12:01:00.000Z'
	const saved = await desktopStore.saveProject(next)
	assert.deepEqual(saved, next)
	assert.deepEqual(productionState(saved as SoundscaperProjectV23), productionState(project))
	assert.deepEqual(bridge.uploaded, PCM)
	assert.deepEqual(await store.loadProject(String(project.id)), next)
	assert.equal(desktopStore.preservesProjectsOnClear(), true)
	assert.equal(desktopStore.prepareProjectHandoff, undefined)
})

test('coalesced V23 autosave publishes only the latest higher revision through desktop V10', async (context) => {
	const store = await durableStore(context)
	const current = productionProject('soundscaper-coalesced-autosave')
	const bridge = new BridgeFixture(current, PCM)
	installBridge(context, bridge.api)
	const renderer = await connectSoundscaperDesktopProjectLibraryV10Renderer(
		SOUNDSCAPER_V23_PROJECT_RUNTIME_PROFILE,
		{ store: store as unknown as SoundscaperDesktopProjectLibraryV10ShadowStore },
	)
	assert.ok(renderer)
	const desktopStore = createSoundscaperDesktopProjectStoreV10Adapter(
		SOUNDSCAPER_V23_PROJECT_RUNTIME_PROFILE,
		{ localStore: store, desktopProjectLibrary: renderer },
	)
	await desktopStore.loadProject(String(current.id))

	let project = revisedProject(current, 1, 'First coalesced edit', '2026-08-14T12:01:00.000Z')
	const timers = new Map<number, () => void>()
	const savedRevisions: number[] = []
	const errors: unknown[] = []
	let nextTimer = 0
	const state = {
		autosaveTimer: 0,
		saveGeneration: 0,
		pendingSaveSnapshots: new Set<SoundscaperProjectV23>(),
		saveQueue: Promise.resolve<unknown>(undefined),
		saveState: 'saved',
	}
	const saves = createProjectSaveService({
		state,
		getProject: () => project,
		hasHistory: () => true,
		isReadOnly: () => false,
		cloneProject: (value) => structuredClone(value),
		admitProjectPublication: async () => undefined,
		saveProject: async (snapshot) => {
			savedRevisions.push(Number(snapshot.revision))
			await desktopStore.saveProject(snapshot)
		},
		persistActiveProjectId: async () => undefined,
		isCurrentProject: (projectId) => projectId === project.id,
		hasSessionTab: () => true,
		markProjectSaved: () => undefined,
		publish: () => undefined,
		garbageCollect: async () => undefined,
		refreshStorageUsage: async () => undefined,
		handleError: (error) => { errors.push(error) },
		scheduleTimer: (callback) => {
			nextTimer += 1
			timers.set(nextTimer, callback)
			return nextTimer
		},
		clearTimer: (handle) => { timers.delete(handle) },
	})

	assert.equal(saves.scheduleAutosave(), true)
	const supersededTimer = state.autosaveTimer
	project = revisedProject(current, 2, 'Second coalesced edit', '2026-08-14T12:02:00.000Z')
	assert.equal(saves.scheduleAutosave(), true)
	assert.equal(timers.has(supersededTimer), false)
	const latestTimer = timers.get(state.autosaveTimer)
	assert.ok(latestTimer)
	latestTimer()
	await saves.drain()

	assert.deepEqual(savedRevisions, [2])
	assert.deepEqual(errors, [])
	assert.equal(bridge.metadataRevision, 2, 'one publication advances metadata by one')
	assert.equal(bridge.projectRevision(String(project.id)), 2)
	assert.equal((await store.loadProject(String(project.id)))?.revision, 2)
	assert.equal(state.saveState, 'saved')
})

test('desktop V10 reconciles an authoritative revision jump but refuses a local-ahead shadow', async (context) => {
	const store = await durableStore(context)
	const current = productionProject('soundscaper-authoritative-revision-jump')
	const bridge = new BridgeFixture(current, PCM)
	installBridge(context, bridge.api)
	const renderer = await connectSoundscaperDesktopProjectLibraryV10Renderer(
		SOUNDSCAPER_V23_PROJECT_RUNTIME_PROFILE,
		{ store: store as unknown as SoundscaperDesktopProjectLibraryV10ShadowStore },
	)
	assert.ok(renderer)
	const desktopStore = createSoundscaperDesktopProjectStoreV10Adapter(
		SOUNDSCAPER_V23_PROJECT_RUNTIME_PROFILE,
		{ localStore: store, desktopProjectLibrary: renderer },
	)
	await desktopStore.loadProject(String(current.id))
	const authoritative = revisedProject(
		current, 2, 'Authoritative coalesced revision', '2026-08-14T12:02:00.000Z',
	)
	bridge.replaceAuthoritative(authoritative)
	assert.deepEqual(await desktopStore.loadProject(String(current.id)), authoritative)
	assert.deepEqual(await store.loadProject(String(current.id)), authoritative)

	const localAhead = revisedProject(
		authoritative, 3, 'Unpublished local-ahead revision', '2026-08-14T12:03:00.000Z',
	)
	const saveIfCurrent = store.projectRepository.saveIfCurrent
	assert.ok(saveIfCurrent)
	assert.deepEqual(
		await saveIfCurrent.call(store.projectRepository, authoritative, localAhead),
		localAhead,
	)
	await assert.rejects(
		desktopStore.loadProject(String(current.id)),
		/strictly higher.*shadow revision/iu,
	)
	assert.deepEqual(await store.loadProject(String(current.id)), localAhead)
	assert.equal(bridge.projectRevision(String(current.id)), 2)
})

test('desktop V10 revision jumps retain the exact local base digest compare-and-swap', async (context) => {
	const store = await durableStore(context)
	const current = productionProject('soundscaper-revision-jump-local-cas')
	const bridge = new BridgeFixture(current, PCM)
	installBridge(context, bridge.api)
	const renderer = await connectSoundscaperDesktopProjectLibraryV10Renderer(
		SOUNDSCAPER_V23_PROJECT_RUNTIME_PROFILE,
		{ store: store as unknown as SoundscaperDesktopProjectLibraryV10ShadowStore },
	)
	assert.ok(renderer)
	const desktopStore = createSoundscaperDesktopProjectStoreV10Adapter(
		SOUNDSCAPER_V23_PROJECT_RUNTIME_PROFILE,
		{ localStore: store, desktopProjectLibrary: renderer },
	)
	const loaded = cloneSoundscaperProjectV23(await desktopStore.loadProject(String(current.id)))
	const divergent = revisedProject(
		loaded, 0, 'Divergent local base', '2026-08-14T12:00:00.000Z',
	)
	const saveIfCurrent = store.projectRepository.saveIfCurrent
	assert.ok(saveIfCurrent)
	assert.deepEqual(await saveIfCurrent.call(store.projectRepository, loaded, divergent), divergent)
	await assert.rejects(
		desktopStore.saveProject(revisedProject(
			loaded, 2, 'Rejected coalesced revision', '2026-08-14T12:02:00.000Z',
		)),
		/shadow failed.*compare-and-swap/iu,
	)
	assert.equal(bridge.metadataRevision, 1)
	assert.equal(bridge.projectRevision(String(current.id)), 0)
	assert.deepEqual(await store.loadProject(String(current.id)), divergent)
})

test('renderer refuses corrupt freeze PCM before publishing any V23 shadow or source', async (context) => {
	const store = await durableStore(context)
	const project = productionProject('soundscaper-renderer-corrupt')
	const bridge = new BridgeFixture(project, PCM.slice(0, PCM.byteLength - 1))
	installBridge(context, bridge.api)
	const renderer = await connectSoundscaperDesktopProjectLibraryV10Renderer(
		SOUNDSCAPER_V23_PROJECT_RUNTIME_PROFILE,
		{ store: store as unknown as SoundscaperDesktopProjectLibraryV10ShadowStore },
	)
	assert.ok(renderer)

	await assert.rejects(renderer.readProject(String(project.id)), /length|freeze|body|emitted/iu)
	assert.equal(await store.loadProject(String(project.id)), null)
	assert.equal(await store.getSourceMetadata('derived:freeze-source'), null)
})

test('V23 environment selects the admitted desktop renderer and main-first store overlay', async (context) => {
	const project = productionProject('soundscaper-environment-desktop')
	const bridge = new BridgeFixture(project, PCM)
	installBridge(context, bridge.api)
	const environment = await createSoundscaperEditorProjectEnvironmentV23({
		storeOptions: {
			indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory,
			preferOpfs: false,
		},
	})
	context.after(() => environment.close())
	assert.ok(environment.desktopProjectLibrary)
	assert.notEqual(environment.controllerStore, environment.store)
	const loaded = await environment.controllerStore.loadProject(String(project.id)) as SoundscaperProjectV23
	assert.deepEqual(productionState(loaded), productionState(project))
	assert.deepEqual(await storedSamples(environment.store, 'derived:freeze-source'), [0.25, -0.5])
})

test('desktop V23 bootstrap publishes one canonical revision-zero project before readiness', async (context) => {
	const bridge = new BridgeFixture(null, new Uint8Array())
	installBridge(context, bridge.api)
	const environment = await createSoundscaperEditorProjectEnvironmentV23({
		storeOptions: {
			indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory,
			preferOpfs: false,
		},
	})
	const { createSoundscaperAudioEditorControllerV23 } = await import(
		'../src/soundscaper/editor-controller-v23.ts'
	)
	const controller = createSoundscaperAudioEditorControllerV23(environment)
	context.after(async () => {
		await controller.dispose()
		await environment.close()
	})

	const ready = await controller.ready
	assert.equal(ready.phase, 'ready', JSON.stringify(ready.status))
	assert.equal(ready.project?.revision, 0)
	assert.equal(ready.project?.tracks[0]?.name, 'Track 1')
	assert.equal(bridge.metadataRevision, 1)
	assert.equal(bridge.publicationCount, 1, 'the bootstrap follow-up save must not republish revision zero')
	assert.equal(bridge.projectRevision(String(ready.project?.id)), 0)
})

test('desktop Scape import publishes an exact nonzero V23 project and retains exact rollback', async (context) => {
	const store = await durableStore(context)
	const bridge = new BridgeFixture(null, new Uint8Array())
	installBridge(context, bridge.api)
	const renderer = await connectSoundscaperDesktopProjectLibraryV10Renderer(
		SOUNDSCAPER_V23_PROJECT_RUNTIME_PROFILE,
		{ store: store as unknown as SoundscaperDesktopProjectLibraryV10ShadowStore },
	)
	assert.ok(renderer)
	const desktopStore = createSoundscaperDesktopProjectStoreV10Adapter(
		SOUNDSCAPER_V23_PROJECT_RUNTIME_PROFILE,
		{ localStore: store, desktopProjectLibrary: renderer },
	)
	const imported = revisedProject(
		createSoundscaperProjectV23({ id: 'soundscaper-scape-import', now: NOW }),
		7,
		'Imported exact V23',
		'2026-08-14T12:07:00.000Z',
	)

	const created = await desktopStore.createScapeProjectIfAbsent(imported)
	assert.deepEqual(created, imported)
	assert.equal(bridge.metadataRevision, 1)
	assert.equal(bridge.projectRevision(String(imported.id)), 7)
	assert.deepEqual(await store.loadProject(String(imported.id)), imported)
	assert.equal(await desktopStore.createScapeProjectIfAbsent(imported), null)
	assert.equal(await desktopStore.deleteProjectIfCurrent(created!), true)
	assert.equal(bridge.metadataRevision, 2)
	assert.equal(bridge.projectRevision(String(imported.id)), null)
	assert.equal(await store.loadProject(String(imported.id)), null)
})

test('desktop adapter duplicates and deletes exact V23 projects while retaining shared freeze PCM', async (context) => {
	const store = await durableStore(context)
	const project = productionProject('soundscaper-desktop-lifecycle')
	const bridge = new BridgeFixture(project, PCM)
	installBridge(context, bridge.api)
	const renderer = await connectSoundscaperDesktopProjectLibraryV10Renderer(
		SOUNDSCAPER_V23_PROJECT_RUNTIME_PROFILE,
		{ store: store as unknown as SoundscaperDesktopProjectLibraryV10ShadowStore },
	)
	assert.ok(renderer)
	const desktopStore = createSoundscaperDesktopProjectStoreV10Adapter(
		SOUNDSCAPER_V23_PROJECT_RUNTIME_PROFILE,
		{ localStore: store, desktopProjectLibrary: renderer },
	)
	await desktopStore.loadProject(String(project.id))
	const copy = await desktopStore.duplicateProject(String(project.id), {
		id: 'soundscaper-desktop-lifecycle-copy', title: 'Soundscaper lifecycle copy',
	}) as SoundscaperProjectV23
	assert.equal(copy.id, 'soundscaper-desktop-lifecycle-copy')
	assert.equal(copy.revision, 0)
	assert.deepEqual(productionState(copy), productionState(project))
	assert.deepEqual(await store.loadProject(String(copy.id)), copy)
	await desktopStore.deleteProject(String(project.id))
	assert.equal(await store.loadProject(String(project.id)), null)
	assert.deepEqual(await store.loadProject(String(copy.id)), copy)
	assert.deepEqual(await storedSamples(store, 'derived:freeze-source'), [0.25, -0.5])
	assert.deepEqual((await desktopStore.listProjects()).map(({ id }) => id), [copy.id])
})

class BridgeFixture {
	readonly api
	#connected = false
	#metadataRevision: number
	#publicationCount = 0
	readonly #projects = new Map<string, SoundscaperProjectV23>()
	readonly #bodies = new Map<string, Uint8Array>()
	#active: Readonly<{ project: SoundscaperProjectV23; bodies: readonly Readonly<SoundscaperDesktopV10Body>[] }> | null = null
	#chunks: Uint8Array[] = []
	#offset = 0
	#uploaded: Uint8Array<ArrayBufferLike> = new Uint8Array()

	constructor(project: SoundscaperProjectV23 | null, body: Uint8Array) {
		this.#metadataRevision = project === null ? 0 : 1
		if (project !== null) {
			this.#projects.set(String(project.id), structuredClone(project))
			this.#bodies.set(String(project.id), body.slice())
		}
		this.api = Object.freeze({
			connect: async () => {
				this.#connected = true
				return createSoundscaperDesktopProjectLibraryV10Handshake()
			},
			handshakeState: () => this.#connected ? 'admitted' : 'pending',
			listProjects: async () => ({
				metadataRevision: this.#metadataRevision,
				projects: [...this.#projects.values()].map(summary),
			}),
			readProjectBundle: async (projectId: string) => {
				const found = this.#projects.get(projectId)
				return found ? bundle(found, this.#metadataRevision) : null
			},
			readBodyChunk: async (request: Record<string, unknown>) => {
				const body = this.#bodies.get(String(request.projectId))
				if (!body) throw new Error('freeze body unavailable')
				const offset = Number(request.offset)
				return body.slice(offset, offset + Number(request.length))
			},
			beginPublication: async (request: Record<string, unknown>) => {
				this.#publicationCount += 1
				assert.equal(request.expectedMetadataRevision, this.#metadataRevision)
				const project = structuredClone(request.project) as SoundscaperProjectV23
				const bodies = request.bodies as readonly Readonly<SoundscaperDesktopV10Body>[]
				assert.deepEqual(bodies, bundle(project, this.#metadataRevision + 1).bodies)
				this.#active = Object.freeze({ project, bodies })
				this.#chunks = []
				this.#offset = 0
				return {
					publicationId: request.publicationId,
					maximumChunkBytes: 4 * 1024 * 1024,
					bodyCount: bodies.length,
				}
			},
			writePublicationChunk: async (request: Record<string, unknown>) => {
				assert.ok(this.#active)
				assert.equal(request.bodyIndex, 0)
				assert.equal(request.offset, this.#offset)
				const bytes = Uint8Array.from(request.bytes as Uint8Array)
				this.#chunks.push(bytes)
				this.#offset += bytes.byteLength
				return {
					bodyIndex: 0,
					nextOffset: this.#offset,
					complete: this.#offset === this.#active.bodies[0]!.byteLength,
				}
			},
			finishPublication: async () => {
				assert.ok(this.#active)
				this.#uploaded = join(this.#chunks)
				if (this.#active.bodies.length > 0) {
					assert.equal(digest(this.#uploaded), this.#active.bodies[0]!.sha256)
				}
				this.#projects.set(String(this.#active.project.id), structuredClone(this.#active.project))
				this.#bodies.set(String(this.#active.project.id), this.#uploaded.slice())
				this.#metadataRevision += 1
				const committed = this.#active.project
				this.#active = null
				return bundle(committed, this.#metadataRevision)
			},
			abortPublication: async () => {
				this.#active = null
				return true
			},
			deleteProject: async (request: Record<string, unknown>) => {
				const projectId = String(request.projectId)
				const current = this.#projects.get(projectId)
				assert.ok(current)
				assert.equal(request.expectedMetadataRevision, this.#metadataRevision)
				assertExpectedProject(request.expectedProject, current)
				this.#projects.delete(projectId)
				this.#bodies.delete(projectId)
				this.#metadataRevision += 1
				return { projectId, metadataRevision: this.#metadataRevision, deleted: true }
			},
			duplicateProject: async (request: Record<string, unknown>) => {
				const sourceId = String(request.sourceProjectId)
				const copyId = String(request.copyProjectId)
				const source = this.#projects.get(sourceId)
				assert.ok(source)
				assert.equal(this.#projects.has(copyId), false)
				assert.equal(request.expectedMetadataRevision, this.#metadataRevision)
				assertExpectedProject(request.expectedSource, source)
				const copy = structuredClone(source) as SoundscaperProjectV23 & {
					id: string; title: string; revision: number; createdAt: string; updatedAt: string;
				}
				copy.id = copyId
				copy.title = String(request.title)
				copy.revision = 0
				copy.createdAt = String(request.timestamp)
				copy.updatedAt = String(request.timestamp)
				this.#projects.set(copyId, copy)
				this.#bodies.set(copyId, this.#bodies.get(sourceId)!.slice())
				this.#metadataRevision += 1
				return bundle(copy, this.#metadataRevision)
			},
		})
	}

	get uploaded(): Uint8Array { return this.#uploaded.slice() }
	get metadataRevision(): number { return this.#metadataRevision }
	get publicationCount(): number { return this.#publicationCount }
	replaceAuthoritative(project: SoundscaperProjectV23): void {
		this.#projects.set(String(project.id), structuredClone(project))
		this.#metadataRevision += 1
	}
	projectRevision(projectId: string): number | null {
		return Number(this.#projects.get(projectId)?.revision ?? -1) < 0
			? null
			: Number(this.#projects.get(projectId)?.revision)
	}
}

function bundle(project: SoundscaperProjectV23, metadataRevision: number) {
	const snapshot = snapshotSoundscaperDesktopV10Project(SOUNDSCAPER_V23_PROJECT_RUNTIME_PROFILE, project)
	const id = 'soundscaper_desktop_entry_01'
	return Object.freeze({
		metadataRevision,
		project: Object.freeze({
			id,
			projectId: String(project.id),
			name: String(project.title),
			metadataFile: `${id}/${String(project.revision)}-${snapshot.sha256}.json`,
			preferredProduct: 'soundscaper' as const,
			updatedAtMs: Date.parse(String(project.updatedAt)),
			projectSchemaVersion: 23 as const,
			projectRevision: Number(project.revision),
			byteLength: snapshot.byteLength,
			sha256: snapshot.sha256,
		}),
		document: snapshot.document,
		bodies: soundscaperDesktopV10BodiesForProject(
			SOUNDSCAPER_V23_PROJECT_RUNTIME_PROFILE, project, snapshot.sha256,
		).bodies,
	})
}

function summary(project: SoundscaperProjectV23) {
	return Object.freeze({
		id: String(project.id), title: String(project.title), revision: Number(project.revision),
		updatedAt: String(project.updatedAt),
	})
}

function assertExpectedProject(value: unknown, project: SoundscaperProjectV23): void {
	const expected = value as Readonly<{ projectRevision: number; projectSha256: string }>
	const snapshot = snapshotSoundscaperDesktopV10Project(SOUNDSCAPER_V23_PROJECT_RUNTIME_PROFILE, project)
	assert.equal(expected.projectRevision, project.revision)
	assert.equal(expected.projectSha256, snapshot.sha256)
}

function productionProject(id: string): SoundscaperProjectV23 {
	const mixer = structuredClone(createDefaultMixerGraphV21([{ id: 'voice' }], 2))
	;(mixer.vcas as unknown as Array<Record<string, unknown>>).push({
		id: 'voice-vca', name: 'Voice VCA', gain: 0.9, mute: false,
		members: [{ kind: 'track', id: 'voice' }],
	})
	const source = createAudioSource({
		id: 'live-source', storageKey: 'pcm:live-source', frameCount: 2, channelCount: 1,
		sampleRate: 48_000, originalSampleRate: 48_000, sampleFormat: 'float32', chunkFrames: 65_536,
	})
	const derived = createAudioSource({
		id: 'freeze-source', storageKey: 'derived:freeze-source', contentSha256: PCM_SHA256,
		frameCount: 2, channelCount: 1, sampleRate: 48_000, originalSampleRate: 48_000,
		sampleFormat: 'float32', chunkFrames: 65_536,
	})
	const clip = createAudioClip({
		id: 'live-clip', sourceId: source.id, title: 'Live', timelineStartFrame: 0,
		durationFrames: 2, sourceStartFrame: 0, sourceDurationFrames: 2,
	})
	const track = createAudioTrack({
		id: 'voice', name: 'Voice', clipIds: [clip.id], audioFreeze: {
			schemaVersion: 1, derivedSourceId: derived.id,
			inputDigestSha256: '11'.repeat(32), rackDigestSha256: '22'.repeat(32),
			automationDigestSha256: '33'.repeat(32), freshnessDigestSha256: '44'.repeat(32),
			renderStartFrame: 0, renderFrameCount: 2, capturePosition: 'post-insert-pre-strip',
		},
	})
	return createSoundscaperProjectV23({
		id, title: 'Soundscaper V23 renderer', now: NOW,
		sources: [source, derived], clips: [clip], tracks: [track],
		sequences: [{ id: 'main-sequence', trackIds: [track.id] }], primarySequenceId: 'main-sequence',
		mixer,
		automationLanes: [{
			id: 'voice-gain',
			address: { kind: 'strip', strip: { kind: 'track', id: 'voice' }, parameterId: 'gain' },
			timebase: 'absolute-samples',
			points: [
				{ id: 'gain-start', position: 0, value: 0.75 },
				{ id: 'gain-end', position: 2, value: 1 },
			],
			segments: [{ kind: 'linear' }],
		}],
	})
}

function productionState(project: SoundscaperProjectV23) {
	return {
		automationLanes: project.automationLanes,
		mixer: project.mixer,
		audioFreeze: (project.tracks[0] as Readonly<Record<string, unknown>>).audioFreeze,
	}
}

function revisedProject(
	project: SoundscaperProjectV23,
	revision: number,
	title: string,
	updatedAt: string,
): SoundscaperProjectV23 {
	const next = structuredClone(project) as SoundscaperProjectV23 & {
		revision: number; title: string; updatedAt: string;
	}
	next.revision = revision
	next.title = title
	next.updatedAt = updatedAt
	return next
}

async function durableStore(context: TestContext) {
	const store = createSoundscaperProjectStoreV23({
		indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory,
		preferOpfs: false,
	})
	await store.ready()
	context.after(() => store.close())
	return store
}

function installBridge(context: TestContext, api: unknown): void {
	const name = 'soundscaperProjectLibraryDesktop'
	const prior = Object.getOwnPropertyDescriptor(globalThis, name)
	Object.defineProperty(globalThis, name, {
		configurable: true, enumerable: true, writable: false,
		value: Object.freeze({ v10: api }),
	})
	context.after(() => {
		if (prior) Object.defineProperty(globalThis, name, prior)
		else Reflect.deleteProperty(globalThis, name)
	})
}

async function storedSamples(
	store: ReturnType<typeof createSoundscaperProjectStoreV23>,
	sourceId: string,
): Promise<number[]> {
	const samples: number[] = []
	for await (const chunk of store.readSourceChunks(sourceId)) samples.push(...chunk.channels[0] ?? [])
	return samples
}

function canonicalPcm(samples: readonly number[]): Uint8Array {
	const result = Buffer.alloc(4 + samples.length * Float32Array.BYTES_PER_ELEMENT)
	result.writeUInt32LE(samples.length, 0)
	for (const [index, sample] of samples.entries()) result.writeFloatLE(sample, 4 + index * 4)
	return Uint8Array.from(result)
}

function join(chunks: readonly Uint8Array[]): Uint8Array {
	const result = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.byteLength, 0))
	let offset = 0
	for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength }
	return result
}

function digest(value: Uint8Array): string { return createHash('sha256').update(value).digest('hex') }
