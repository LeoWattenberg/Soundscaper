/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict'
import test from 'node:test'

import { createAraPreloadBridge } from '../desktop/ara-preload.ts'
import { ARA_CHANNELS } from '../src/common/editor/ara-contract.ts'

const source = { sourceId: 'clip-1', name: 'Voice', sampleRate: 48_000, channelCount: 1,
	frameCount: 4, sourceStartSeconds: 0, playbackStartSeconds: 2, durationSeconds: 4 / 48_000 }

test('ARA preload exposes pathless native operations with private PCM ownership', async () => {
	const calls: { channel: string; value: unknown }[] = []
	const rendered = new Float32Array([0.5, 0.25, 0, -0.25])
	const bridge = createAraPreloadBridge(async (channel, value) => {
		calls.push({ channel, value })
		if (channel === ARA_CHANNELS.start) return { sessionId: 'session-1' }
		if (channel === ARA_CHANNELS.render) return { startFrame: 0, channels: [rendered] }
		return true
	})
	const session = await bridge.start({ installationId: 'installed-1', source })
	const input = new Float32Array([1, 2, 3, 4])
	await bridge.write({ ...session, startFrame: 0, channels: [input] })
	const uploaded = (calls[1]!.value as { channels: Float32Array[] }).channels[0]!
	assert.notEqual(uploaded.buffer, input.buffer)
	input.fill(0)
	assert.deepEqual(Array.from(uploaded), [1, 2, 3, 4])
	await bridge.bind(session); await bridge.openEditor(session)
	const output = await bridge.render({ ...session, startFrame: 0, frameCount: 4 })
	assert.notEqual(output.channels[0]!.buffer, rendered.buffer)
	rendered.fill(0)
	assert.deepEqual(Array.from(output.channels[0]!), [0.5, 0.25, 0, -0.25])
	await bridge.close(session)
	assert.deepEqual(calls.map(({ channel }) => channel), Object.values(ARA_CHANNELS))
})

test('ARA preload refuses renderer paths and malformed native render acknowledgements', async () => {
	let calls = 0
	const bridge = createAraPreloadBridge(async () => { calls += 1; return { startFrame: 1, channels: [new Float32Array(4)] } })
	const badSource = { ...source, binaryPath: '/plugin' }
	await assert.rejects(bridge.start({ installationId: 'installed-1', source: badSource }), /fields/u)
	await assert.rejects(bridge.write({ sessionId: 'session-1', startFrame: 0, channels: [new Float32Array([Infinity])] }), /finite/u)
	assert.equal(calls, 0)
	await assert.rejects(bridge.render({ sessionId: 'session-1', startFrame: 0, frameCount: 4 }), /geometry/u)
	assert.equal(calls, 1)
})
