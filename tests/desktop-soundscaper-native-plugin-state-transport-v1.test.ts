/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'

import {
	createSoundscaperDesktopProjectLibraryMainPreloadBridge,
} from '../desktop/soundscaper-project-library-main-preload.ts'
import {
	SOUNDSCAPER_DESKTOP_PROJECT_LIBRARY_MAIN_CHANNELS,
} from '../desktop/soundscaper-project-library-main-channels.ts'
import {
	validateSoundscaperNativePluginStateBodyRecordV1,
} from '../src/soundscaper/desktop-native-plugin-state-transport-v1.ts'

test('desktop baseline exposes pathless native-state body persistence only after handshake', async () => {
	const bytes = Uint8Array.from([0, 1, 2, 255])
	const sha256 = createHash('sha256').update(bytes).digest('hex')
	const bodyId = `native-plugin-state:${sha256}`
	const calls: Readonly<{ channel: string; value: unknown }>[] = []
	const bridge = createSoundscaperDesktopProjectLibraryMainPreloadBridge({
		invoke: async (channel: string, value?: unknown) => {
			(calls as { channel: string; value: unknown }[]).push({ channel, value })
			if (channel === SOUNDSCAPER_DESKTOP_PROJECT_LIBRARY_MAIN_CHANNELS.handshake) return value
			if (channel === SOUNDSCAPER_DESKTOP_PROJECT_LIBRARY_MAIN_CHANNELS.persistNativePluginState) {
				return { kind: 'native-plugin-state', bodyId, byteLength: bytes.byteLength, sha256 }
			}
			if (channel === SOUNDSCAPER_DESKTOP_PROJECT_LIBRARY_MAIN_CHANNELS.readNativePluginState) {
				return { kind: 'native-plugin-state', bodyId, byteLength: bytes.byteLength, sha256, bytes }
			}
			throw new Error(`Unexpected channel ${channel}`)
		},
	})
	await assert.rejects(() => bridge.persistNativePluginState(bytes), /handshake/iu)
	await bridge.connect()
	assert.deepEqual(await bridge.persistNativePluginState(bytes), {
		kind: 'native-plugin-state', bodyId, byteLength: bytes.byteLength, sha256,
	})
	assert.deepEqual((await bridge.readNativePluginState(bodyId))?.bytes, bytes)
	assert.equal(calls.at(-2)?.channel,
		SOUNDSCAPER_DESKTOP_PROJECT_LIBRARY_MAIN_CHANNELS.persistNativePluginState)
	assert.equal(calls.at(-1)?.channel,
		SOUNDSCAPER_DESKTOP_PROJECT_LIBRARY_MAIN_CHANNELS.readNativePluginState)
})

test('desktop native-state transport rejects digest drift and shared bytes', () => {
	const bytes = Uint8Array.from([1, 2, 3])
	const sha256 = createHash('sha256').update(bytes).digest('hex')
	assert.throws(() => validateSoundscaperNativePluginStateBodyRecordV1({
		kind: 'native-plugin-state',
		bodyId: `native-plugin-state:${sha256}`,
		byteLength: bytes.byteLength,
		sha256,
		bytes: Uint8Array.from([9, 9, 9]),
	}), /digest/iu)
	assert.throws(() => validateSoundscaperNativePluginStateBodyRecordV1({
		kind: 'native-plugin-state',
		bodyId: `native-plugin-state:${sha256}`,
		byteLength: bytes.byteLength,
		sha256,
		bytes: new Uint8Array(new SharedArrayBuffer(bytes.byteLength)),
	}), /ordinary/iu)
})

test('desktop baseline rejects a persisted descriptor for different bytes', async () => {
	const bytes = Uint8Array.from([1, 2, 3])
	const otherBytes = Uint8Array.from([4, 5, 6])
	const otherSha256 = createHash('sha256').update(otherBytes).digest('hex')
	const bridge = createSoundscaperDesktopProjectLibraryMainPreloadBridge({
		invoke: async (channel: string, value?: unknown) => {
			if (channel === SOUNDSCAPER_DESKTOP_PROJECT_LIBRARY_MAIN_CHANNELS.handshake) return value
			if (channel === SOUNDSCAPER_DESKTOP_PROJECT_LIBRARY_MAIN_CHANNELS.persistNativePluginState) {
				return {
					kind: 'native-plugin-state',
					bodyId: `native-plugin-state:${otherSha256}`,
					byteLength: otherBytes.byteLength,
					sha256: otherSha256,
				}
			}
			throw new Error(`Unexpected channel ${channel}`)
		},
	})
	await bridge.connect()
	await assert.rejects(() => bridge.persistNativePluginState(bytes), /another content identity/iu)
})
