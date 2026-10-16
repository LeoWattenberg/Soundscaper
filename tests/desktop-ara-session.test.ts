/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict'
import test from 'node:test'

import { DesktopAraSessions, type AraBackend } from '../desktop/ara-session-service.ts'
import { admitAraSource, admitAraPcm } from '../src/common/editor/ara-contract.ts'

const source = Object.freeze({
	sourceId: 'clip-1', name: 'Voice', sampleRate: 48_000, channelCount: 1,
	frameCount: 4, sourceStartSeconds: 0, playbackStartSeconds: 2, durationSeconds: 4 / 48_000,
})

function fixture(options: { supported?: boolean; deferred?: boolean } = {}) {
	const calls: string[] = []
	let release: (() => void) | undefined
	const backend: AraBackend = {
		configure: async () => { calls.push('configure'); return options.supported !== false },
		write: async () => { calls.push('write') },
		bind: async () => { calls.push('bind') },
		openEditor: async () => { calls.push('editor') },
		render: async (request) => {
			calls.push('render')
			return Array.from({ length: request.channelCount }, () => new Float32Array(request.frameCount).fill(0.25))
		},
		close: async () => { calls.push('close') },
	}
	const service = new DesktopAraSessions({
		isEnabled: () => true,
		open: async () => {
			if (options.deferred) await new Promise<void>((resolve) => { release = resolve })
			return backend
		},
		mintId: () => 'a'.repeat(40),
	})
	return { service, calls, release: () => release?.() }
}

test('ARA source admission rejects excess memory, geometry, accessors and unsafe PCM', () => {
	assert.deepEqual(admitAraSource(source), source)
	assert.throws(() => admitAraSource({ ...source, name: '' }), /name/u)
	assert.throws(() => admitAraSource({ ...source, frameCount: 300_000_000 }), /memory|duration/u)
	assert.throws(() => admitAraSource({ ...source, durationSeconds: 1 }), /duration/u)
	assert.throws(() => admitAraSource({ ...source, binaryPath: '/plugin' }), /fields/u)
	assert.throws(() => admitAraSource({ ...source, get name() { throw new Error('accessor evaluated') } }), /properties/u)
	assert.throws(() => admitAraPcm({ startFrame: 0, channels: [new Float32Array([NaN])] }, source), /finite/u)
	assert.throws(() => admitAraPcm({ startFrame: 3, channels: [new Float32Array(2)] }, source), /range/u)
	assert.throws(() => admitAraPcm({ startFrame: 0, channels: [new Float32Array(4), new Float32Array(4)] }, source), /channels/u)
})

test('ARA binds only complete contiguous sources, enforces owner and renders selected region', async () => {
	const { service, calls } = fixture()
	const owner = {}
	const { sessionId } = await service.start(owner, { installationId: 'installed-1', source })
	await assert.rejects(service.bind(owner, { sessionId }), /incomplete/u)
	await assert.rejects(service.write({}, { sessionId, startFrame: 0, channels: [new Float32Array(4)] }), /owner/u)
	await assert.rejects(service.write(owner, { sessionId, startFrame: 1, channels: [new Float32Array(2)] }), /contiguous/u)
	await service.write(owner, { sessionId, startFrame: 0, channels: [new Float32Array(4)] })
	await service.bind(owner, { sessionId })
	await service.openEditor(owner, { sessionId })
	const output = await service.render(owner, { sessionId, startFrame: 0, frameCount: 4 })
	assert.deepEqual(Array.from(output.channels[0]!), [0.25, 0.25, 0.25, 0.25])
	await service.close(owner, { sessionId })
	await service.close(owner, { sessionId })
	assert.deepEqual(calls, ['configure', 'write', 'bind', 'editor', 'render', 'close'])
})

test('non-ARA plugins close cleanly and owner revocation wins pending acquisition', async () => {
	const unsupported = fixture({ supported: false })
	await assert.rejects(unsupported.service.start({}, { installationId: 'installed-1', source }), /ARA/u)
	assert.deepEqual(unsupported.calls, ['configure', 'close'])
	const pending = fixture({ deferred: true })
	const owner = {}
	const acquisition = pending.service.start(owner, { installationId: 'installed-1', source })
	await pending.service.revokeOwner(owner)
	pending.release()
	await assert.rejects(acquisition, /revoked/u)
	assert.deepEqual(pending.calls, ['close'])
})
