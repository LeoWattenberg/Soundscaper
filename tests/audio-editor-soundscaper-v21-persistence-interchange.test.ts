/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test, { type TestContext } from 'node:test'

import { createAddClipCommand, createAddTrackCommand } from '../src/common/editor/commands/factories.ts'
import type { AudioEditorCommand } from '../src/common/editor/commands/protocol.ts'
import { createClipboardDescriptor } from '../src/common/editor/commands/clipboard-runtime.js'
import { computeAudioTrackFreezeDigestsV1 } from '../src/common/editor/audio-track-freeze-v21.ts'
import {
	createTrackDuplicationService,
	type TrackDuplicationProject,
} from '../src/common/editor/controller/track-duplication-service.ts'
import { createDefaultMixerGraphV21 } from '../src/common/editor/mixer-graph-v21.ts'
import {
	createAudioClipV10,
	createAudioSourceV10,
	createAudioTrackV10,
} from '../src/common/editor/project-v10.ts'
import type { AudioEditorProjectStore } from '../src/common/editor/storage.js'
import {
	FRAMESCAPER_V20_PROJECT_MODEL_PROFILE,
} from '../src/framescaper/editor-project-v20-profile.ts'
import { createFramescaperScapeNativeRuntimeV20 } from '../src/framescaper/editor-scape-native-v20.ts'
import {
	createSoundscaperEditorProjectEnvironmentV21,
} from '../src/soundscaper/editor-project-environment-v21.ts'
import { createSoundscaperPlaybackProjectServiceV21 } from '../src/soundscaper/editor-project-playback-v21.ts'
import {
	createSoundscaperProjectRuntimeV21Selection,
} from '../src/soundscaper/editor-project-runtime-v21-selection.ts'
import {
	createSoundscaperTrackDuplicateClipboardV7,
	normalizeSoundscaperTrackDuplicateClipboardV7,
	prepareSoundscaperTrackDuplicateCarrierV7,
} from '../src/soundscaper/editor-session-clipboard-v7.ts'
import {
	createSoundscaperScapeNativeRuntimeV21,
} from '../src/soundscaper/editor-scape-native-v21.ts'
import {
	createSoundscaperProjectV21,
	type SoundscaperProjectV21,
} from '../src/soundscaper/editor-project-v21.ts'
import { validateSoundscaperProjectV21 } from '../src/soundscaper/editor-project-v21-validation.ts'
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js'

const NOW = '2026-08-14T16:00:00.000Z'
const LIVE_SAMPLES = [0.25, -0.5, 0.75, 0] as const
const FREEZE_SAMPLES = [0.125, -0.25, 0.5, -0.75] as const
const LIVE_SHA256 = audioAssetDigest(LIVE_SAMPLES)
const FREEZE_SHA256 = audioAssetDigest(FREEZE_SAMPLES)

test('durable V21 browser storage preserves exact production state and rejects foreign schemas', async (context) => {
	const environment = await createSoundscaperEditorProjectEnvironmentV21({
		storeOptions: {
			indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory,
			preferOpfs: false,
		},
	})
	context.after(() => environment.close())
	const project = productionProject('durable-v21')
	assert.equal(environment.playback.projectForPlayback(project)
		.featureRequirementsReport?.compatible, true)

	assert.deepEqual(await environment.createProjectIfAbsent(project), project)
	const reopened = await environment.store.loadProject(project.id)
	assert.ok(reopened)
	assert.equal(validateSoundscaperProjectV21(reopened), true)
	assert.deepEqual(productionState(reopened), productionState(project))
	assert.notStrictEqual(reopened.automationLanes, project.automationLanes)
	assert.notStrictEqual(reopened.mixer, project.mixer)

	const copy = await environment.store.duplicateProject(project.id, {
		id: 'durable-v21-copy',
		title: 'Durable V21 copy',
	})
	assert.equal(validateSoundscaperProjectV21(copy), true)
	assert.deepEqual(productionState(copy), productionState(project))
	assert.equal(copy.id, 'durable-v21-copy')
	await assert.rejects(
		environment.store.saveProject({ ...project, schemaVersion: 17 }),
		/exact V21|schemaVersion|schema version/iu,
	)
})

