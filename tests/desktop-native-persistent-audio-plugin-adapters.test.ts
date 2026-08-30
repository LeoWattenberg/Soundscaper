/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import test from 'node:test'

import { createNativeAudioHelperRuntime } from '../desktop/native-audio-helper-adapter.ts'
import { createNativePersistentAudioJobRunner } from '../desktop/native-helper-persistent-audio-job.js'
import { createNativePersistentPluginJobRunner } from '../desktop/native-helper-persistent-plugin-job.js'
import {
	createNativePluginOfflineRunner,
	openNativePersistentPluginSession,
} from '../desktop/native-plugin-helper-adapter.ts'

interface FakeMessageEvent { readonly data: unknown }

class FakePort {
	peer: FakePort | null = null
	closed = false
	readonly listeners = new Set<(event: FakeMessageEvent) => void>()
	onmessage: ((event: FakeMessageEvent) => void) | null = null

	postMessage(message: unknown): void {
		const event = Object.freeze({ data: message })
		queueMicrotask(() => {
			for (const listener of this.peer?.listeners ?? []) listener(event)
			this.peer?.onmessage?.(event)
		})
	}

	on(_event: 'message', listener: (event: FakeMessageEvent) => void): void { this.listeners.add(listener) }
	off(_event: 'message', listener: (event: FakeMessageEvent) => void): void { this.listeners.delete(listener) }
	start(): void {}
	close(): void { this.closed = true }
}

function channel(): Readonly<{ port1: FakePort; port2: FakePort }> {
	const port1 = new FakePort()
	const port2 = new FakePort()
	port1.peer = port2
	port2.peer = port1
	return Object.freeze({ port1, port2 })
}

function nextMessage(port: FakePort): Promise<Record<string, unknown>> {
	return new Promise((resolve) => {
		const listener = (event: FakeMessageEvent) => {
			port.off('message', listener)
			resolve(event.data as Record<string, unknown>)
		}
		port.on('message', listener)
	})
}

const AUDIO_GRANT = Object.freeze({
	backend: 'pipewire',
	deviceHandle: '@DEFAULT_SINK@',
	direction: 'output',
	mode: 'shared',
	persistentPort: Object.freeze({
		portContractVersion: 1,
		transport: 'message-port',
		purpose: 'audio-realtime',
		streamId: 'a'.repeat(40),
		generation: 1,
		maximumMessageBytes: 16 * 1_024 * 1_024,
		maximumInFlightMessages: 8,
	}),
})

test('persistent audio runner opens exact format and moves blocks over only the admitted port', async () => {
	const link = channel()
	const writes: unknown[][] = []
	const runner = createNativePersistentAudioJobRunner({
		addonPath: '/addon.node',
		addonSha256: 'b'.repeat(64),
		loadAddon: async () => ({
			openAudioDevice: (request: Record<string, unknown>) => ({
				status: 'ok', session: Object.freeze({}), grantedBackend: 'pipewire',
				grantedSampleRate: request.sampleRate, grantedPeriodFrames: request.periodFrames,
				grantedChannelCount: request.channelCount, grantedExclusive: false,
			}),
			writeAudioDevice: (...args: unknown[]) => { writes.push(args); return { status: 'ok', framesTransferred: 4 } },
			closeAudioDevice: () => true,
		}),
	})
	const handle = runner({ grant: AUDIO_GRANT, ports: [link.port1] })
	let response = nextMessage(link.port2)
	link.port2.postMessage({
		protocolVersion: 1, kind: 'configure', sampleRate: 48_000, periodFrames: 1_024, channelCount: 2,
	})
	assert.deepEqual(await response, {
		protocolVersion: 1, kind: 'configured', status: 'opened', backend: 'pipewire',
		format: { direction: 'output', mode: 'shared', sampleRate: 48_000, periodFrames: 1_024, channelCount: 2 },
	})
	const planes = [new Float32Array(4), new Float32Array(4)]
	response = nextMessage(link.port2)
	link.port2.postMessage({
		protocolVersion: 1, kind: 'audio', generation: 3, packetId: 0, sequence: 0,
		startFrame: 0, frameCount: 4, channels: planes,
	})
	assert.equal((await response).kind, 'return')
	assert.equal(writes.length, 1)
	link.port2.postMessage({ protocolVersion: 1, kind: 'close', reason: 'editor-shutdown' })
	assert.equal((await handle.completion).reason, 'editor-shutdown')
})

