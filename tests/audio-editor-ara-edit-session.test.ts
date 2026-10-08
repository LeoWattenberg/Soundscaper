/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict'
import test from 'node:test'
import { createAraEditSession } from '../src/common/editor/controller/effects/ara-edit-session.ts'
import type { AraBridge } from '../src/common/editor/ara-contract.ts'
import type { AraPreparedClipEdit } from '../src/common/editor/ara-clip-editing-runtime.ts'

function fixture() {
	const calls: string[] = []
	let current = true
	const prepared: AraPreparedClipEdit = {
		sourceId: 'clip', name: 'Voice', sampleRate: 48000, channelCount: 1, frameCount: 3,
		sourceStartSeconds: 0, playbackStartSeconds: 1, durationSeconds: 3 / 48000,
		channels: [new Float32Array([0.1, 0.2, 0.3])],
		assertCurrent: () => { if (!current) throw new Error('Selected clip changed.') },
		cancel: () => { calls.push('cancel') },
		apply: async (result) => {
			calls.push('apply')
			assert.deepEqual(Array.from(result.channels[0]!), [0.5, 0.5, 0.5])
			return { trackId: 'new-track', clipId: 'new-clip', sourceId: 'new-source' }
		},
	}
	const bridge: AraBridge = {
		start: async () => { calls.push('start'); return { sessionId: 'session' } },
		write: async () => { calls.push('write'); return true },
		bind: async () => { calls.push('bind'); return true },
		openEditor: async () => { calls.push('editor'); return true },
		render: async ({ startFrame, frameCount }) => {
			calls.push('render')
			return { startFrame, channels: [new Float32Array(frameCount).fill(0.5)] }
		},
		close: async () => { calls.push('close'); return true },
	}
	const session = createAraEditSession({ bridge, clipEditing: { prepare: async () => prepared } })
	return { session, bridge, calls, stale: () => { current = false } }
}

test('ARA clip session uploads, binds, edits and publishes only verified rendered PCM', async () => {
	const { session, calls } = fixture()
	await session.open('installation')
	assert.equal(session.getSnapshot().phase, 'editing')
	await session.openEditor()
	await session.apply()
	assert.equal(session.getSnapshot().phase, 'applied')
	await session.dispose()
	assert.deepEqual(calls, ['start', 'write', 'bind', 'editor', 'render', 'apply', 'close', 'cancel'])
})

test('ARA stale clip and malformed renders close native authority without publishing', async () => {
	const stale = fixture()
	await stale.session.open('installation')
	stale.stale()
	await stale.session.reconcile()
	assert.equal(stale.session.getSnapshot().phase, 'error')
	assert.deepEqual(stale.calls, ['start', 'write', 'bind', 'close', 'cancel'])
	const malformed = fixture()
	malformed.bridge.render = async () => ({ startFrame: 0, channels: [new Float32Array([NaN, 0, 0])] })
	await malformed.session.open('installation')
	await malformed.session.apply()
	assert.equal(malformed.session.getSnapshot().phase, 'error')
	assert.equal(malformed.calls.includes('apply'), false)
	assert.equal(malformed.calls.includes('close'), true)
})

test('ARA cancellation closes a native session acquired after the dialog was dismissed', async () => {
	const fixtureValue = fixture()
	let release: ((value: { sessionId: string }) => void) | undefined
	fixtureValue.bridge.start = () => new Promise((resolve) => { release = resolve })
	const opening = fixtureValue.session.open('installation')
	await new Promise<void>((resolve) => { queueMicrotask(resolve) })
	await fixtureValue.session.dispose()
	release?.({ sessionId: 'late-session' })
	await opening
	assert.equal(fixtureValue.calls.includes('write'), false)
	assert.equal(fixtureValue.calls.filter((call) => call === 'close').length, 1)
})
