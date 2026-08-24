/* SPDX-License-Identifier: AGPL-3.0-only */

import { randomBytes } from 'node:crypto'

import type { HelperJobRequest } from './helper-supervisor.ts'
import type {
	NativeAudioAdapterOpenOutcome,
	NativeAudioAdapterSession,
	NativeAudioBackendAdapter,
	NativeAudioExactFormat,
	NativeAudioOpenCandidate,
	NativeAudioRealtimeBinder,
	NativeAudioStreamingBackend,
} from './native-audio-session-service.ts'

const PORT_PROTOCOL_VERSION = 1
const MAXIMUM_MESSAGE_BYTES = 16 * 1_024 * 1_024

export interface NativeMainMessagePort {
	postMessage(message: unknown, transfer?: readonly ArrayBuffer[]): void
	start?(): void
	close(): void
	on?(event: 'message', listener: (event: unknown) => void): void
	off?(event: 'message', listener: (event: unknown) => void): void
	onmessage?: ((event: Readonly<{ data: unknown }>) => void) | null
}

export interface NativeMainMessageChannel {
	readonly port1: NativeMainMessagePort
	readonly port2: NativeMainMessagePort
}

export interface PersistentAudioSupervisor {
	runJob(request: HelperJobRequest<'audio-device'>): Promise<unknown>
}

export interface NativeAudioPortBroker {
	acceptHelperPort(offer: unknown, ports: readonly NativeMainMessagePort[]): Readonly<{
		status: 'delivered' | 'refused'
		message?: string
	}>
}

interface HelperAudioSession extends NativeAudioAdapterSession {
	handoff(generation: number, format: Readonly<Record<string, unknown>>): void
}

export interface NativeAudioHelperRuntimeOptions {
	readonly supervisor: PersistentAudioSupervisor
	readonly broker: NativeAudioPortBroker
	readonly createChannel: () => NativeMainMessageChannel
	readonly mintStreamId?: () => string
	readonly configureTimeoutMs?: number
}

/** Main-side adapter for one exact helper-owned device and its direct renderer port. */
export function createNativeAudioHelperRuntime(
	options: NativeAudioHelperRuntimeOptions,
): Readonly<{ adapter: NativeAudioBackendAdapter; realtime: NativeAudioRealtimeBinder }> {
	const adapter = new HelperBackendAdapter(options)
	const realtime: NativeAudioRealtimeBinder = Object.freeze({
		bind: async ({ session, generation, format }: Parameters<NativeAudioRealtimeBinder['bind']>[0]) => {
			if (!isHelperSession(session)) throw new TypeError('That audio session was not opened by this helper adapter.')
			session.handoff(generation, format)
		},
	})
	return Object.freeze({ adapter, realtime })
}

class HelperBackendAdapter implements NativeAudioBackendAdapter {
	readonly #options: NativeAudioHelperRuntimeOptions

	constructor(options: NativeAudioHelperRuntimeOptions) {
		this.#options = options
	}

	async open(
		candidate: Readonly<NativeAudioOpenCandidate>,
		format: Readonly<NativeAudioExactFormat>,
		signal?: AbortSignal,
	): Promise<NativeAudioAdapterOpenOutcome> {
		if (candidate.backend === 'jack') {
			return refused('streaming-unavailable', 'JACK is discovery-only.')
		}
		const channel = this.#options.createChannel()
		const streamId = (this.#options.mintStreamId ?? (() => randomBytes(20).toString('hex')))()
		if (!/^[a-f\d]{40}$/u.test(streamId)) throw new Error('The audio stream ID factory returned an invalid ID.')
		const abort = new AbortController()
		const forwardAbort = (): void => abort.abort()
		signal?.addEventListener('abort', forwardAbort, { once: true })
		if (signal?.aborted === true) abort.abort()
		const completion = this.#options.supervisor.runJob({
			kind: 'audio-device',
			grant: {
				backend: candidate.backend,
				deviceHandle: candidate.deviceHandle,
				direction: format.direction,
				mode: format.mode,
				persistentPort: {
					portContractVersion: 1,
					transport: 'message-port',
					purpose: 'audio-realtime',
					streamId,
					generation: 1,
					maximumMessageBytes: MAXIMUM_MESSAGE_BYTES,
					maximumInFlightMessages: 8,
				},
			},
			signal: abort.signal,
			dataPlaneTransfers: [{ streamId, port: channel.port1 }],
		})
		const configured = waitForConfiguration(
			channel.port2, completion, this.#options.configureTimeoutMs ?? 10_000, abort.signal,
		)
		channel.port2.start?.()
		channel.port2.postMessage({
			protocolVersion: PORT_PROTOCOL_VERSION,
			kind: 'configure',
			sampleRate: format.sampleRate,
			periodFrames: format.periodFrames,
			channelCount: format.channelCount,
		})
		let answer: ConfiguredAnswer
		try {
			answer = await configured
		} catch (error) {
			abort.abort()
			close(channel.port2)
			await completion.catch(() => undefined)
			signal?.removeEventListener('abort', forwardAbort)
			return refused('open-failed', describe(error))
		}
		if (answer.status === 'refused') {
			abort.abort()
			close(channel.port2)
			await completion.catch(() => undefined)
			signal?.removeEventListener('abort', forwardAbort)
			return refused(answer.code, answer.detail)
		}
		signal?.removeEventListener('abort', forwardAbort)
		const session = createSession({
			abort,
			backend: answer.backend,
			broker: this.#options.broker,
			completion,
			format: answer.format,
			port: channel.port2,
		})
		return Object.freeze({ status: 'opened' as const, session })
	}
}