test('a field-invalid audio block faults the session instead of killing the helper process', async () => {
	const link = channel()
	const runner = createNativePersistentAudioJobRunner({
		addonPath: '/addon.node',
		addonSha256: 'b'.repeat(64),
		loadAddon: async () => ({
			openAudioDevice: (request: Record<string, unknown>) => ({
				status: 'ok', session: Object.freeze({}), grantedBackend: 'pipewire',
				grantedSampleRate: request.sampleRate, grantedPeriodFrames: request.periodFrames,
				grantedChannelCount: request.channelCount, grantedExclusive: false,
			}),
			writeAudioDevice: () => { throw new Error('must not be reached with invalid planes') },
			closeAudioDevice: () => true,
		}),
	})
	const handle = runner({ grant: AUDIO_GRANT, ports: [link.port1] })
	const configured = nextMessage(link.port2)
	link.port2.postMessage({
		protocolVersion: 1, kind: 'configure', sampleRate: 48_000, periodFrames: 1_024, channelCount: 2,
	})
	assert.equal((await configured).kind, 'configured')
	const answer = nextMessage(link.port2)
	// One plane where the configured format admits two: a validation refusal,
	// which must fault this session rather than exit the process through an
	// unhandled rejection and take every native audio session with it.
	link.port2.postMessage({
		protocolVersion: 1, kind: 'audio', generation: 3, packetId: 0, sequence: 0,
		startFrame: 0, frameCount: 4, channels: [new Float32Array(4)],
	})
	const fault = await answer
	assert.equal(fault.kind, 'fault')
	assert.equal(fault.code, 'malformed-message')
	assert.equal(((await handle.completion) as { reason: string }).reason, 'malformed-message')
})

test('main audio adapter transfers the peer directly after exact helper configuration', async () => {
	const links: ReturnType<typeof channel>[] = []
	let admittedGrantPurpose = ''
	const supervisor = {
		runJob: (request: Record<string, unknown>) => {
			admittedGrantPurpose = (request.grant as { persistentPort: { purpose: string } }).persistentPort.purpose
			const port = (request.dataPlaneTransfers as { port: FakePort }[])[0].port
			port.on('message', ({ data }) => {
				const value = data as Record<string, unknown>
				if (value.kind !== 'configure') return
				port.postMessage({
					protocolVersion: 1, kind: 'configured', status: 'opened', backend: 'pipewire',
					format: { direction: 'output', mode: 'shared', sampleRate: 48_000, periodFrames: 1_024, channelCount: 2 },
				})
			})
			return new Promise((_resolve, reject) => {
				(request.signal as AbortSignal).addEventListener('abort', () => reject(new Error('cancelled')), { once: true })
			})
		},
	}
	const deliveries: unknown[][] = []
	const runtime = createNativeAudioHelperRuntime({
		supervisor: supervisor as never,
		broker: {
			acceptHelperPort: (offer, ports) => {
				deliveries.push([offer, ports])
				return Object.freeze({ status: 'delivered' as const })
			},
		},
		createChannel: () => { const value = channel(); links.push(value); return value },
		mintStreamId: () => 'c'.repeat(40),
	})
	const outcome = await runtime.adapter.open(
		{ backend: 'pipewire', deviceHandle: '@DEFAULT_SINK@' },
		{ direction: 'output', mode: 'shared', sampleRate: 48_000, periodFrames: 1_024, channelCount: 2 },
	)
	assert.equal(outcome.status, 'opened')
	assert.equal(admittedGrantPurpose, 'audio-realtime')
	if (outcome.status !== 'opened') return
	await runtime.realtime.bind({
		session: outcome.session,
		generation: 7,
		format: { sampleRate: 48_000, channelCount: 2, frameCount: 1_024, queueCapacity: 8 },
	})
	assert.equal(deliveries.length, 1)
	assert.deepEqual(deliveries[0][1], [links[0].port2])
	await outcome.session.close()
})

