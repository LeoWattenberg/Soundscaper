/* SPDX-License-Identifier: AGPL-3.0-only */

import { admitAraPcm, admitAraSource, ARA_CHUNK_FRAMES, type AraBridge } from '../../ara-contract.ts'
import type { AraClipEditingRuntime, AraPreparedClipEdit } from '../../ara-clip-editing-runtime.ts'

export interface AraEditSnapshot {
	readonly phase: 'idle' | 'opening' | 'editing' | 'rendering' | 'applied' | 'error' | 'closed'
	readonly message: string
	readonly progress: number
}

/** Menu-owned clip operation; every asynchronous boundary rechecks publication authority. */
export function createAraEditSession(options: Readonly<{ bridge: AraBridge; clipEditing: AraClipEditingRuntime }>) {
	let snapshot: AraEditSnapshot = Object.freeze({ phase: 'idle', message: '', progress: 0 })
	const listeners = new Set<() => void>()
	let prepared: AraPreparedClipEdit | null = null
	let sessionId: string | null = null
	let generation = 0
	let disposed = false
	let abort: AbortController | null = null
	const publish = (phase: AraEditSnapshot['phase'], message = '', progress = 0): void => {
		snapshot = Object.freeze({ phase, message, progress })
		for (const listener of listeners) listener()
	}
	const release = async (): Promise<void> => {
		const id = sessionId
		const clip = prepared
		sessionId = null
		prepared = null
		abort?.abort()
		abort = null
		try { if (id !== null) await options.bridge.close({ sessionId: id }) }
		finally { clip?.cancel() }
	}
	const current = (token: number): void => {
		if (disposed || token !== generation) throw new Error('ARA clip editing was cancelled.')
		prepared?.assertCurrent()
	}
	const failure = async (error: unknown, token: number): Promise<void> => {
		if (disposed || token !== generation) return
		generation += 1
		try { await release() } catch { /* preserve the operation failure */ }
		publish('error', error instanceof Error ? error.message : String(error))
	}
	return Object.freeze({
		getSnapshot: () => snapshot,
		subscribe(listener: () => void): () => void { listeners.add(listener); return () => { listeners.delete(listener) } },
		async open(installationId: string): Promise<void> {
			if (disposed || !['idle', 'error'].includes(snapshot.phase)) return
			const token = ++generation
			abort = new AbortController()
			publish('opening')
			try {
				const clip = await options.clipEditing.prepare({ signal: abort.signal })
				if (disposed || token !== generation) { clip.cancel(); return }
				prepared = clip
				const source = admitAraSource({ sourceId: clip.sourceId, name: clip.name, sampleRate: clip.sampleRate,
					channelCount: clip.channelCount, frameCount: clip.frameCount, sourceStartSeconds: clip.sourceStartSeconds,
					playbackStartSeconds: clip.playbackStartSeconds, durationSeconds: clip.durationSeconds })
				current(token)
				const created = await options.bridge.start({ installationId, source })
				if (disposed || token !== generation) { await options.bridge.close(created); return }
				sessionId = created.sessionId
				for (let startFrame = 0; startFrame < source.frameCount; startFrame += ARA_CHUNK_FRAMES) {
					current(token)
					const end = Math.min(source.frameCount, startFrame + ARA_CHUNK_FRAMES)
					const channels = clip.channels.map((channel) => channel.slice(startFrame, end))
					await options.bridge.write({ sessionId, ...admitAraPcm({ startFrame, channels }, source) })
					current(token)
					publish('opening', '', end / source.frameCount)
				}
				await options.bridge.bind({ sessionId })
				current(token)
				publish('editing')
			} catch (error) { await failure(error, token) }
		},
		async openEditor(): Promise<void> {
			if (snapshot.phase !== 'editing' || sessionId === null) return
			const token = generation
			try {
				current(token)
				await options.bridge.openEditor({ sessionId })
				current(token)
			} catch (error) { await failure(error, token) }
		},
		async apply(): Promise<void> {
			if (snapshot.phase !== 'editing' || sessionId === null || prepared === null) return
			const token = generation
			const clip = prepared
			const id = sessionId
			publish('rendering')
			try {
				current(token)
				const channels = Array.from({ length: clip.channelCount }, () => new Float32Array(clip.frameCount))
				for (let startFrame = 0; startFrame < clip.frameCount; startFrame += ARA_CHUNK_FRAMES) {
					current(token)
					const frameCount = Math.min(ARA_CHUNK_FRAMES, clip.frameCount - startFrame)
					const chunk = admitAraPcm(await options.bridge.render({ sessionId: id, startFrame, frameCount }), clip)
					current(token)
					if (chunk.startFrame !== startFrame || chunk.channels[0]!.length !== frameCount) {
						throw new Error('ARA returned unexpected rendered geometry.')
					}
					chunk.channels.forEach((channel, index) => channels[index]!.set(channel, startFrame))
					publish('rendering', '', (startFrame + frameCount) / clip.frameCount)
				}
				current(token)
				await clip.apply({ channels, sampleRate: clip.sampleRate, name: `${clip.name} (ARA)` })
				await release()
				if (!disposed && token === generation) publish('applied')
			} catch (error) { await failure(error, token) }
		},
		async reconcile(): Promise<void> {
			if (prepared === null || disposed || snapshot.phase === 'rendering') return
			try { current(generation) } catch (error) { await failure(error, generation) }
		},
		async dispose(): Promise<void> {
			if (disposed) return
			disposed = true
			generation += 1
			try { await release() } finally { publish('closed'); listeners.clear() }
		},
	})
}