test('native V21 Scape authenticates freeze PCM and reopens every production field', async (context) => {
	const source = memoryStore(context, 'v21-scape-source')
	const target = memoryStore(context, 'v21-scape-target')
	const runtime = createSoundscaperScapeNativeRuntimeV21()
	const project = productionProject('scape-v21')
	await persistPcm(source, 'voice-live', LIVE_SAMPLES)
	await persistPcm(source, 'voice-freeze', FREEZE_SAMPLES)

	const exported = await runtime.exportScapeProject(project, source)
	assert.ok(exported.blob)
	const inspected = await runtime.inspectScapeProject(
		exported.blob,
		null,
		{ signal: new AbortController().signal },
		{ retain: () => undefined },
	)
	assert.equal(inspected.schemaVersion, 21)
	assert.equal(inspected.readOnly, false)
	assert.equal((inspected.featureRequirementsCompatibility as { compatible?: boolean })?.compatible, true)

	const imported = await runtime.importScapeProject(exported.blob, target)
	assert.equal(imported.readOnly, false)
	assert.equal(validateSoundscaperProjectV21(imported.project), true)
	assert.deepEqual(productionState(imported.project), productionState(project))
	const reopened = await target.loadProject(project.id)
	assert.ok(reopened)
	assert.deepEqual(productionState(reopened), productionState(project))
	assert.deepEqual(await storedSamples(target, 'voice-freeze'), [...FREEZE_SAMPLES])

	const corrupt = memoryStore(context, 'v21-scape-corrupt')
	await persistPcm(corrupt, 'voice-live', LIVE_SAMPLES)
	await persistPcm(corrupt, 'voice-freeze', [0, 0, 0, 0])
	await assert.rejects(
		runtime.exportScapeProject(project, corrupt),
		/fallback|digest|SHA-256/iu,
	)
})

test('V21 Scape source collision remaps the freeze record and fallback as one exact relationship', async (context) => {
	const source = memoryStore(context, 'v21-scape-remap-source')
	const target = memoryStore(context, 'v21-scape-remap-target')
	const runtime = createSoundscaperScapeNativeRuntimeV21()
	const project = productionProject('scape-v21-remap')
	await persistPcm(source, 'voice-live', LIVE_SAMPLES)
	await persistPcm(source, 'voice-freeze', FREEZE_SAMPLES)
	await persistPcm(target, 'voice-live', [0, 0, 0, 0])
	await persistPcm(target, 'voice-freeze', [0, 0, 0, 0])
	const exported = await runtime.exportScapeProject(project, source)
	assert.ok(exported.blob)

	const imported = await runtime.importScapeProject(exported.blob, target)
	assert.equal(validateSoundscaperProjectV21(imported.project), true)
	assert.deepEqual(imported.project.automationLanes, project.automationLanes)
	assert.deepEqual(imported.project.mixer, project.mixer)
	const track = imported.project.tracks[0] as Readonly<Record<string, unknown>>
	const freeze = track.audioFreeze as Readonly<Record<string, unknown>>
	const requirements = imported.project.featureRequirements.requirements as readonly Readonly<{
		readonly featureId: string
		readonly fallback: Readonly<{ readonly sourceId: string }> | null
	}>[]
	const requirement = requirements.find(({ featureId }) => (
		featureId === 'org.soundscaper.capability.audio-track-freeze'
	))
	assert.ok(requirement?.fallback)
	assert.notEqual(freeze.derivedSourceId, 'voice-freeze')
	assert.equal(requirement.fallback.sourceId, freeze.derivedSourceId)
	assert.equal(
		(imported.project.sources as readonly Readonly<{ readonly id: string }>[])
			.some(({ id }) => id === freeze.derivedSourceId),
		true,
	)
	assert.deepEqual(await storedSamples(target, String(freeze.derivedSourceId)), [...FREEZE_SAMPLES])
})

test('V21 Scape source collision never blesses a stale freeze with a rendered fallback', async (context) => {
	const source = memoryStore(context, 'v21-scape-stale-remap-source')
	const target = memoryStore(context, 'v21-scape-stale-remap-target')
	const runtime = createSoundscaperScapeNativeRuntimeV21()
	const fresh = productionProject('scape-v21-stale-remap')
	const stale = createSoundscaperProjectRuntimeV21Selection().applyCommand(fresh, {
		type: 'clip/move',
		clipId: 'voice-clip',
		timelineStartFrame: 8,
	}) as SoundscaperProjectV21
	const priorFreeze = (stale.tracks[0] as Readonly<Record<string, unknown>>)
		.audioFreeze as Readonly<Record<string, unknown>>
	await persistPcm(source, 'voice-live', LIVE_SAMPLES)
	await persistPcm(source, 'voice-freeze', FREEZE_SAMPLES)
	await persistPcm(target, 'voice-live', [0, 0, 0, 0])
	await persistPcm(target, 'voice-freeze', [0, 0, 0, 0])
	const exported = await runtime.exportScapeProject(stale, source)
	assert.ok(exported.blob)

	const imported = await runtime.importScapeProject(exported.blob, target)
	const track = imported.project.tracks[0] as Readonly<Record<string, unknown>>
	const freeze = track.audioFreeze as Readonly<Record<string, unknown>>
	const requirements = imported.project.featureRequirements.requirements as readonly Readonly<{
		readonly featureId: string
		readonly disposition: string
		readonly fallback: unknown
	}>[]
	const requirement = requirements.find(({ featureId }) => (
		featureId === 'org.soundscaper.capability.audio-track-freeze'
	))
	assert.notEqual(freeze.derivedSourceId, 'voice-freeze')
	assert.equal(freeze.inputDigestSha256, priorFreeze.inputDigestSha256)
	assert.equal(requirement?.disposition, 'bypass')
	assert.equal(requirement?.fallback, null)
})

