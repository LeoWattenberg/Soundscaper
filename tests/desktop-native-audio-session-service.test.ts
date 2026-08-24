/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict'
import test from 'node:test'

import {
	DesktopNativeAudioSessionService,
	type NativeAudioAdapterSession,
	type NativeAudioBackendAdapter,
} from '../desktop/native-audio-session-service.ts'
import { HELPER_SUPERVISOR_MAXIMUM_GATE_HOLDERS } from '../desktop/helper-supervisor.ts'

const OWNER = {}
const TARGET = { postMessage() {} }
const FORMAT = Object.freeze({
	direction: 'output' as const,
	mode: 'shared' as const,
	sampleRate: 48_000,
	periodFrames: 1_024,
	channelCount: 2,
})

function request(backends: readonly string[]) {
	return {
		...FORMAT,
		candidates: backends.map((backend, index) => ({
			backend, deviceHandle: `device_${String(index).padStart(2, '0')}`,
		})),
	}
}

function session(backend: NativeAudioAdapterSession['backend'], closed: string[]) {
	return {
		backend,
		format: FORMAT,
		close: () => { closed.push(backend) },
	} satisfies NativeAudioAdapterSession
}

function service(
	adapter: NativeAudioBackendAdapter,
	bound: unknown[] = [],
	revoked: unknown[] = [],
	calibrations: unknown[] = [],
) {
	return new DesktopNativeAudioSessionService({
		adapter,
		mintId: () => 'audio_session_0001',
		broker: {
			authorize: (value) => ({
				status: 'authorized', generation: 7,
				format: Object.freeze({ ...value }),
			}),
			revokeOwner: (owner) => { revoked.push(owner) },
		},
		realtime: {
			bind: (value) => { bound.push(value); return Promise.resolve() },
		},
		persistCalibration: async (value) => { calibrations.push(value) },
	})
}

test('audio fallback advances only for backend/server absence and reports every attempt', async () => {
	const closed: string[] = []
	const calls: string[] = []
	const adapter: NativeAudioBackendAdapter = {
		async open(candidate) {
			calls.push(candidate.backend)
			if (candidate.backend === 'pipewire') {
				return { status: 'refused', code: 'server-absent', detail: 'PipeWire is not running.' }
			}
			return { status: 'opened', session: session('alsa', closed) }
		},
	}
	const opened = await service(adapter).open(OWNER, request(['pipewire', 'alsa']))
	assert.equal(opened.status, 'opened')
	assert.deepEqual(calls, ['pipewire', 'alsa'])
	assert.deepEqual(opened.attempts.map(({ status }) => status), ['server-absent', 'opened'])

	const noFallback: NativeAudioBackendAdapter = {
		async open(candidate) {
			calls.push(candidate.backend)
			return { status: 'refused', code: 'format-refused', detail: 'Exact rate refused.' }
		},
	}
	calls.length = 0
	const refused = await service(noFallback).open(OWNER, request(['pipewire', 'alsa']))
	assert.equal(refused.status, 'refused')
	assert.deepEqual(calls, ['pipewire'])
})

test('audio exact-format substitution is closed and JACK remains discovery-only', async () => {
	const closed: string[] = []
	const adapter: NativeAudioBackendAdapter = {
		async open() {
			return { status: 'opened', session: {
				...session('wasapi', closed), format: { ...FORMAT, sampleRate: 44_100 },
			} }
		},
	}
	const substituted = await service(adapter).open(OWNER, request(['wasapi']))
	assert.equal(substituted.status, 'refused')
	assert.equal(substituted.code, 'format-refused')
	assert.deepEqual(closed, ['wasapi'])
	let reached = false
	const jack = await service({ open: async () => { reached = true; throw new Error('unreachable') } })
		.open(OWNER, request(['jack']))
	assert.equal(jack.status, 'refused')
	assert.equal(jack.code, 'streaming-unavailable')
	assert.equal(reached, false)
	await assert.rejects(
		() => service({ open: async () => { reached = true; throw new Error('unreachable') } })
			.open(OWNER, request(['wasapi', 'asio'])),
		/ASIO audio candidates require exclusive mode/u,
	)
	assert.equal(reached, false)
})

