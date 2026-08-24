/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

import type { HelperPluginHostJobGrant } from './helper-job-grant.ts'
import type { HelperJobRequest } from './helper-supervisor.ts'
import type { NativePluginOfflineRunner } from './plugin-host-service.ts'
import type { NativeMainMessageChannel, NativeMainMessagePort } from './native-audio-helper-adapter.ts'

const MAXIMUM_MESSAGE_BYTES = 16 * 1_024 * 1_024

export interface NativePluginHostSupervisor {
	runJob(request: HelperJobRequest<'plugin-host'>): Promise<unknown>
}

export interface NativePluginRpcOwner {
	postMessage(channel: string, message: unknown, transfer: readonly NativeMainMessagePort[]): void
}

export interface NativePluginPersistentSession {
	readonly format: string
	readonly reportedLatencyFrames: number
	readonly closed: Promise<unknown>
	transferTo(owner: NativePluginRpcOwner, options?: string | Readonly<{
		channel?: string
		instanceId?: string
	}>): void
	authenticateState(value: unknown): Uint8Array
	vendorWindowCapability(windowHandleId: string): string
	close(): Promise<void>
}

/** Production adapter for the supervised one-shot offline DSP job. */
export function createNativePluginOfflineRunner(
	supervisorFor: (request: Readonly<{ grant: HelperPluginHostJobGrant; instanceId: string }>) => NativePluginHostSupervisor,
): NativePluginOfflineRunner {
	return Object.freeze({
		run: async (request: Parameters<NativePluginOfflineRunner['run']>[0]) => normalizeOfflineResult(await supervisorFor(request).runJob({
			kind: 'plugin-host',
			grant: request.grant,
		})),
	})
}

export async function openNativePersistentPluginSession(options: Readonly<{
	supervisor: NativePluginHostSupervisor
	grant: HelperPluginHostJobGrant
	createChannel: () => NativeMainMessageChannel
	sampleRate: number
	maximumFrames: number
	mintStreamId?: () => string
	configureTimeoutMs?: number
}>): Promise<NativePluginPersistentSession> {
	const streamId = (options.mintStreamId ?? (() => randomBytes(20).toString('hex')))()
	if (!/^[a-f\d]{40}$/u.test(streamId)) throw new Error('The plug-in stream ID factory returned an invalid ID.')
	const channel = options.createChannel()
	const stateAuthenticationKey = randomBytes(32)
	const abort = new AbortController()
	const completion = options.supervisor.runJob({
		kind: 'plugin-host',
		grant: {
			...options.grant,
			persistentPort: {
				portContractVersion: 1,
				transport: 'message-port',
				purpose: 'plugin-rpc',
				streamId,
				generation: 1,
				maximumMessageBytes: MAXIMUM_MESSAGE_BYTES,
				maximumInFlightMessages: 8,
			},
		},
		signal: abort.signal,
		dataPlaneTransfers: [{ streamId, port: channel.port1 }],
	})
	const configured = waitForConfiguration(channel.port2, completion, options.configureTimeoutMs ?? 10_000)
	channel.port2.start?.()
	channel.port2.postMessage({
		protocolVersion: 1,
		kind: 'configure',
		sampleRate: integer(options.sampleRate, 8_000, 768_000, 'sample rate'),
		maximumFrames: integer(options.maximumFrames, 1, 65_536, 'block ceiling'),
		stateAuthenticationKey: stateAuthenticationKey.toString('hex'),
	})
	let answer
	try {
		answer = await configured
	} catch (error) {
		abort.abort()
		close(channel.port2)
		throw error
	}
	let transferred = false
	let closed = false
	const usedProofs = new Set<string>()
	return Object.freeze({
		format: answer.format,
		reportedLatencyFrames: answer.reportedLatencyFrames,
		closed: completion,
		transferTo: (owner: NativePluginRpcOwner, transferOptions = {}) => {
			if (closed || transferred) throw new Error('The plug-in RPC port is no longer available for hand-off.')
			const normalized: Readonly<{ channel?: string; instanceId?: string }> =
				typeof transferOptions === 'string' ? { channel: transferOptions } : transferOptions
			const destination = normalized.channel ?? 'soundscaper:native-plugin-rpc-port'
			owner.postMessage(destination, Object.freeze({
				portContractVersion: 1,
				transport: 'message-port',
				purpose: 'plugin-rpc',
				streamId,
				generation: 1,
				maximumMessageBytes: MAXIMUM_MESSAGE_BYTES,
				maximumInFlightMessages: 8,
				format: answer.format,
				instanceId: normalized.instanceId ?? null,
				reportedLatencyFrames: answer.reportedLatencyFrames,
			}), [channel.port2])
			transferred = true
		},
		authenticateState: (value: unknown) => {
			const record = plainRecord(value, 'native plug-in state proof')
			const bytes = ordinaryBytes(record.bytes)
			const proof = plainRecord(record.authentication, 'native plug-in state authentication')
			const requestId = boundedText(proof.requestId)
			const sha256 = digest(proof.sha256)
			const byteLength = integer(proof.byteLength, 0, MAXIMUM_MESSAGE_BYTES, 'state byte length')
			const mac = digest(proof.mac)
			if (byteLength !== bytes.byteLength
				|| createHash('sha256').update(bytes).digest('hex') !== sha256 || usedProofs.has(requestId)) {
				throw new Error('The native plug-in state proof does not match fresh helper bytes.')
			}
			const expected = createHmac('sha256', stateAuthenticationKey)
				.update(`${streamId}\0${options.grant.binarySha256}\0${requestId}\0${String(byteLength)}\0${sha256}`)
				.digest()
			if (!timingSafeEqual(expected, Buffer.from(mac, 'hex'))) {
				throw new Error('The native plug-in state authentication failed.')
			}
			usedProofs.add(requestId)
			return Uint8Array.from(bytes)
		},
		vendorWindowCapability: (windowHandleId: string) => {
			if (closed) throw new Error('The plug-in RPC session is closed.')
			const rawId = opaqueWindowId(windowHandleId)
			const mac = createHmac('sha256', stateAuthenticationKey)
				.update(`${streamId}\0${options.grant.binarySha256}\0vendor-window\0${rawId}`)
				.digest('hex')
			return `${rawId}.${mac}`
		},
		close: async () => {
			if (closed) return
			closed = true
			abort.abort()
			if (!transferred) close(channel.port2)
			await completion.catch(() => undefined)
		},
	})
}

