/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	attempt, boundedDetail, boundedInteger, closedRecord, enumValue, normalizeOpenRequest,
	refused, sameFormat, snapshotFormat,
} from './native-audio-session-validation.ts'
import { HELPER_SUPERVISOR_MAXIMUM_GATE_HOLDERS } from './helper-admission-gate.ts'

export const NATIVE_AUDIO_STREAMING_BACKENDS = Object.freeze([
	'coreaudio', 'wasapi', 'asio', 'pipewire', 'alsa',
] as const)
export const NATIVE_AUDIO_DISCOVERY_ONLY_BACKENDS = Object.freeze(['jack'] as const)

export type NativeAudioStreamingBackend = (typeof NATIVE_AUDIO_STREAMING_BACKENDS)[number]
export type NativeAudioDiscoveryOnlyBackend = (typeof NATIVE_AUDIO_DISCOVERY_ONLY_BACKENDS)[number]
export type NativeAudioBackend = NativeAudioStreamingBackend | NativeAudioDiscoveryOnlyBackend
export type NativeAudioDirection = 'input' | 'output' | 'duplex'
export type NativeAudioMode = 'shared' | 'exclusive'

export interface NativeAudioOpenCandidate {
	readonly backend: NativeAudioBackend
	readonly deviceHandle: string
}

export interface NativeAudioExactFormat {
	readonly direction: NativeAudioDirection
	readonly mode: NativeAudioMode
	readonly sampleRate: number
	readonly periodFrames: number
	readonly channelCount: number
}

export interface NativeAudioOpenRequest extends NativeAudioExactFormat {
	readonly candidates: readonly Readonly<NativeAudioOpenCandidate>[]
}

export type NativeAudioOpenRefusalCode =
	| 'backend-absent'
	| 'server-absent'
	| 'device-unavailable'
	| 'format-refused'
	| 'mode-refused'
	| 'streaming-unavailable'
	| 'invalid-request'
	| 'open-failed'

export interface NativeAudioOpenAttempt {
	readonly backend: NativeAudioBackend
	readonly status: 'opened' | NativeAudioOpenRefusalCode
	readonly detail: string
}

export interface NativeAudioAdapterSession {
	readonly backend: NativeAudioStreamingBackend
	readonly format: NativeAudioExactFormat
	close(): Promise<void> | void
}

export type NativeAudioAdapterOpenOutcome =
	| Readonly<{ status: 'opened'; session: NativeAudioAdapterSession }>
	| Readonly<{ status: 'refused'; code: NativeAudioOpenRefusalCode; detail: string }>

export interface NativeAudioBackendAdapter {
	open(
		candidate: Readonly<NativeAudioOpenCandidate>,
		format: Readonly<NativeAudioExactFormat>,
		signal?: AbortSignal,
	): Promise<NativeAudioAdapterOpenOutcome>
}

export interface NativeRealtimeOwnerTarget {
	postMessage(channel: string, message: unknown, transfer: readonly unknown[]): void
}

export interface NativeRealtimeBrokerPort {
	authorize(request: Readonly<{
		owner: NativeRealtimeOwnerTarget
		sampleRate: number
		channelCount: number
		frameCount: number
		queueCapacity: number
	}>): Readonly<{
		status: 'authorized' | 'refused'
		generation?: number
		format?: Readonly<Record<string, unknown>>
		refusal?: string
		message?: string
	}>
	revokeOwner(owner: NativeRealtimeOwnerTarget): void
}

export interface NativeAudioRealtimeBinder {
	bind(request: Readonly<{
		session: NativeAudioAdapterSession
		generation: number
		format: Readonly<Record<string, unknown>>
	}>): Promise<void>
}

export interface DesktopNativeAudioSessionServiceOptions {
	readonly adapter: NativeAudioBackendAdapter
	readonly broker: NativeRealtimeBrokerPort
	readonly realtime: NativeAudioRealtimeBinder
	readonly mintId: () => string
	readonly resolveCalibration?: (identity: NativeAudioCalibrationIdentity) => number | null
	readonly persistCalibration?: (value: Readonly<{
		identity: NativeAudioCalibrationIdentity
		offsetFrames: number
	}>) => Promise<void>
	readonly persistRoute?: (request: Readonly<NativeAudioOpenRequest>) => Promise<void>
}

export interface NativeAudioCalibrationIdentity {
	readonly inputDeviceId: string
	readonly outputDeviceId: string
	readonly backend: NativeAudioStreamingBackend
	readonly mode: NativeAudioMode
	readonly sampleRate: number
	readonly bufferFrames: number
}