test('audio bind fixes 1024 planar-flow authorization and lifecycle closes/revokes exactly', async () => {
	const closed: string[] = []
	const bound: unknown[] = []
	const revoked: unknown[] = []
	const lifecycle = service({
		open: async () => ({ status: 'opened', session: session('coreaudio', closed) }),
	}, bound, revoked)
	const opened = await lifecycle.open(OWNER, request(['coreaudio']))
	assert.equal(opened.status, 'opened')
	if (opened.status !== 'opened') return
	assert.deepEqual(await lifecycle.bind(OWNER, {
		sessionId: opened.sessionId, owner: TARGET, queueCapacity: 8,
	}), { status: 'bound', generation: 7 })
	const binding = bound[0] as { format: Record<string, unknown> }
	assert.equal(binding.format.frameCount, 1_024)
	assert.equal(binding.format.channelCount, 2)
	lifecycle.reportTransfer(OWNER, opened.sessionId, 1_024, 8)
	assert.deepEqual(lifecycle.status(OWNER, opened.sessionId), {
		sessionId: opened.sessionId,
		state: 'bound',
		backend: 'coreaudio',
		format: FORMAT,
		attempts: [{ backend: 'coreaudio', status: 'opened', detail: 'The exact requested stream opened.' }],
		framesTransferred: 1_024,
		lostFrames: 8,
		calibrationFrames: null,
		calibrationAvailable: false,
		calibrationUnavailableReason: 'duplex-required',
		transport: 'native',
		fallback: null,
	})
	assert.throws(() => lifecycle.reportTransfer({}, opened.sessionId, 1, 0), /another renderer/iu)
	assert.deepEqual(await lifecycle.reportDeviceLost(OWNER, opened.sessionId, 'device-loss'), {
		continuity: 'stop-monitoring', webCoreFallbackEligible: true,
	})
	const lost = lifecycle.status(OWNER, opened.sessionId)
	assert.equal(lost.transport, 'web-core')
	assert.deepEqual(lost.fallback, {
		active: true, eligible: true, reason: 'device-loss',
	})
	assert.equal(revoked.length, 1)
	await lifecycle.close(OWNER, opened.sessionId)
	assert.deepEqual(closed, ['coreaudio'])
	assert.equal(revoked.length, 1, 'loss and close revoke the real-time owner exactly once')
})

test('bound duplex calibration accepts only a measured frame offset and persists its exact identity', async () => {
	const closed: string[] = []
	const calibrations: unknown[] = []
	const duplexFormat = Object.freeze({ ...FORMAT, direction: 'duplex' as const, mode: 'exclusive' as const })
	const lifecycle = service({
		open: async () => ({ status: 'opened', session: {
			...session('wasapi', closed), format: duplexFormat,
		} }),
	}, [], [], calibrations)
	const opened = await lifecycle.open(OWNER, {
		...duplexFormat,
		candidates: [{ backend: 'wasapi', deviceHandle: 'duplex-device' }],
	})
	assert.equal(opened.status, 'opened')
	if (opened.status !== 'opened') return
	assert.equal(lifecycle.status(OWNER, opened.sessionId).calibrationUnavailableReason, 'bind-required')
	await lifecycle.bind(OWNER, { sessionId: opened.sessionId, owner: TARGET, queueCapacity: 8 })
	assert.equal(lifecycle.status(OWNER, opened.sessionId).calibrationAvailable, true)
	const measured = await lifecycle.calibrate(OWNER, opened.sessionId, 384)
	assert.equal(measured.calibrationFrames, 384)
	assert.deepEqual(calibrations, [{
		identity: {
			inputDeviceId: 'native:wasapi:in:duplex-device',
			outputDeviceId: 'native:wasapi:out:duplex-device',
			backend: 'wasapi', mode: 'exclusive', sampleRate: 48_000, bufferFrames: 1_024,
		},
		offsetFrames: 384,
	}])
	await assert.rejects(() => lifecycle.calibrate(OWNER, opened.sessionId, 1_048_577), /offset/iu)
	await lifecycle.close(OWNER, opened.sessionId)
})