type RefusalCode = Exclude<NativeAudioAdapterOpenOutcome, { status: 'opened' }>['code']
type ConfiguredAnswer =
	| Readonly<{ status: 'opened'; backend: NativeAudioStreamingBackend; format: NativeAudioExactFormat }>
	| Readonly<{ status: 'refused'; code: RefusalCode; detail: string }>

function createSession(input: Readonly<{
	abort: AbortController
	backend: NativeAudioStreamingBackend
	broker: NativeAudioPortBroker
	completion: Promise<unknown>
	format: NativeAudioExactFormat
	port: NativeMainMessagePort
}>): HelperAudioSession {
	let handedOff = false
	let closed = false
	return Object.freeze({
		backend: input.backend,
		format: input.format,
		handoff: (generation: number, wireFormat: Readonly<Record<string, unknown>>) => {
			if (closed || handedOff) throw new Error('The native audio port is no longer available for hand-off.')
			const offer = {
				protocolVersion: 1,
				generation,
				startFrame: 0,
				sampleFormat: 'f32-planar',
				sampleRate: wireFormat.sampleRate,
				channelCount: wireFormat.channelCount,
				frameCount: wireFormat.frameCount,
				queueCapacity: wireFormat.queueCapacity,
			}
			const outcome = input.broker.acceptHelperPort(offer, [input.port])
			if (outcome.status !== 'delivered') throw new Error(outcome.message ?? 'The audio port hand-off was refused.')
			handedOff = true
		},
		close: async () => {
			if (closed) return
			closed = true
			input.abort.abort()
			if (!handedOff) close(input.port)
			await input.completion.catch(() => undefined)
		},
	})
}

function isHelperSession(value: NativeAudioAdapterSession): value is HelperAudioSession {
	return typeof (value as Partial<HelperAudioSession>).handoff === 'function'
}

function waitForConfiguration(
	port: NativeMainMessagePort,
	completion: Promise<unknown>,
	timeoutMs: number,
	signal: AbortSignal,
): Promise<ConfiguredAnswer> {
	return new Promise((resolve, reject) => {
		let settled = false
		const timer = setTimeout(() => settle(() => reject(new Error('The native audio helper did not configure in time.'))), timeoutMs)
		const cancelled = () => settle(() => reject(new Error('The native audio helper open was cancelled.')))
		const listener = (event: unknown) => {
			const value = messageData(event)
			if (!value || typeof value !== 'object') return
			const record = value as Record<string, unknown>
			if (record.kind === 'fault') settle(() => reject(new Error(describe(record.detail ?? record.code))))
			if (record.kind !== 'configured') return
			try { settle(() => resolve(normalizeConfiguredAnswer(record))) } catch (error) { settle(() => reject(error)) }
		}
		const settle = (action: () => void) => {
			if (settled) return
			settled = true
			clearTimeout(timer)
			removeListener(port, listener)
			signal.removeEventListener('abort', cancelled)
			action()
		}
		addListener(port, listener)
		signal.addEventListener('abort', cancelled, { once: true })
		if (signal.aborted) cancelled()
		void completion.catch((error) => settle(() => reject(error)))
	})
}

function normalizeConfiguredAnswer(record: Record<string, unknown>): ConfiguredAnswer {
	if (record.protocolVersion !== PORT_PROTOCOL_VERSION) throw new Error('The audio helper used an unsupported port protocol.')
	if (record.status === 'refused') {
		const code = String(record.code) as RefusalCode
		if (!['backend-absent', 'server-absent', 'device-unavailable', 'format-refused', 'mode-refused',
			'streaming-unavailable', 'invalid-request', 'open-failed'].includes(code)) {
			throw new Error('The audio helper returned an unknown refusal.')
		}
		return Object.freeze({ status: 'refused' as const, code, detail: describe(record.detail) })
	}
	if (record.status !== 'opened' || !['coreaudio', 'wasapi', 'asio', 'pipewire', 'alsa'].includes(String(record.backend))) {
		throw new Error('The audio helper returned a malformed open result.')
	}
	const format = record.format as NativeAudioExactFormat
	return Object.freeze({
		status: 'opened' as const,
		backend: record.backend as NativeAudioStreamingBackend,
		format: Object.freeze({ ...format }),
	})
}

function addListener(port: NativeMainMessagePort, listener: (event: unknown) => void): void {
	if (port.on) port.on('message', listener)
	else port.onmessage = (event) => listener(event)
}

function removeListener(port: NativeMainMessagePort, listener: (event: unknown) => void): void {
	if (port.off) port.off('message', listener)
	else port.onmessage = null
}

function messageData(value: unknown): unknown {
	return value && typeof value === 'object' && 'data' in value ? (value as { data: unknown }).data : value
}

function refused(code: RefusalCode, detail: string): NativeAudioAdapterOpenOutcome {
	return Object.freeze({ status: 'refused' as const, code, detail })
}

function close(port: NativeMainMessagePort): void {
	try { port.close() } catch { /* already transferred or closed */ }
}

function describe(value: unknown): string {
	return (value instanceof Error ? value.message : String(value ?? 'The native audio helper failed.')).slice(0, 2_048)
}