function ordinaryBytes(value: unknown): Uint8Array {
	if (!(value instanceof Uint8Array) || value.byteLength > MAXIMUM_MESSAGE_BYTES
		|| (typeof SharedArrayBuffer !== 'undefined' && value.buffer instanceof SharedArrayBuffer)) {
		throw new TypeError('Native plug-in state must be bounded ordinary bytes.')
	}
	return value
}

function normalizeOfflineResult(value: unknown): Awaited<ReturnType<NativePluginOfflineRunner['run']>> {
	const record = plainRecord(value, 'native plug-in offline result')
	return Object.freeze({
		reportedLatencyFrames: integer(record.reportedLatencyFrames, 0, 1_048_576, 'reported latency'),
		latencyStable: boolean(record.latencyStable, 'latency stability'),
		blocksRendered: integer(record.blocksRendered, 0, 1_000_000, 'rendered block count'),
		renderedSha256: digest(record.renderedSha256),
		stateBytes: record.stateBytes === null ? null : integer(record.stateBytes, 0, MAXIMUM_MESSAGE_BYTES, 'state bytes'),
		stateRefusal: record.stateRefusal === null ? null : boundedText(record.stateRefusal),
	})
}

function waitForConfiguration(
	port: NativeMainMessagePort,
	completion: Promise<unknown>,
	timeoutMs: number,
): Promise<Readonly<{ format: string; reportedLatencyFrames: number }>> {
	return new Promise((resolve, reject) => {
		let settled = false
		const settle = (action: () => void) => {
			if (settled) return
			settled = true
			clearTimeout(timer)
			remove(port, listener)
			action()
		}
		const timer = setTimeout(() => settle(() => reject(new Error('The plug-in helper did not configure in time.'))), timeoutMs)
		const listener = (event: unknown) => {
			const record = plainRecord(messageData(event), 'plug-in configuration response')
			if (record.kind === 'fault') return settle(() => reject(new Error(boundedText(record.detail ?? record.code))))
			if (record.kind !== 'configured') return
			if (record.protocolVersion !== 1 || record.status !== 'opened') {
				return settle(() => reject(new Error('The plug-in helper returned a malformed configuration.')))
			}
			settle(() => resolve(Object.freeze({
				format: boundedText(record.format),
				reportedLatencyFrames: integer(record.reportedLatencyFrames, 0, 1_048_576, 'reported latency'),
			})))
		}
		add(port, listener)
		void completion.catch((error) => settle(() => reject(error)))
	})
}

function add(port: NativeMainMessagePort, listener: (event: unknown) => void): void {
	if (port.on) port.on('message', listener)
	else port.onmessage = (event) => listener(event)
}

function remove(port: NativeMainMessagePort, listener: (event: unknown) => void): void {
	if (port.off) port.off('message', listener)
	else port.onmessage = null
}

function messageData(value: unknown): unknown {
	return value && typeof value === 'object' && 'data' in value ? (value as { data: unknown }).data : value
}

function plainRecord(value: unknown, label: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be a record.`)
	return value as Record<string, unknown>
}

function integer(value: unknown, minimum: number, maximum: number, label: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
		throw new RangeError(`The native plug-in ${label} is outside its bounds.`)
	}
	return Number(value)
}

function boolean(value: unknown, label: string): boolean {
	if (typeof value !== 'boolean') throw new TypeError(`The native plug-in ${label} must be boolean.`)
	return value
}

function digest(value: unknown): string {
	if (typeof value !== 'string' || !/^[a-f\d]{64}$/u.test(value)) throw new TypeError('A plug-in digest is invalid.')
	return value
}

function boundedText(value: unknown): string {
	return String(value ?? '').slice(0, 2_048)
}

function opaqueWindowId(value: unknown): string {
	if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,62}$/u.test(value)) {
		throw new TypeError('A bounded main-owned vendor-window ID is required.')
	}
	return value
}

function close(port: NativeMainMessagePort): void {
	try { port.close() } catch { /* already transferred or closed */ }
}
