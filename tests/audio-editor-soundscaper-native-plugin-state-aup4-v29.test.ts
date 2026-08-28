/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'

import {
	decodeAudacityBinaryXml,
	encodeAudacityBinaryXml,
} from '../src/common/editor/audacity-binary-xml.js'
import { decodeAup4ProjectTree } from '../src/common/editor/aup4-conversion.js'
import { createAup4ProjectTree } from '../src/common/editor/aup4-profile.js'
import {
	embedSoundscaperNativePluginStatesInAup4,
	recoverSoundscaperNativePluginStatesFromAup4,
} from '../src/soundscaper/editor-native-plugin-state-aup4.ts'
import { importSoundscaperAudacityProject } from '../src/soundscaper/editor-audacity-project-import.ts'
import {
	createSoundscaperProject,
	validateSoundscaperProject,
} from '../src/soundscaper/editor-project.ts'

function body(bytes: Uint8Array) {
	const sha256 = createHash('sha256').update(bytes).digest('hex')
	return Object.freeze({
		kind: 'native-plugin-state' as const,
		bodyId: `native-plugin-state:${sha256}`,
		byteLength: bytes.byteLength,
		sha256,
	})
}

function state(instanceId: string, stateBody: ReturnType<typeof body>) {
	return Object.freeze({
		instanceId,
		format: 'vst3' as const,
		stablePluginId: 'com.example.eq',
		binarySha256: 'ab'.repeat(32),
		stateBody,
		enabled: true,
		bypassed: false,
		continuity: 'live' as const,
		latencySamples: 64,
	})
}

test('AUP4 V29 deduplicates opaque bodies and restores instances through binary XML', async () => {
	const bytes = Uint8Array.from([0, 7, 13, 255])
	const stateBody = body(bytes)
	const original = createSoundscaperProject({
		id: 'aup4-native-state-v29',
		title: 'AUP4 native state',
		now: '2026-08-24T00:00:00.000Z',
		nativePluginStates: [state('insert-01', stateBody), state('insert-02', stateBody)],
	} as never)
	const portable = await embedSoundscaperNativePluginStatesInAup4(original, {
		loadNativePluginStateBody: (bodyId) => bodyId === stateBody.bodyId ? bytes : null,
	})
	const encoded = encodeAudacityBinaryXml(createAup4ProjectTree(portable))
	const reparsed = decodeAudacityBinaryXml(encoded.dictionary, encoded.document).root
	const decoded = await decodeAup4ProjectTree(reparsed, async () => null, {
		idFactory: (prefix: string) => `${prefix}-reopened`,
	})
	const imported = importSoundscaperAudacityProject(decoded.project)
	const persisted = new Map<string, Uint8Array>()
	const recovered = await recoverSoundscaperNativePluginStatesFromAup4(imported, {
		persistNativePluginStateBody: (value, expected) => {
			persisted.set(expected.bodyId, Uint8Array.from(value))
			return expected
		},
	})

	assert.equal(validateSoundscaperProject(recovered), true)
	assert.deepEqual(recovered.nativePluginStates, original.nativePluginStates)
	assert.deepEqual(persisted.get(stateBody.bodyId), bytes)
})

test('AUP4 V29 refuses missing, drifted, duplicate and ambiguous native-state custody', async () => {
	const bytes = Uint8Array.from([1, 2, 3])
	const stateBody = body(bytes)
	const original = createSoundscaperProject({
		id: 'aup4-native-state-faults',
		title: 'AUP4 native faults',
		now: '2026-08-24T00:00:00.000Z',
		nativePluginStates: [state('insert-01', stateBody)],
	} as never)
	await assert.rejects(
		() => embedSoundscaperNativePluginStatesInAup4(original, {
			loadNativePluginStateBody: () => null,
		}),
		/unavailable/iu,
	)
	await assert.rejects(
		() => embedSoundscaperNativePluginStatesInAup4(original, {
			loadNativePluginStateBody: () => Uint8Array.from([9, 9, 9]),
		}),
		/SHA-256/iu,
	)

	const portable = await embedSoundscaperNativePluginStatesInAup4(original, {
		loadNativePluginStateBody: () => bytes,
	})
	const portableExtensions = portable.opaqueExtensions as Readonly<Record<string, unknown>>
	const extension = (portableExtensions.aup4UnknownNodes as readonly unknown[]).at(-1)
	const ambiguous = structuredClone(portable) as unknown as Record<string, unknown>
	ambiguous.nativePluginStates = []
	ambiguous.opaqueExtensions = {
		...portableExtensions,
		aup4UnknownNodes: [extension, structuredClone(extension)],
	}
	await assert.rejects(
		() => recoverSoundscaperNativePluginStatesFromAup4(ambiguous as never, {
			persistNativePluginStateBody: (_value, expected) => expected,
		}),
		/ambiguous/iu,
	)
})