test('a helper job that settles mid-session notifies the broker of helper exit', async () => {
	let rejectJob!: (error: Error) => void
	const supervisor = {
		runJob: (request: Record<string, unknown>) => {
			const port = (request.dataPlaneTransfers as { port: FakePort }[])[0].port
			port.on('message', ({ data }) => {
				const value = data as Record<string, unknown>
				if (value.kind !== 'configure') return
				port.postMessage({
					protocolVersion: 1, kind: 'configured', status: 'opened', backend: 'pipewire',
					format: { direction: 'output', mode: 'shared', sampleRate: 48_000, periodFrames: 1_024, channelCount: 2 },
				})
			})
			return new Promise((_resolve, reject) => { rejectJob = reject })
		},
	}
	let helperExits = 0
	const runtime = createNativeAudioHelperRuntime({
		supervisor: supervisor as never,
		broker: {
			acceptHelperPort: () => Object.freeze({ status: 'delivered' as const }),
			notifyHelperExit: () => { helperExits += 1 },
		},
		createChannel: channel,
		mintStreamId: () => 'd'.repeat(40),
	})
	const outcome = await runtime.adapter.open(
		{ backend: 'pipewire', deviceHandle: '@DEFAULT_SINK@' },
		{ direction: 'output', mode: 'shared', sampleRate: 48_000, periodFrames: 1_024, channelCount: 2 },
	)
	assert.equal(outcome.status, 'opened')
	if (outcome.status !== 'opened') return
	assert.equal(helperExits, 0)
	rejectJob(new Error('The helper process exited unexpectedly.'))
	await new Promise((resolve) => setImmediate(resolve))
	assert.equal(helperExits, 1, 'a dying helper must close the live realtime generation')
	await outcome.session.close()
	assert.equal(helperExits, 1, 'a deliberate close is not a helper exit')
})

test('main audio adapter aborts and quiesces a helper that is still configuring', async () => {
	const links: ReturnType<typeof channel>[] = []
	let helperSettled = false
	const runtime = createNativeAudioHelperRuntime({
		supervisor: { runJob: (request: Record<string, unknown>) => new Promise((_resolve, reject) => {
			(request.signal as AbortSignal).addEventListener('abort', () => {
				helperSettled = true
				reject(new Error('cancelled'))
			}, { once: true })
		}) } as never,
		broker: { acceptHelperPort: () => Object.freeze({ status: 'refused' as const }) },
		createChannel: () => { const value = channel(); links.push(value); return value },
		mintStreamId: () => 'd'.repeat(40),
		configureTimeoutMs: 10_000,
	})
	const abort = new AbortController()
	const opening = runtime.adapter.open(
		{ backend: 'pipewire', deviceHandle: '@DEFAULT_SINK@' },
		{ direction: 'output', mode: 'shared', sampleRate: 48_000, periodFrames: 1_024, channelCount: 2 },
		abort.signal,
	)
	abort.abort()
	const outcome = await opening
	assert.equal(outcome.status, 'refused')
	assert.equal(helperSettled, true, 'adapter open settles only after the cancelled helper job quiesces')
	assert.equal(links[0].port2.closed, true)
})

const PLUGIN_GRANT = Object.freeze({
	binaryPath: '/effects/gain.scapefx', binaryBytes: 10, binarySha256: 'd'.repeat(64),
	format: 'fixture', stableId: 'fixture:gain', identity: Object.freeze({ dev: 1, ino: 2 }),
	persistentPort: Object.freeze({
		portContractVersion: 1, transport: 'message-port', purpose: 'plugin-rpc',
		streamId: 'e'.repeat(40), generation: 1, maximumMessageBytes: 16 * 1_024 * 1_024,
		maximumInFlightMessages: 8,
	}),
})