export type NativeAudioLossReason =
	| 'device-loss' | 'device-fault' | 'short-transfer' | 'output-overrun'
	| 'pool-violation' | 'peer-loss' | 'malformed-message'

export type NativeAudioOpenOutcome =
	| Readonly<{
		status: 'opened'
		sessionId: string
		backend: NativeAudioStreamingBackend
		deviceHandle: string
		format: NativeAudioExactFormat
		attempts: readonly NativeAudioOpenAttempt[]
	}>
	| Readonly<{
		status: 'refused'
		code: NativeAudioOpenRefusalCode
		message: string
		attempts: readonly NativeAudioOpenAttempt[]
	}>

export interface NativeAudioSessionProjection {
	readonly sessionId: string
	readonly state: 'open' | 'bound' | 'device-lost'
	readonly backend: NativeAudioStreamingBackend
	readonly format: NativeAudioExactFormat
	readonly attempts: readonly NativeAudioOpenAttempt[]
	readonly framesTransferred: number
	readonly lostFrames: number
	readonly calibrationFrames: number | null
	readonly calibrationAvailable: boolean
	readonly calibrationUnavailableReason: 'duplex-required' | 'bind-required' | 'device-lost' | null
	readonly transport: 'native' | 'web-core' | 'unavailable'
	readonly fallback: Readonly<{
		active: boolean
		eligible: boolean
		reason: NativeAudioLossReason
	}> | null
}

interface SessionEntry {
	readonly sessionId: string
	readonly owner: object
	readonly adapter: NativeAudioAdapterSession
	readonly backend: NativeAudioStreamingBackend
	readonly format: NativeAudioExactFormat
	readonly deviceHandle: string
	readonly attempts: readonly NativeAudioOpenAttempt[]
	state: 'open' | 'bound' | 'device-lost'
	framesTransferred: number
	lostFrames: number
	calibrationFrames: number | null
	transport: 'native' | 'web-core' | 'unavailable'
	fallback: NativeAudioSessionProjection['fallback']
	realtimeOwner: NativeRealtimeOwnerTarget | null
	adapterClose: Promise<void> | null
	binding: boolean
	closed: boolean
}

interface PendingOpen { readonly owner: object; readonly abort: AbortController; readonly settled: Promise<void> }

const FALLBACK_CODES = new Set<NativeAudioOpenRefusalCode>(['backend-absent', 'server-absent'])
const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$/u

/** Main-owned, pathless lifecycle for real native audio sessions. */
export class DesktopNativeAudioSessionService {
	readonly #adapter: NativeAudioBackendAdapter
	readonly #broker: NativeRealtimeBrokerPort
	readonly #realtime: NativeAudioRealtimeBinder
	readonly #mintId: () => string
	readonly #resolveCalibration: ((identity: NativeAudioCalibrationIdentity) => number | null) | null
	readonly #persistCalibration: DesktopNativeAudioSessionServiceOptions['persistCalibration'] | null
	readonly #persistRoute: DesktopNativeAudioSessionServiceOptions['persistRoute'] | null
	readonly #sessions = new Map<string, SessionEntry>()
	readonly #pendingOpens = new Set<PendingOpen>()
	readonly #ownerEpochs = new WeakMap<object, number>()
	#lifecycleEpoch = 0
	#disposed = false

	constructor(options: DesktopNativeAudioSessionServiceOptions) {
		this.#adapter = options.adapter
		this.#broker = options.broker
		this.#realtime = options.realtime
		this.#mintId = options.mintId
		this.#resolveCalibration = options.resolveCalibration ?? null
		this.#persistCalibration = options.persistCalibration ?? null
		this.#persistRoute = options.persistRoute ?? null
	}