test('device loss closes the adapter exactly once while its terminal fallback remains readable', async () => {
	let closeCalls = 0
	let releaseClose: (() => void) | null = null
	const lifecycle = service({
		open: async () => ({ status: 'opened', session: {
			backend: 'alsa', format: FORMAT,
			close: () => {
				closeCalls += 1
				return closeCalls === 1
					? new Promise<void>((resolve) => { releaseClose = resolve })
					: Promise.resolve()
			},
		} }),
	})
	const opened = await lifecycle.open(OWNER, request(['alsa']))
	assert.equal(opened.status, 'opened')
	if (opened.status !== 'opened') return
	const loss = lifecycle.reportDeviceLost(OWNER, opened.sessionId, 'device-loss')
	let duplicateSettled = false
	const duplicateLoss = lifecycle.reportDeviceLost(OWNER, opened.sessionId, 'device-loss')
		.then((value) => { duplicateSettled = true; return value })
	const explicitClose = lifecycle.close(OWNER, opened.sessionId)
	await Promise.resolve()
	assert.equal(closeCalls, 1)
	assert.equal(duplicateSettled, false, 'duplicate loss waits for the shared adapter close')
	invokeDeferred(releaseClose)
	await Promise.all([loss, duplicateLoss, explicitClose])
	assert.equal(closeCalls, 1, 'loss racing explicit close must share the one adapter close')

	const second = await lifecycle.open(OWNER, request(['alsa']))
	assert.equal(second.status, 'opened')
	if (second.status !== 'opened') return
	await lifecycle.reportDeviceLost(OWNER, second.sessionId, 'device-loss')
	assert.equal(lifecycle.status(OWNER, second.sessionId).state, 'device-lost',
		'a loss tombstone stays readable until explicit close or owner revocation')
})

test('renderer audio handles are pathless and owner scoped', async () => {
	const lifecycle = service({
		open: async () => ({ status: 'opened', session: session('alsa', []) }),
	})
	await assert.rejects(() => lifecycle.open(OWNER, {
		...request(['alsa']), candidates: [{ backend: 'alsa', deviceHandle: '/dev/snd/pcmC0D0p' }],
	}), /opaque device handle/iu)
	const opened = await lifecycle.open(OWNER, request(['alsa']))
	assert.equal(opened.status, 'opened')
	if (opened.status !== 'opened') return
	assert.throws(() => lifecycle.status({}, opened.sessionId), /another renderer/iu)
})

test('audio plane and selected queue bounds accept 32/8 and reject 33 or a different queue', async () => {
	const closed: string[] = []
	const exact32 = Object.freeze({ ...FORMAT, channelCount: 32 })
	const lifecycle = service({
		open: async () => ({ status: 'opened', session: {
			...session('alsa', closed), format: exact32,
		} }),
	})
	const opened = await lifecycle.open(OWNER, { ...request(['alsa']), ...exact32 })
	assert.equal(opened.status, 'opened')
	if (opened.status !== 'opened') return
	await assert.rejects(() => lifecycle.bind(OWNER, {
		sessionId: opened.sessionId, owner: TARGET, queueCapacity: 7,
	}), /queue capacity/iu)
	await assert.rejects(() => lifecycle.bind(OWNER, {
		sessionId: opened.sessionId, owner: TARGET, queueCapacity: 9,
	}), /queue capacity/iu)
	await lifecycle.bind(OWNER, { sessionId: opened.sessionId, owner: TARGET, queueCapacity: 8 })
	await assert.rejects(() => lifecycle.open(OWNER, {
		...request(['alsa']), channelCount: 33,
	}), /channel count/iu)
})

test('bind is one-shot and revokes a failed real-time authorization', async () => {
	let finishBind: ((error?: Error) => void) | null = null
	const revoked: unknown[] = []
	const lifecycle = new DesktopNativeAudioSessionService({
		adapter: { open: async () => ({ status: 'opened', session: session('alsa', []) }) },
		mintId: () => 'audio_session_bind_race',
		broker: {
			authorize: (value) => ({ status: 'authorized', generation: 1, format: value }),
			revokeOwner: (owner) => { revoked.push(owner) },
		},
		realtime: { bind: () => new Promise<void>((resolve, reject) => {
			finishBind = (error) => { if (error) reject(error); else resolve() }
		}) },
	})
	const opened = await lifecycle.open(OWNER, request(['alsa']))
	assert.equal(opened.status, 'opened')
	if (opened.status !== 'opened') return
	const first = lifecycle.bind(OWNER, { sessionId: opened.sessionId, owner: TARGET, queueCapacity: 8 })
	await assert.rejects(() => lifecycle.bind(OWNER, {
		sessionId: opened.sessionId, owner: TARGET, queueCapacity: 8,
	}), /only once/iu)
	invokeDeferred(finishBind, new Error('helper bind failed'))
	await assert.rejects(() => first, /helper bind failed/iu)
	assert.deepEqual(revoked, [TARGET])
})