const PLUGIN_RESOURCE_POLICY = Object.freeze({
	maximumInputBytes: 16 * 1_024 * 1_024,
	maximumJobDurationMs: 60_000,
	maximumRssBytes: 512 * 1_024 * 1_024,
	allowNetwork: false as const,
	allowChildProcesses: false as const,
	allowOutputFiles: false as const,
})

test('persistent plug-in runner processes, saves, restores and closes over its bound port', async () => {
	const link = channel()
	let restored = 0
	let selected = ''
	const runner = createNativePersistentPluginJobRunner({
		addonPath: '/addon.node', addonSha256: 'f'.repeat(64),
		hashFile: async () => ({ byteLength: 10, sha256: 'd'.repeat(64) }),
		loadAddon: async () => ({
			openPluginInstance: (...args: unknown[]) => { selected = String(args[4]); return Object.freeze({}) },
			closePluginInstance: () => true,
			pluginLatencyFrames: () => 32,
			processPluginBlock: (_instance: unknown, frames: number, input: Float32Array[], output: Float32Array[]) => {
				for (let channel = 0; channel < output.length; channel += 1) output[channel].set(input[channel].subarray(0, frames))
			},
			savePluginState: () => Uint8Array.of(1, 2, 3),
			loadPluginState: (_instance: unknown, bytes: Uint8Array) => { restored = bytes.byteLength; return true },
		}),
	})
	const handle = runner({ grant: PLUGIN_GRANT, ports: [link.port1], resourcePolicy: PLUGIN_RESOURCE_POLICY })
	let response = nextMessage(link.port2)
	link.port2.postMessage({
		protocolVersion: 1, kind: 'configure', sampleRate: 48_000, maximumFrames: 1_024,
		stateAuthenticationKey: '0'.repeat(64),
	})
	assert.equal((await response).reportedLatencyFrames, 32)
	assert.equal(selected, 'fixture:gain')
	response = nextMessage(link.port2)
	link.port2.postMessage({
		protocolVersion: 1, kind: 'process', requestId: 'rpc-1', frameCount: 4,
		input: [Float32Array.of(1, 2, 3, 4)], output: [new Float32Array(4)],
	})
	assert.deepEqual([...((await response).output as Float32Array[])[0]], [1, 2, 3, 4])
	response = nextMessage(link.port2)
	link.port2.postMessage({ protocolVersion: 1, kind: 'save-state', requestId: 'rpc-2' })
	assert.deepEqual([...((await response).bytes as Uint8Array)], [1, 2, 3])
	response = nextMessage(link.port2)
	link.port2.postMessage({ protocolVersion: 1, kind: 'load-state', requestId: 'rpc-3', bytes: Uint8Array.of(4, 5) })
	assert.equal((await response).kind, 'state-loaded')
	assert.equal(restored, 2)
	link.port2.postMessage({ protocolVersion: 1, kind: 'close', reason: 'editor-shutdown' })
	assert.equal((await handle.completion).reason, 'editor-shutdown')
})