	async open(owner: object, value: unknown): Promise<NativeAudioOpenOutcome> {
		if (this.#disposed) return refused('open-failed', 'Native audio sessions are shut down.', [])
		const lifecycleEpoch = this.#lifecycleEpoch
		const ownerEpoch = this.#ownerEpochs.get(owner) ?? 0
		const request = normalizeOpenRequest(value)
		const attempts: NativeAudioOpenAttempt[] = []
		for (const candidate of request.candidates) {
			if (candidate.backend === 'jack') {
				attempts.push(attempt(candidate.backend, 'streaming-unavailable',
					'JACK is available for discovery only; it cannot open a stream.'))
				return refused('streaming-unavailable', attempts.at(-1)!.detail, attempts)
			}
			let outcome: NativeAudioAdapterOpenOutcome
			try {
				outcome = await this.#openAdapter(owner, candidate, request)
			} catch {
				attempts.push(attempt(candidate.backend, 'open-failed', 'The audio backend failed while opening.'))
				return refused('open-failed', attempts.at(-1)!.detail, attempts)
			}
			if (!this.#openStillAdmitted(owner, ownerEpoch, lifecycleEpoch)) {
				if (outcome.status === 'opened') await Promise.resolve(outcome.session.close()).catch(() => undefined)
				return refused('open-failed', 'The native audio session was revoked while opening.', attempts)
			}
			if (outcome.status === 'refused') {
				attempts.push(attempt(candidate.backend, outcome.code, boundedDetail(outcome.detail)))
				if (FALLBACK_CODES.has(outcome.code)) continue
				return refused(outcome.code, attempts.at(-1)!.detail, attempts)
			}
			if (!sameFormat(request, outcome.session.format)
				|| outcome.session.backend !== candidate.backend) {
				await Promise.resolve(outcome.session.close()).catch(() => undefined)
				attempts.push(attempt(candidate.backend, 'format-refused',
					'The backend granted a different format or mode than requested.'))
				return refused('format-refused', attempts.at(-1)!.detail, attempts)
			}
			const sessionId = this.#freshSessionId()
			const format = snapshotFormat(request)
			attempts.push(attempt(candidate.backend, 'opened', 'The exact requested stream opened.'))
			const entry: SessionEntry = {
				sessionId,
				owner,
				adapter: outcome.session,
				backend: candidate.backend,
				format,
				deviceHandle: candidate.deviceHandle,
				attempts: Object.freeze([...attempts]),
				state: 'open',
				framesTransferred: 0,
				lostFrames: 0,
				calibrationFrames: null,
				transport: 'native',
				fallback: null,
				realtimeOwner: null,
				adapterClose: null,
				binding: false,
				closed: false,
			}
			try { await this.#persistRoute?.(request) }
			catch {
				await Promise.resolve(outcome.session.close()).catch(() => undefined)
				attempts.push(attempt(candidate.backend, 'open-failed',
					'The exact stream opened but its route preference could not be persisted.'))
				return refused('open-failed', attempts.at(-1)!.detail, attempts)
			}
			if (!this.#openStillAdmitted(owner, ownerEpoch, lifecycleEpoch)) {
				await Promise.resolve(outcome.session.close()).catch(() => undefined)
				return refused('open-failed', 'The native audio session was revoked while opening.', attempts)
			}
			entry.calibrationFrames = this.#restoredCalibration(entry)
			this.#sessions.set(sessionId, entry)
			return Object.freeze({
				status: 'opened' as const,
				sessionId,
				backend: candidate.backend,
				deviceHandle: candidate.deviceHandle,
				format,
				attempts: Object.freeze(attempts),
			})
		}
		return refused('backend-absent', 'No requested audio backend is present.', attempts)
	}

	async bind(owner: object, value: unknown): Promise<Readonly<{ status: 'bound'; generation: number }>> {
		const request = closedRecord(value, ['sessionId', 'owner', 'queueCapacity'], 'native audio bind request')
		const session = this.#ownedSession(owner, request.sessionId)
		if (session.state !== 'open' || session.binding) throw new Error('A native audio session can be bound only once.')
		if (!request.owner || typeof request.owner !== 'object') {
			throw new TypeError('A native audio bind requires its renderer port owner.')
		}
		const queueCapacity = boundedInteger(request.queueCapacity, 8, 8, 'real-time queue capacity')
		const target = request.owner as NativeRealtimeOwnerTarget
		session.binding = true
		try {
			const authorization = this.#broker.authorize({ owner: target,
				sampleRate: session.format.sampleRate, channelCount: session.format.channelCount,
				frameCount: session.format.periodFrames, queueCapacity })
			if (authorization.status !== 'authorized' || authorization.generation === undefined || !authorization.format) {
				throw new Error(authorization.message ?? 'The native real-time port was refused.')
			}
			session.realtimeOwner = target
			await this.#realtime.bind({ session: session.adapter,
				generation: authorization.generation, format: authorization.format })
			if (session.closed || session.state !== 'open') throw new Error('The native audio session ended while binding.')
			session.state = 'bound'
			return Object.freeze({ status: 'bound' as const, generation: authorization.generation })
		} catch (error) {
			if (session.realtimeOwner === target) { this.#broker.revokeOwner(target); session.realtimeOwner = null }
			throw error
		} finally { session.binding = false }
	}

	status(owner: object, sessionId: unknown): Readonly<NativeAudioSessionProjection> {
		return projectSession(this.#ownedSession(owner, sessionId))
	}

	async calibrate(
		owner: object,
		sessionId: unknown,
		calibrationFrames: unknown,
	): Promise<Readonly<NativeAudioSessionProjection>> {
		const session = this.#ownedSession(owner, sessionId)
		const reason = calibrationUnavailableReason(session)
		if (reason !== null) throw new Error(calibrationUnavailableMessage(reason))
		const frames = boundedInteger(calibrationFrames, 0, 1_048_576, 'calibration offset')
		if (!this.#persistCalibration) throw new Error('This native audio build cannot persist calibration.')
		await this.#persistCalibration(Object.freeze({
			identity: calibrationIdentity(session), offsetFrames: frames,
		}))
		session.calibrationFrames = frames
		return projectSession(session)
	}

	reportTransfer(owner: object, sessionId: unknown, frames: unknown, lostFrames: unknown): void {
		const session = this.#ownedSession(owner, sessionId)
		const transferred = session.framesTransferred
			+ boundedInteger(frames, 0, Number.MAX_SAFE_INTEGER, 'transferred frames')
		const lost = session.lostFrames
			+ boundedInteger(lostFrames, 0, Number.MAX_SAFE_INTEGER, 'lost frames')
		if (!Number.isSafeInteger(transferred) || !Number.isSafeInteger(lost)) {
			throw new RangeError('The native audio session counters overflowed.')
		}
		session.framesTransferred = transferred
		session.lostFrames = lost
	}

	async reportDeviceLost(owner: object, sessionId: unknown, reasonValue: unknown): Promise<Readonly<{
		continuity: 'commit-captured-prefix' | 'stop-monitoring'
		webCoreFallbackEligible: boolean
	}>> {
		const session = this.#ownedSession(owner, sessionId)
		const reason = enumValue(reasonValue, [
			'device-loss', 'device-fault', 'short-transfer', 'output-overrun',
			'pool-violation', 'peer-loss', 'malformed-message',
		] as const, 'audio device loss reason')
		if (session.state === 'device-lost') {
			if (session.adapterClose) await session.adapterClose
			return lossDisposition(session)
		}
		session.state = 'device-lost'
		if (session.realtimeOwner) {
			this.#broker.revokeOwner(session.realtimeOwner)
			session.realtimeOwner = null
		}
		const eligible = session.format.direction !== 'input'
		session.transport = eligible ? 'web-core' : 'unavailable'
		session.fallback = Object.freeze({ active: eligible, eligible, reason })
		await this.#closeAdapter(session)
		return lossDisposition(session)
	}

	async close(owner: object, sessionId: unknown): Promise<boolean> {
		const session = this.#ownedSession(owner, sessionId)
		await this.#closeSession(session)
		return true
	}

	async revokeOwner(owner: object): Promise<void> {
		this.#ownerEpochs.set(owner, (this.#ownerEpochs.get(owner) ?? 0) + 1)
		const closing = [...this.#sessions.values()].filter((entry) => entry.owner === owner)
		await Promise.all([this.#cancelPending((entry) => entry.owner === owner),
			...closing.map((entry) => this.#closeSession(entry))])
	}

	/** Close every live stream when the user turns the tier off without making re-enable terminal. */
	async closeAll(): Promise<void> {
		this.#lifecycleEpoch += 1
		await Promise.all([this.#cancelPending(() => true),
			...[...this.#sessions.values()].map((entry) => this.#closeSession(entry))])
	}

	async dispose(): Promise<void> {
		if (this.#disposed) return
		this.#disposed = true
		await this.closeAll()
	}

	#freshSessionId(): string {
		const value = this.#mintId()
		if (!SESSION_ID.test(value) || this.#sessions.has(value)) {
			throw new Error('The native audio session ID factory returned an invalid or repeated ID.')
		}
		return value
	}

	#openStillAdmitted(owner: object, ownerEpoch: number, lifecycleEpoch: number): boolean {
		return !this.#disposed && lifecycleEpoch === this.#lifecycleEpoch
			&& ownerEpoch === (this.#ownerEpochs.get(owner) ?? 0)
	}

	async #openAdapter(owner: object, candidate: Readonly<NativeAudioOpenCandidate>,
		format: Readonly<NativeAudioExactFormat>): Promise<NativeAudioAdapterOpenOutcome> {
		if (this.#sessions.size + this.#pendingOpens.size >= HELPER_SUPERVISOR_MAXIMUM_GATE_HOLDERS) {
			return Object.freeze({
				status: 'refused' as const,
				code: 'open-failed' as const,
				detail: 'Native audio session capacity is exhausted.',
			})
		}
		const abort = new AbortController()
		const opening = Promise.resolve().then(() => this.#adapter.open(candidate, format, abort.signal))
		const pending: PendingOpen = { owner, abort, settled: opening.then(() => undefined, () => undefined) }
		this.#pendingOpens.add(pending)
		try { return await opening } finally { this.#pendingOpens.delete(pending) }
	}

	async #cancelPending(predicate: (entry: PendingOpen) => boolean): Promise<void> {
		const pending = [...this.#pendingOpens].filter(predicate)
		for (const entry of pending) entry.abort.abort()
		await Promise.all(pending.map((entry) => entry.settled))
	}

	#ownedSession(owner: object, value: unknown): SessionEntry {
		const session = this.#session(value)
		if (session.owner !== owner) throw new Error('That native audio session belongs to another renderer.')
		return session
	}

	#session(value: unknown): SessionEntry {
		if (typeof value !== 'string' || !SESSION_ID.test(value)) throw new TypeError('A native audio session ID is required.')
		const session = this.#sessions.get(value)
		if (!session || session.closed) throw new Error('That native audio session is not open.')
		return session
	}

	async #closeSession(session: SessionEntry): Promise<void> {
		if (session.closed) return
		session.closed = true
		this.#sessions.delete(session.sessionId)
		if (session.realtimeOwner) {
			this.#broker.revokeOwner(session.realtimeOwner)
			session.realtimeOwner = null
		}
		await this.#closeAdapter(session)
	}

	#closeAdapter(session: SessionEntry): Promise<void> {
		session.adapterClose ??= Promise.resolve().then(() => session.adapter.close())
		return session.adapterClose
	}

	#restoredCalibration(session: SessionEntry): number | null {
		if (!this.#resolveCalibration || session.format.direction !== 'duplex') return null
		try {
			const value = this.#resolveCalibration(calibrationIdentity(session))
			return value === null ? null : boundedInteger(value, 0, 1_048_576, 'calibration offset')
		} catch { return null }
	}
}

function projectSession(session: SessionEntry): Readonly<NativeAudioSessionProjection> {
	const unavailable = calibrationUnavailableReason(session)
	return Object.freeze({
		sessionId: session.sessionId,
		state: session.state,
		backend: session.backend,
		format: session.format,
		attempts: session.attempts,
		framesTransferred: session.framesTransferred,
		lostFrames: session.lostFrames,
		calibrationFrames: session.calibrationFrames,
		calibrationAvailable: unavailable === null,
		calibrationUnavailableReason: unavailable,
		transport: session.transport,
		fallback: session.fallback,
	})
}

function calibrationUnavailableReason(
	session: SessionEntry,
): NativeAudioSessionProjection['calibrationUnavailableReason'] {
	if (session.format.direction !== 'duplex') return 'duplex-required'
	if (session.state === 'device-lost') return 'device-lost'
	if (session.state !== 'bound') return 'bind-required'
	return null
}

function calibrationUnavailableMessage(
	reason: NonNullable<NativeAudioSessionProjection['calibrationUnavailableReason']>,
): string {
	if (reason === 'duplex-required') return 'Calibration requires a duplex native audio session.'
	if (reason === 'bind-required') return 'Calibration requires a bound native audio session.'
	return 'A lost native audio device cannot be calibrated.'
}

function calibrationIdentity(session: SessionEntry): NativeAudioCalibrationIdentity {
	return Object.freeze({
		inputDeviceId: `native:${session.backend}:in:${session.deviceHandle}`,
		outputDeviceId: `native:${session.backend}:out:${session.deviceHandle}`,
		backend: session.backend,
		mode: session.format.mode,
		sampleRate: session.format.sampleRate,
		bufferFrames: session.format.periodFrames,
	})
}

function lossDisposition(session: SessionEntry): Readonly<{
	continuity: 'commit-captured-prefix' | 'stop-monitoring'
	webCoreFallbackEligible: boolean
}> {
	return Object.freeze(session.format.direction === 'input'
		? { continuity: 'commit-captured-prefix' as const, webCoreFallbackEligible: false }
		: { continuity: 'stop-monitoring' as const, webCoreFallbackEligible: true })
}
