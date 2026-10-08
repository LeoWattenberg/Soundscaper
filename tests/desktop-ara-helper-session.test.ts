/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict'
import test from 'node:test'

import { openAraHelperSession } from '../desktop/ara-helper-session.ts'
import type { NativeMainMessagePort } from '../desktop/native-audio-helper-adapter.ts'
import type { HelperPluginHostJobGrant } from '../desktop/helper-job-grant.ts'

const source = Object.freeze({ sourceId: 'clip-1', name: 'Voice', sampleRate: 48_000,
	channelCount: 1, frameCount: 4, sourceStartSeconds: 0, playbackStartSeconds: 2, durationSeconds: 4 / 48_000 })
const grant: HelperPluginHostJobGrant = { binaryPath: '/effects/voice.vst3', binaryBytes: 10,
	binarySha256: 'd'.repeat(64), format: 'vst3', stableId: 'vst3:voice', identity: { dev: 1, ino: 2 } }

function fixture(answer: (request: Record<string, unknown>) => Record<string, unknown>) {
	const listeners = new Set<(event: unknown) => void>()
	const calls: string[] = []
	const faults: Error[] = []
	let disposed = 0
	let resolveCompletion: ((value: unknown) => void) | undefined
	const completion = new Promise<unknown>((resolve) => { resolveCompletion = resolve })
	const port: NativeMainMessagePort = {
		on: (_event, listener) => { listeners.add(listener) },
		off: (_event, listener) => { listeners.delete(listener) },
		close: () => { calls.push('port-close') },
		postMessage: (value: unknown) => {
			const request = value as Record<string, unknown>
			calls.push(String(request.kind))
			const response = request.kind === 'configure'
				? { protocolVersion: 1, kind: 'configured', status: 'opened', format: 'vst3', reportedLatencyFrames: 0 }
				: { protocolVersion: 1, requestId: request.requestId, ...answer(request) }
			queueMicrotask(() => { for (const listener of listeners) listener({ data: response }) })
		},
	}
	return { calls, faults, disposed: () => disposed,
		open: () => openAraHelperSession({ source, grant,
			createChannel: () => ({ port1: port, port2: port }),
			supervisor: { runJob: (request) => {
				request.signal?.addEventListener('abort', () => { resolveCompletion?.({ status: 'closed' }) }, { once: true })
				return completion
			} },
			dispose: () => { disposed += 1 }, onFault: (error) => { faults.push(error) },
		}),
	}
}

function reply(request: Record<string, unknown>): Record<string, unknown> {
	if (request.kind === 'ara-capabilities') return { kind: request.kind, supported: true }
	if (request.kind === 'open-vendor-ui') return { kind: 'vendor-ui', status: 'opened' }
	if (request.kind === 'close-vendor-ui') return { kind: 'vendor-ui', status: 'closed' }
	if (request.kind === 'ara-render') return { kind: request.kind, startFrame: request.startFrame,
		channels: [new Float32Array(Number(request.frameCount)).fill(0.5)] }
	return { kind: request.kind }
}

test('ARA helper closes its editor before rendering and disposes its supervised port once', async () => {
	const f = fixture(reply)
	const backend = await f.open()
	assert.equal(await backend.configure(source), true)
	await backend.write({ startFrame: 0, channels: [new Float32Array(4)] })
	await backend.bind()
	await backend.openEditor()
	assert.deepEqual(Array.from((await backend.render({ startFrame: 0, frameCount: 4, channelCount: 1 }))[0]!), [0.5, 0.5, 0.5, 0.5])
	await backend.close(); await backend.close()
	assert.deepEqual(f.calls, ['configure', 'ara-capabilities', 'ara-configure', 'ara-write', 'ara-bind',
		'open-vendor-ui', 'close-vendor-ui', 'ara-render', 'port-close'])
	assert.equal(f.disposed(), 1)
	assert.deepEqual(f.faults, [])
})

test('ARA helper waits for analysis and refuses truncated native rendering', async () => {
	let renders = 0
	const f = fixture((request) => request.kind !== 'ara-render' ? reply(request)
		: ++renders === 1 ? { kind: 'ara-render', analysisPending: true }
			: { ...reply(request), channels: [new Float32Array(1)] })
	const backend = await f.open()
	await backend.configure(source)
	await assert.rejects(backend.render({ startFrame: 0, frameCount: 4, channelCount: 1 }), /frame count/u)
	assert.equal(renders, 2)
	await backend.close()
})

test('ARA helper rejects a matching request ID with the wrong operation response', async () => {
	const f = fixture((request) => request.kind === 'ara-bind' ? { kind: 'ara-write' } : reply(request))
	const backend = await f.open()
	await backend.configure(source)
	await assert.rejects(backend.bind(), /operation|response/u)
	assert.equal(f.faults.length, 1)
	await backend.close()
})