test('persistent plug-in vendor UI accepts only a main-minted opaque capability', async () => {
	const link = channel()
	const opened: string[] = []
	const closed: string[] = []
	const runner = createNativePersistentPluginJobRunner({
		addonPath: '/addon.node', addonSha256: 'f'.repeat(64),
		hashFile: async () => ({ byteLength: 10, sha256: 'd'.repeat(64) }),
		loadAddon: async () => ({
			openPluginInstance: () => Object.freeze({}),
			closePluginInstance: () => true,
			pluginLatencyFrames: () => 0,
			openPluginVendorWindow: (_instance: unknown, capability: string) => {
				opened.push(capability)
				return true
			},
			closePluginVendorWindow: (_instance: unknown, capability: string) => {
				closed.push(capability)
				return true
			},
		}),
	})
	const handle = runner({ grant: PLUGIN_GRANT, ports: [link.port1], resourcePolicy: PLUGIN_RESOURCE_POLICY })
	let response = nextMessage(link.port2)
	const authenticationKey = '0'.repeat(64)
	link.port2.postMessage({
		protocolVersion: 1, kind: 'configure', sampleRate: 48_000, maximumFrames: 1_024,
		stateAuthenticationKey: authenticationKey,
	})
	assert.equal((await response).kind, 'configured')
	const rawId = 'window_01'
	const mac = createHmac('sha256', Buffer.from(authenticationKey, 'hex'))
		.update(`${PLUGIN_GRANT.persistentPort.streamId}\0${PLUGIN_GRANT.binarySha256}\0vendor-window\0${rawId}`)
		.digest('hex')
	const capability = `${rawId}.${mac}`
	response = nextMessage(link.port2)
	link.port2.postMessage({
		protocolVersion: 1, kind: 'open-vendor-ui', requestId: 'vendor-open', windowHandleId: capability,
	})
	assert.equal((await response).status, 'opened')
	response = nextMessage(link.port2)
	link.port2.postMessage({
		protocolVersion: 1, kind: 'close-vendor-ui', requestId: 'vendor-close', windowHandleId: capability,
	})
	assert.equal((await response).status, 'closed')
	assert.deepEqual(opened, [capability])
	assert.deepEqual(closed, [capability])
	link.port2.postMessage({ protocolVersion: 1, kind: 'close', reason: 'editor-shutdown' })
	assert.equal((await handle.completion).reason, 'editor-shutdown')
})

test('persistent plug-in vendor UI rejects a renderer-forged capability before native code', async () => {
	const link = channel()
	let nativeCalls = 0
	const runner = createNativePersistentPluginJobRunner({
		addonPath: '/addon.node', addonSha256: 'f'.repeat(64),
		hashFile: async () => ({ byteLength: 10, sha256: 'd'.repeat(64) }),
		loadAddon: async () => ({
			openPluginInstance: () => Object.freeze({}), closePluginInstance: () => true,
			pluginLatencyFrames: () => 0,
			openPluginVendorWindow: () => { nativeCalls += 1; return true },
		}),
	})
	const handle = runner({ grant: PLUGIN_GRANT, ports: [link.port1], resourcePolicy: PLUGIN_RESOURCE_POLICY })
	let response = nextMessage(link.port2)
	link.port2.postMessage({
		protocolVersion: 1, kind: 'configure', sampleRate: 48_000, maximumFrames: 1_024,
		stateAuthenticationKey: '0'.repeat(64),
	})
	assert.equal((await response).kind, 'configured')
	response = nextMessage(link.port2)
	link.port2.postMessage({
		protocolVersion: 1, kind: 'open-vendor-ui', requestId: 'vendor-forged',
		windowHandleId: `window_01.${'1'.repeat(64)}`,
	})
	assert.equal((await response).code, 'vendor-ui-unavailable')
	assert.equal((await handle.completion).reason, 'vendor-ui-unavailable')
	assert.equal(nativeCalls, 0)
})

test('persistent plug-in cancellation fences an async block and releases its instance without a late answer', async () => {
	const link = channel()
	const blockControls: { release: () => void; announce: () => void } = {
		release: () => undefined, announce: () => undefined,
	}
	let closes = 0
	const blockStarted = new Promise<void>((resolve) => { blockControls.announce = resolve })
	const block = new Promise<void>((resolve) => { blockControls.release = resolve })
	const answers: string[] = []
	link.port2.on('message', ({ data }) => { answers.push(String((data as { kind?: unknown }).kind)) })
	const runner = createNativePersistentPluginJobRunner({
		addonPath: '/addon.node', addonSha256: 'f'.repeat(64),
		hashFile: async () => ({ byteLength: 10, sha256: 'd'.repeat(64) }),
		loadAddon: async () => ({
			openPluginInstance: () => Object.freeze({}),
			closePluginInstance: () => { closes += 1; return true },
			pluginLatencyFrames: () => 0,
			processPluginBlock: async () => { blockControls.announce(); await block },
		}),
	})
	const handle = runner({ grant: PLUGIN_GRANT, ports: [link.port1], resourcePolicy: PLUGIN_RESOURCE_POLICY })
	const response = nextMessage(link.port2)
	link.port2.postMessage({
		protocolVersion: 1, kind: 'configure', sampleRate: 48_000, maximumFrames: 1_024,
		stateAuthenticationKey: '0'.repeat(64),
	})
	assert.equal((await response).kind, 'configured')
	answers.length = 0
	link.port2.postMessage({
		protocolVersion: 1, kind: 'process', requestId: 'async-block', frameCount: 1,
		input: [Float32Array.of(1)], output: [new Float32Array(1)],
	})
	await blockStarted
	const cancelled = handle.cancel()
	blockControls.release()
	await cancelled
	assert.equal((await handle.completion).reason, 'user-cancelled')
	await new Promise((resolve) => { setImmediate(resolve) })
	assert.deepEqual(answers, [])
	assert.equal(closes, 1)
})