test('dispose and owner revocation cannot install a session whose adapter open was pending', async () => {
	for (const revoke of ['dispose', 'owner'] as const) {
		let releaseOpen: ((value: { status: 'opened'; session: NativeAudioAdapterSession }) => void) | null = null
		let closes = 0
		const lifecycle = service({ open: () => new Promise((resolve) => { releaseOpen = resolve }) })
		const opening = lifecycle.open(OWNER, request(['alsa']))
		await Promise.resolve()
		const teardown = revoke === 'dispose' ? lifecycle.dispose() : lifecycle.revokeOwner(OWNER)
		invokeDeferred(releaseOpen, { status: 'opened', session: {
			backend: 'alsa', format: FORMAT, close: () => { closes += 1 },
		} })
		const [outcome] = await Promise.all([opening, teardown])
		assert.equal(outcome.status, 'refused')
		assert.equal(closes, 1)
	}
})

function invokeDeferred(value: unknown, ...args: unknown[]): void {
	if (typeof value !== 'function') throw new Error('The deferred test callback was not installed.')
	Reflect.apply(value, undefined, args)
}

test('owner revocation aborts and awaits an in-flight adapter open', async () => {
	let observedAbort = false
	const lifecycle = service({
		open: async (_candidate, _format, signal) => new Promise((resolve) => {
			const cancelled = () => {
				observedAbort = true
				resolve({ status: 'refused', code: 'open-failed', detail: 'cancelled' })
			}
			if (signal?.aborted) cancelled()
			else signal?.addEventListener('abort', cancelled, { once: true })
		}),
	})
	const opening = lifecycle.open(OWNER, request(['alsa']))
	await lifecycle.revokeOwner(OWNER)
	assert.equal(observedAbort, true)
	assert.equal((await opening).status, 'refused')
})

test('persistent audio open admission is bounded before adapter resources and recovers after revocation', async () => {
	let adapterCalls = 0
	let first = true
	const lifecycle = service({
		open: async (_candidate, _format, signal) => {
			adapterCalls += 1
			if (first) {
				first = false
				return { status: 'opened', session: session('alsa', []) }
			}
			return await new Promise((resolve) => {
				const cancelled = () => resolve({
					status: 'refused', code: 'open-failed', detail: 'cancelled',
				})
				if (signal?.aborted) cancelled()
				else signal?.addEventListener('abort', cancelled, { once: true })
			})
		},
	})
	const activeOwner = {}
	const queuedOwner = {}
	const recoveryOwner = {}
	const active = await lifecycle.open(activeOwner, request(['alsa']))
	assert.equal(active.status, 'opened')
	if (active.status !== 'opened') return
	const admitted = Array.from({ length: HELPER_SUPERVISOR_MAXIMUM_GATE_HOLDERS - 1 }, () => (
		lifecycle.open(queuedOwner, request(['alsa']))
	))
	const excess = await lifecycle.open(queuedOwner, request(['alsa']))
	assert.equal(excess.status, 'refused')
	if (excess.status !== 'refused') return
	assert.equal(excess.code, 'open-failed')
	assert.match(excess.message, /capacity/iu)
	assert.equal(adapterCalls, HELPER_SUPERVISOR_MAXIMUM_GATE_HOLDERS,
		'excess admission must not allocate another adapter channel')
	await lifecycle.revokeOwner(queuedOwner)
	assert.equal((await Promise.all(admitted)).every(({ status }) => status === 'refused'), true)
	assert.equal(lifecycle.status(activeOwner, active.sessionId).state, 'open',
		'queued-owner revocation must leave the first persistent session active')
	const recovered = lifecycle.open(recoveryOwner, request(['alsa']))
	await Promise.resolve()
	assert.equal(adapterCalls, HELPER_SUPERVISOR_MAXIMUM_GATE_HOLDERS + 1,
		'a cancelled queued open must immediately free one adapter admission')
	await lifecycle.revokeOwner(recoveryOwner)
	assert.equal((await recovered).status, 'refused')
	await lifecycle.close(activeOwner, active.sessionId)
})