test('Framescaper can only custody a V21 archive opaquely before exact Soundscaper return', async (context) => {
	const source = memoryStore(context, 'v21-cross-product-source')
	const returnedStore = memoryStore(context, 'v21-cross-product-return')
	const soundscaper = createSoundscaperScapeNativeRuntimeV21()
	const framescaper = createFramescaperScapeNativeRuntimeV20(FRAMESCAPER_V20_PROJECT_MODEL_PROFILE)
	const project = productionProject('scape-v21-cross-product')
	await persistPcm(source, 'voice-live', LIVE_SAMPLES)
	await persistPcm(source, 'voice-freeze', FREEZE_SAMPLES)
	const exported = await soundscaper.exportScapeProject(project, source)
	assert.ok(exported.blob)

	const inspected = await framescaper.inspectScapeProject(
		exported.blob,
		null,
		{ signal: new AbortController().signal },
		{ retain: () => undefined },
	)
	assert.equal(inspected.schemaVersion, 21)
	assert.equal(inspected.readOnly, true)
	assert.equal(inspected.featureRequirementsCompatibility, null)
	const chunks: Uint8Array[] = []
	const copied = await framescaper.copyScapeArchive(
		exported.blob,
		(bytes) => { chunks.push(bytes.slice()) },
	)
	const returnedBytes = joinBytes(chunks)
	assert.deepEqual(copied, { byteLength: exported.blob.size, schemaVersion: 21 })
	assert.deepEqual(returnedBytes, new Uint8Array(await exported.blob.arrayBuffer()))

	const returned = await soundscaper.importScapeProject(
		new Blob([returnedBytes], { type: 'application/vnd.soundscaper.scape+zip' }),
		returnedStore,
	)
	assert.deepEqual(productionState(returned.project), productionState(project))
})

test('V21 clipboard and inherited edits retain production authority without smuggling it into clip-local copy', () => {
	const selection = createSoundscaperProjectRuntimeV21Selection()
	const project = productionProject('clipboard-v21')
	const commandProject = selection.projectForCommandConsumers(project)
	const descriptor = createClipboardDescriptor(commandProject, {
		startFrame: 0,
		endFrame: 4,
		trackIds: ['voice'],
	})
	const clipboard = selection.prepareEditClipboardDescriptor(project, descriptor)
	const serialized = JSON.stringify(clipboard)
	assert.doesNotMatch(serialized, /automationLanes|audioFreeze|mixer/iu)

	const moved = selection.applyCommand(project, {
		type: 'clip/move',
		clipId: 'voice-clip',
		timelineStartFrame: 8,
	}) as SoundscaperProjectV21
	assert.equal(validateSoundscaperProjectV21(moved), true)
	assert.deepEqual(moved.automationLanes, project.automationLanes)
	assert.deepEqual(moved.mixer, project.mixer)
	assert.deepEqual(
		(moved.tracks[0] as Readonly<Record<string, unknown>>).audioFreeze,
		(project.tracks[0] as Readonly<Record<string, unknown>>).audioFreeze,
	)
})