test('plug-in main adapters admit exact offline results and transfer no binary path to an owner', async () => {
	const offline = createNativePluginOfflineRunner(() => ({
		runJob: async () => ({
			reportedLatencyFrames: 16, latencyStable: true, blocksRendered: 8,
			renderedSha256: '1'.repeat(64), stateBytes: 3, stateRefusal: null,
		}),
	}))
	assert.equal((await offline.run({ grant: PLUGIN_GRANT, instanceId: 'instance-1' })).blocksRendered, 8)

	const link = channel()
	const supervisor = {
		runJob: (request: Record<string, unknown>) => {
			const port = (request.dataPlaneTransfers as { port: FakePort }[])[0].port
			port.on('message', ({ data }) => {
				if ((data as { kind: string }).kind === 'configure') port.postMessage({
					protocolVersion: 1, kind: 'configured', status: 'opened', format: 'fixture', reportedLatencyFrames: 16,
				})
			})
			return new Promise((_resolve, reject) => {
				(request.signal as AbortSignal).addEventListener('abort', () => reject(new Error('cancelled')), { once: true })
			})
		},
	}
	const session = await openNativePersistentPluginSession({
		supervisor: supervisor as never,
		grant: PLUGIN_GRANT,
		createChannel: () => link,
		sampleRate: 48_000,
		maximumFrames: 1_024,
		mintStreamId: () => '2'.repeat(40),
	})
	const vendorCapability = session.vendorWindowCapability('window_01')
	assert.match(vendorCapability, /^window_01\.[a-f\d]{64}$/u)
	assert.notEqual(vendorCapability, session.vendorWindowCapability('window_02'))
	let publicHandshake: unknown = null
	session.transferTo({ postMessage: (_channel: string, message: unknown) => { publicHandshake = message } } as never)
	assert.equal(JSON.stringify(publicHandshake).includes('/effects/'), false)
	assert.equal(JSON.stringify(publicHandshake).includes('d'.repeat(64)), false)
	await session.close()
})

test('a malformed plug-in configuration rejects and closes instead of hanging', async () => {
	const link = channel()
	let helperAborted = false
	const opening = openNativePersistentPluginSession({
		supervisor: { runJob: (request: Record<string, unknown>) => {
			const port = (request.dataPlaneTransfers as { port: FakePort }[])[0].port
			port.on('message', ({ data }) => {
				if ((data as { kind?: string }).kind === 'configure') port.postMessage({
					protocolVersion: 1, kind: 'configured', status: 'opened', format: 'fixture',
				})
			})
			return new Promise((_resolve, reject) => {
				(request.signal as AbortSignal).addEventListener('abort', () => {
					helperAborted = true
					reject(new Error('cancelled'))
				}, { once: true })
			})
		} } as never,
		grant: PLUGIN_GRANT, createChannel: () => link,
		sampleRate: 48_000, maximumFrames: 1_024, mintStreamId: () => '3'.repeat(40),
		configureTimeoutMs: 25,
	})
	const outcome = await Promise.race([
		opening.then(() => 'opened', () => 'rejected'),
		new Promise<'timed-out'>((resolve) => setTimeout(() => resolve('timed-out'), 100)),
	])
	assert.equal(outcome, 'rejected')
	assert.equal(helperAborted, true)
	assert.equal(link.port2.closed, true)
})
