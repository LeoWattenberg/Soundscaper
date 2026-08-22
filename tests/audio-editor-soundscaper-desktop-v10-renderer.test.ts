/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict'
import { register } from 'node:module'
import test from 'node:test'

import {
	connectSoundscaperDesktopProjectLibraryV10Renderer,
	type SoundscaperDesktopProjectLibraryV10ShadowStore,
} from '../src/soundscaper/desktop-project-library-v10-renderer.ts'
import {
	createSoundscaperDesktopProjectStoreV10Adapter,
} from '../src/soundscaper/desktop-project-library-v10-store-adapter.ts'
import { createProjectSaveService } from '../src/common/editor/controller/project-save-service.ts'
import { SOUNDSCAPER_V23_PROJECT_RUNTIME_PROFILE } from '../src/soundscaper/editor-project-runtime-profile-v23.ts'
import { createSoundscaperEditorProjectEnvironmentV23 } from '../src/soundscaper/editor-project-environment-v23.ts'
import {
	cloneSoundscaperProjectV23,
	createSoundscaperProjectV23,
	type SoundscaperProjectV23,
} from '../src/soundscaper/editor-project-v23.ts'
import {
	BridgeFixture,
	durableStore,
	installBridge,
	NOW,
	PCM,
	productionProject,
	productionState,
	revisedProject,
	storedSamples,
} from './helpers/soundscaper-desktop-v10-renderer-fixture.ts'
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