test('product-owned clipboard V7 drives the real track duplicate path without copying freeze authority', () => {
	const selection = createSoundscaperProjectRuntimeV21Selection()
	const project = productionProject('track-clipboard-v7')
	const duplicationProject = project as unknown as TrackDuplicationProject
	const carrier = createSoundscaperTrackDuplicateClipboardV7(project, 'voice')
	assert.deepEqual(carrier, {
		schemaVersion: 7,
		kind: 'track-duplicate',
		originProjectId: project.id,
		originRevision: project.revision,
		sourceTrackId: 'voice',
		effectIds: [],
	})
	assert.doesNotMatch(JSON.stringify(carrier), /automationLanes|audioFreeze|mixer/iu)

	let committed: AudioEditorCommand | null = null
	let sequence = 0
	const service = createTrackDuplicationService({
		lifetime: { assertActive: () => undefined },
		copySuffix: 'copy',
		editingBlocked: () => false,
		getProject: () => duplicationProject,
		createId: (prefix) => `${prefix}-${++sequence}`,
		findClip: (candidate, clipId) => candidate.clips.find(({ id }) => id === clipId) ?? null,
		cloneVideoEffects: (effects) => effects,
		createAddTrackCommand,
		createAddClipCommand,
		prepareTrackDuplicateCarrier: selection.prepareTrackDuplicateCarrier,
		commit: (command) => { committed = command },
	})
	service.duplicateTrack(duplicationProject.tracks[0])
	assert.ok(committed)
	const duplicated = selection.applyCommand(project, committed) as SoundscaperProjectV21
	const copiedTrack = duplicated.tracks.find(({ id }) => id === 'track-1')
	assert.ok(copiedTrack)
	assert.equal(Object.hasOwn(copiedTrack, 'audioFreeze'), false)
	assert.equal(duplicated.automationLanes.some((lane) => (
		lane.address.kind === 'strip'
		&& lane.address.strip.kind === 'track'
		&& lane.address.strip.id === copiedTrack.id
	)), true)
	assert.equal(duplicated.mixer.edges.some((edge) => (
		edge.id === `assignment:track:${copiedTrack.id}:master`
		&& edge.source.kind === 'track' && edge.source.id === copiedTrack.id
	)), true)
})

test('clipboard V7 is exact, revision-bound, and refuses V6 recopy substitution', () => {
	const project = productionProject('track-clipboard-admission')
	const carrier = createSoundscaperTrackDuplicateClipboardV7(project, 'voice')
	assert.deepEqual(normalizeSoundscaperTrackDuplicateClipboardV7(structuredClone(carrier)), carrier)
	assert.throws(
		() => normalizeSoundscaperTrackDuplicateClipboardV7({ ...carrier, schemaVersion: 6 }),
		/V7|recopy/iu,
	)
	assert.throws(
		() => normalizeSoundscaperTrackDuplicateClipboardV7({ ...carrier, audioFreeze: {} }),
		/unsupported|exact/iu,
	)
	assert.throws(
		() => normalizeSoundscaperTrackDuplicateClipboardV7(Object.create(carrier)),
		/plain|record|prototype/iu,
	)
	assert.throws(
		() => prepareSoundscaperTrackDuplicateCarrierV7(
			{ ...structuredClone(project), revision: project.revision + 1 },
			carrier,
			{ sourceTrackId: 'voice', targetTrackId: 'voice-copy', effectIds: [] },
		),
		/stale|revision/iu,
	)
	assert.deepEqual(prepareSoundscaperTrackDuplicateCarrierV7(
		project,
		carrier,
		{ sourceTrackId: 'voice', targetTrackId: 'voice-copy', effectIds: [] },
	), { sourceTrackId: 'voice', effectIds: [] })
})

test('V21 storage and playback do not inherit generic authority or capability overrides', () => {
	const selection = createSoundscaperProjectRuntimeV21Selection()
	for (const [field, value] of [
		['databaseName', 'foreign-v21'],
		['repositoryFactory', () => ({})],
		['desktopProjectBridge', {}],
	] as const) {
		assert.throws(
			() => selection.createProjectStore({ [field]: value }),
			/selected V21 store|authority override/iu,
		)
	}
	const project = createSoundscaperProjectV21({
		id: 'unknown-capability-v21',
		title: 'Unknown capability',
		now: NOW,
		featureRequirements: {
			schemaVersion: 2,
			requirements: [{
				id: 'publisher.unknown-audio',
				featureId: 'org.example.unknown-audio',
				displayName: 'Unknown audio processing',
				disposition: 'bypass',
				fallback: null,
			}],
		},
	})
	const report = createSoundscaperPlaybackProjectServiceV21()
		.projectForPlayback(project).featureRequirementsReport
	assert.equal(report?.compatible, false)
	assert.deepEqual(report?.counts, { available: 0, unavailable: 0, unknown: 1 })
})

