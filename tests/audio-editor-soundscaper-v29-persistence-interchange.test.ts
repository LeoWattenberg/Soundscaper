/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test, { type TestContext } from 'node:test'

import type { AudioEditorProjectStore } from '../src/common/editor/storage.js'
import {
	type SoundscaperNativePluginStateBodyV29,
} from '../src/soundscaper/editor-native-plugin-state-v29.ts'
import {
	createSoundscaperProjectRuntimeV29Selection,
} from '../src/soundscaper/editor-project-runtime-v29-selection.ts'
import {
	createSoundscaperProjectV29,
	validateSoundscaperProjectV29,
} from '../src/soundscaper/editor-project-v29.ts'
import {
	createSoundscaperScapeNativeRuntimeV29,
	type SoundscaperScapeNativeStoreV29,
} from '../src/soundscaper/editor-scape-native-v29.ts'
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js'

const NOW = '2026-08-24T00:00:00.000Z'

function stateBody(bytes: Uint8Array): Readonly<SoundscaperNativePluginStateBodyV29> {
	const sha256 = createHash('sha256').update(bytes).digest('hex')
	return Object.freeze({
		kind: 'native-plugin-state', bodyId: `native-plugin-state:${sha256}`,
		byteLength: bytes.byteLength, sha256,
	})
}

function state(instanceId: string, body: SoundscaperNativePluginStateBodyV29) {
	return {
		instanceId, format: 'clap', stablePluginId: 'org.example.delay', binarySha256: 'ab'.repeat(32),
		stateBody: body, enabled: true, bypassed: false, continuity: 'live', latencySamples: 32,
	}
}

function project(body: SoundscaperNativePluginStateBodyV29) {
	return createSoundscaperProjectV29({
		id: 'scape-native-v29', title: 'Opaque native state', now: NOW,
		nativePluginStates: [state('instance-01', body), state('instance-02', body)],
	} as never)
}

test('V29 `.scape` deduplicates, validates and restores content-addressed native state', async (context) => {
	const bytes = Uint8Array.from([0, 7, 13, 255])
	const body = stateBody(bytes)
	const source = memoryStore(context, new Map([[body.bodyId, bytes]]))
	const targetBodies = new Map<string, Uint8Array>()
	const target = memoryStore(context, targetBodies)
	const runtime = createSoundscaperScapeNativeRuntimeV29()
	const original = project(body)
	await source.saveProject(original)

	const exported = await runtime.exportScapeProject(original, source)
	assert.ok(exported.blob)
	assert.deepEqual(exported.manifest.assets.filter(({ kind }) => kind === 'native-plugin-state'), [{
		sourceId: body.bodyId,
		kind: 'native-plugin-state',
		entry: `native-plugin-state/${body.sha256}.bin`,
		encoding: 'opaque-bytes-v1',
		mimeType: 'application/vnd.soundscaper.native-plugin-state',
		size: bytes.byteLength,
		sha256: body.sha256,
	}], 'two instances sharing bytes own one portable body')

	const imported = await runtime.importScapeProject(exported.blob, target)
	assert.equal(imported.readOnly, false)
	assert.equal(validateSoundscaperProjectV29(imported.project), true)
	assert.deepEqual(targetBodies.get(body.bodyId), bytes)
	assert.deepEqual((imported.project as ReturnType<typeof project>).nativePluginStates,
		original.nativePluginStates)

	const returning = await runtime.exportScapeProject(imported.project, target)
	assert.equal(returning.manifest.assets.find(({ kind }) => kind === 'native-plugin-state')?.sha256,
		body.sha256)
})

test('V29 `.scape` refuses missing or digest-drifted native state instead of dropping it', async (context) => {
	const bytes = Uint8Array.from([1, 2, 3])
	const body = stateBody(bytes)
	const runtime = createSoundscaperScapeNativeRuntimeV29()
	await assert.rejects(() => runtime.exportScapeProject(project(body), memoryStore(context)),
		/unavailable or changed/iu)
	const drifted = memoryStore(context, new Map([[body.bodyId, Uint8Array.from([9, 9, 9])]]), body)
	await assert.rejects(() => runtime.exportScapeProject(project(body), drifted), /failed its SHA-256/iu)
})

function memoryStore(
	context: TestContext,
	bodies: Map<string, Uint8Array> = new Map(),
	metadataOverride: SoundscaperNativePluginStateBodyV29 | null = null,
): AudioEditorProjectStore & SoundscaperScapeNativeStoreV29 {
	const base = createSoundscaperProjectRuntimeV29Selection().createProjectStore({
		indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory,
		preferOpfs: false,
		maximumProjectDocumentBytes: 16 * 1024 * 1024,
	})
	context.after(() => base.close())
	const extensions: SoundscaperScapeNativeStoreV29 = {
		getNativePluginStateBodyMetadata: (bodyId) => {
			const bytes = bodies.get(bodyId)
			if (!bytes) return null
			const sha256 = metadataOverride?.sha256
				?? createHash('sha256').update(bytes).digest('hex')
			return { byteLength: bytes.byteLength, sha256 }
		},
		loadNativePluginStateBody: (bodyId) => {
			const bytes = bodies.get(bodyId)
			return bytes ? Uint8Array.from(bytes) : null
		},
		persistNativePluginStateBody: (bytes, expected) => {
			const copy = Uint8Array.from(bytes)
			const sha256 = createHash('sha256').update(copy).digest('hex')
			if (sha256 !== expected.sha256 || copy.byteLength !== expected.byteLength) {
				throw new Error('Test state persistence identity mismatch.')
			}
			bodies.set(expected.bodyId, copy)
			return expected
		},
	}
	return new Proxy(base as AudioEditorProjectStore & SoundscaperScapeNativeStoreV29, {
		get(target, property) {
			if (Object.hasOwn(extensions, property)) {
				const value = Reflect.get(extensions, property)
				return typeof value === 'function' ? value.bind(extensions) : value
			}
			const value = Reflect.get(target, property, target)
			return typeof value === 'function' ? value.bind(target) : value
		},
	})
}
