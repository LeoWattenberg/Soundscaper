/* SPDX-License-Identifier: AGPL-3.0-only */

import { randomBytes } from 'node:crypto'
import { openNativePersistentPluginSession, type NativePluginHostSupervisor } from './native-plugin-helper-adapter.ts'
import type { NativeMainMessageChannel, NativeMainMessagePort } from './native-audio-helper-adapter.ts'
import type { HelperPluginHostJobGrant } from './helper-job-grant.ts'
import type { AraBackend } from './ara-session-service.ts'
import { admitAraPcm, type AraSource } from '../src/common/editor/ara-contract.ts'

/** The finite ARA port stays in main instead of being offered to an AudioWorklet. */
export async function openAraHelperSession(options: Readonly<{
	supervisor: NativePluginHostSupervisor
	grant: HelperPluginHostJobGrant
	source: AraSource
	createChannel(): NativeMainMessageChannel
	dispose(): void
	onFault?(error: Error): void
}>): Promise<AraBackend> {
	const session = await openNativePersistentPluginSession({ ...options,
		sampleRate: options.source.sampleRate, maximumFrames: 65_536 })
	let port: NativeMainMessagePort | null = null
	session.transferTo({ postMessage: (_channel, _message, transfer) => { port = transfer[0] ?? null } })
	if (!port) { await session.close(); options.dispose(); throw new Error('ARA helper port was unavailable.') }
	const rpcPort: NativeMainMessagePort = port
	let pending: Readonly<{ requestId: string; kind: string; resolve(value: Record<string, unknown>): void; reject(error: Error): void }> | null = null
	let closed = false
	let failure: Error | null = null
	let editorCapability: string | null = null
	const fail = (error: Error): void => {
		if (!failure && !closed) options.onFault?.(error)
		failure = error; pending?.reject(error); pending = null
	}
	const listener = (event: unknown): void => {
		const value = event && typeof event === 'object' && 'data' in event ? event.data : event
		if (!value || typeof value !== 'object' || !('kind' in value)) return fail(new Error('Malformed ARA helper response.'))
		const answer = value as Record<string, unknown>
		if (answer.protocolVersion !== 1 || answer.kind === 'fault') return fail(Object.assign(
			new Error(String(answer.detail ?? 'ARA helper failed.')), { code: answer.code ?? 'malformed-answer' }))
		if (!pending || answer.requestId !== pending.requestId) return fail(new Error('ARA helper response identity changed.'))
		if (answer.kind !== pending.kind) return fail(new Error('ARA helper operation response changed.'))
		pending.resolve(answer)
		pending = null
	}
	rpcPort.on?.('message', listener)
	if (!rpcPort.on) rpcPort.onmessage = listener
	void session.closed.then(() => fail(new Error('ARA helper closed.')), (error: unknown) =>
		fail(error instanceof Error ? error : new Error(String(error))))
	const request = (kind: string, payload: Record<string, unknown> = {}): Promise<Record<string, unknown>> => {
		if (closed || failure) return Promise.reject(failure ?? new Error('ARA session is closed.'))
		if (pending) return Promise.reject(new Error('ARA helper already has a pending operation.'))
		return new Promise((resolve, reject) => {
			const requestId = randomBytes(16).toString('hex')
			const timer = setTimeout(() => {
				fail(Object.assign(new Error('ARA helper operation timed out.'), { code: 'hang' }))
				void close()
			}, 30_000)
			pending = { requestId, kind: kind.endsWith('vendor-ui') ? 'vendor-ui' : kind,
				resolve: (answer) => { clearTimeout(timer); resolve(answer) },
				reject: (error) => { clearTimeout(timer); reject(error) } }
			try { rpcPort.postMessage({ protocolVersion: 1, kind, requestId, ...payload }) }
			catch (error) { fail(error instanceof Error ? error : new Error(String(error))) }
		})
	}
	const close = async (): Promise<void> => {
		if (closed) return
		closed = true
		fail(new Error('ARA session is closed.'))
		rpcPort.off?.('message', listener)
		if (!rpcPort.off) rpcPort.onmessage = null
		rpcPort.close()
		options.dispose()
		await session.close()
	}
	const closeEditor = async (): Promise<void> => {
		if (editorCapability === null) return
		const answer = await request('close-vendor-ui', { windowHandleId: editorCapability })
		if (answer.kind !== 'vendor-ui' || answer.status !== 'closed') throw new Error('ARA editor could not close.')
		editorCapability = null
	}
	return Object.freeze({
		configure: async (source: AraSource) => {
			if ((await request('ara-capabilities')).supported !== true) return false
			await request('ara-configure', { source })
			return true
		},
		write: async (chunk) => { await request('ara-write', { ...chunk }) },
		bind: async () => { await request('ara-bind') },
		openEditor: async () => {
			if (editorCapability !== null) return
			const capability = session.vendorWindowCapability(randomBytes(20).toString('hex'))
			const answer = await request('open-vendor-ui', { windowHandleId: capability })
			if (answer.kind !== 'vendor-ui' || answer.status !== 'opened') throw new Error('This ARA plug-in has no available editor.')
			editorCapability = capability
		},
		render: async (render) => {
			await closeEditor()
			const deadline = Date.now() + 120_000
			let answer = await request('ara-render', { startFrame: render.startFrame, frameCount: render.frameCount })
			while (answer.analysisPending === true) {
				if (Date.now() >= deadline) throw new Error('The ARA plug-in has not finished analyzing the audio. Try a shorter clip.')
				await new Promise<void>((resolve) => { setTimeout(resolve, 100) })
				answer = await request('ara-render', { startFrame: render.startFrame, frameCount: render.frameCount })
			}
			if (answer.kind !== 'ara-render' || answer.startFrame !== render.startFrame) throw new Error('ARA render response is invalid.')
			const channels = admitAraPcm({ startFrame: answer.startFrame, channels: answer.channels }, options.source).channels
			if (channels[0]?.length !== render.frameCount) throw new Error('ARA render frame count is invalid.')
			return channels
		},
		close,
	} satisfies AraBackend)
}