function productionProject(id: string): SoundscaperProjectV21 {
	const mixer = structuredClone(createDefaultMixerGraphV21([{ id: 'voice' }], 2))
	;(mixer.vcas as unknown as Array<Record<string, unknown>>).push({
		id: 'voice-vca',
		name: 'Voice VCA',
		gain: 0.9,
		mute: false,
		members: [{ kind: 'track', id: 'voice' }],
	})
	const liveSource = createAudioSourceV10({
		id: 'voice-live', storageKey: 'voice-live', name: 'Voice.wav', mimeType: 'audio/wav',
		contentSha256: LIVE_SHA256,
		frameCount: 4, channelCount: 1, sampleRate: 48_000, originalSampleRate: 48_000,
		sampleFormat: 'float32', chunkFrames: 65_536,
	})
	const freezeSource = createAudioSourceV10({
		id: 'voice-freeze', storageKey: 'voice-freeze', name: 'Voice freeze.wav', mimeType: 'audio/wav',
		contentSha256: FREEZE_SHA256,
		frameCount: 4, channelCount: 1, sampleRate: 48_000, originalSampleRate: 48_000,
		sampleFormat: 'float32', chunkFrames: 65_536,
	})
	const clip = createAudioClipV10({
		id: 'voice-clip', sourceId: 'voice-live', title: 'Voice',
		timelineStartFrame: 0, durationFrames: 4, sourceStartFrame: 0, sourceDurationFrames: 4,
	})
	const automationLane = {
		id: 'voice-gain',
		address: { kind: 'strip', strip: { kind: 'track', id: 'voice' }, parameterId: 'gain' },
		timebase: 'absolute-samples',
		points: [
			{ id: 'gain-start', position: 0, value: 0.75 },
			{ id: 'gain-end', position: 4, value: 1 },
		],
		segments: [{ kind: 'linear' }],
	}
	const baseTrack = createAudioTrackV10({
		id: 'voice', name: 'Voice', clipIds: ['voice-clip'],
	})
	const digests = computeAudioTrackFreezeDigestsV1({
		sampleRate: 48_000,
		renderStartFrame: 0,
		renderFrameCount: 4,
		track: baseTrack,
		clips: [clip],
		sourceContentIdentities: [{ sourceId: 'voice-live', contentSha256: LIVE_SHA256 }],
		automationLanes: [automationLane],
	})
	const track = createAudioTrackV10({
		id: 'voice', name: 'Voice', clipIds: ['voice-clip'],
		audioFreeze: {
			schemaVersion: 1,
			derivedSourceId: 'voice-freeze',
			...digests,
			renderStartFrame: 0,
			renderFrameCount: 4,
			capturePosition: 'post-insert-pre-strip',
		},
	})
	return createSoundscaperProjectV21({
		id,
		title: 'V21 persistence',
		now: NOW,
		sources: [liveSource, freezeSource],
		clips: [clip],
		tracks: [track],
		sequences: [{ id: 'main-sequence', trackIds: ['voice'] }],
		primarySequenceId: 'main-sequence',
		mixer,
		automationLanes: [automationLane],
	})
}

function productionState(project: Readonly<Record<string, unknown>>) {
	return {
		automationLanes: project.automationLanes,
		mixer: project.mixer,
		audioFreeze: (project.tracks as readonly Readonly<Record<string, unknown>>[])[0]?.audioFreeze,
		featureRequirements: project.featureRequirements,
	}
}

function memoryStore(context: TestContext, _label: string): AudioEditorProjectStore {
	const store = createSoundscaperProjectRuntimeV21Selection().createProjectStore({
		indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory,
		preferOpfs: false,
		maximumProjectDocumentBytes: 16 * 1024 * 1024,
	})
	context.after(() => store.close())
	return store
}

async function persistPcm(
	store: AudioEditorProjectStore,
	sourceId: string,
	samples: readonly number[],
): Promise<void> {
	const writer = await store.beginSourceWrite(sourceId, {
		name: `${sourceId}.wav`,
		mimeType: 'audio/wav',
		sampleRate: 48_000,
		channelCount: 1,
	})
	await writer.write([Float32Array.from(samples)])
	await writer.commit()
}

async function storedSamples(store: AudioEditorProjectStore, sourceId: string): Promise<number[]> {
	const samples: number[] = []
	for await (const chunk of store.readSourceChunks(sourceId)) {
		samples.push(...chunk.channels[0] ?? [])
	}
	return samples
}

function audioAssetDigest(samples: readonly number[]): string {
	const bytes = Buffer.alloc(4 + samples.length * Float32Array.BYTES_PER_ELEMENT)
	bytes.writeUInt32LE(samples.length, 0)
	for (const [index, sample] of samples.entries()) {
		bytes.writeFloatLE(sample, 4 + index * Float32Array.BYTES_PER_ELEMENT)
	}
	return createHash('sha256').update(bytes).digest('hex')
}

function joinBytes(chunks: readonly Uint8Array[]): Uint8Array {
	const output = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0))
	let offset = 0
	for (const chunk of chunks) {
		output.set(chunk, offset)
		offset += chunk.byteLength
	}
	return output
}
