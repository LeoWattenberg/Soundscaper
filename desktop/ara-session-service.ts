/* SPDX-License-Identifier: AGPL-3.0-only */

import { randomBytes } from 'node:crypto'
import {
	admitAraPcm, admitAraSource, araId, araInteger, araRecord, ARA_CHUNK_FRAMES,
	type AraPcmChunk, type AraSource,
} from '../src/common/editor/ara-contract.ts'

export interface AraBackend {
	configure(source: AraSource): Promise<boolean>
	write(chunk: AraPcmChunk): Promise<void>
	bind(): Promise<void>
	openEditor(): Promise<void>
	render(request: Readonly<{ startFrame: number; frameCount: number; channelCount: number }>): Promise<readonly Float32Array[]>
	close(): Promise<void>
}

interface Session {
	readonly owner: object
	readonly installationId: string
	readonly source: AraSource
	readonly backend: AraBackend
	nextFrame: number
	bound: boolean
	tail: Promise<unknown>
	closed: boolean
}

interface AraSessionOptions {
	isEnabled(): boolean
	isAdmitted?(installationId: string): boolean
	open(installationId: string, source: AraSource): Promise<AraBackend>
	mintId?: () => string
}

/** One finite source per session; admission and every call remain owner-scoped. */
export class DesktopAraSessions {
	readonly #options: Readonly<AraSessionOptions>
	readonly #sessions = new Map<string, Session>()
	readonly #revoked = new WeakSet<object>()
	#starting = 0
	#disposed = false
	#epoch = 0

	constructor(options: AraSessionOptions) { this.#options = options }

	async start(owner: object, value: unknown): Promise<Readonly<{ sessionId: string }>> {
		const record = araRecord(value, ['installationId', 'source'])
		const installationId = araId(record.installationId)
		const source = admitAraSource(record.source)
		this.#assertEnabled(owner)
		if (this.#sessions.size + this.#starting >= 4) throw new Error('ARA session capacity is exhausted.')
		this.#starting += 1
		const epoch = this.#epoch
		let backend: AraBackend | null = null
		try {
			backend = await this.#options.open(installationId, source)
			if (epoch !== this.#epoch) throw new Error('ARA admission was revoked during acquisition.')
			this.#assertEnabled(owner)
			if (!await backend.configure(source)) throw new Error('This VST3 plug-in does not support ARA 2.')
			if (epoch !== this.#epoch || this.#options.isAdmitted?.(installationId) === false) throw new Error('ARA installation admission was revoked.')
			this.#assertEnabled(owner)
			const sessionId = araId((this.#options.mintId ?? (() => randomBytes(20).toString('hex')))())
			if (this.#sessions.has(sessionId)) throw new Error('ARA session identity collision.')
			this.#sessions.set(sessionId, { owner, installationId, source, backend, nextFrame: 0, bound: false,
				tail: Promise.resolve(), closed: false })
			return Object.freeze({ sessionId })
		} catch (error) {
			await backend?.close()
			throw error
		} finally { this.#starting -= 1 }
	}

	write(owner: object, value: unknown): Promise<boolean> {
		const record = araRecord(value, ['sessionId', 'startFrame', 'channels'])
		return this.#run(owner, record.sessionId, async (session) => {
			if (session.bound) throw new Error('ARA source is already bound.')
			const chunk = admitAraPcm({ startFrame: record.startFrame, channels: record.channels }, session.source)
			if (chunk.startFrame !== session.nextFrame) throw new Error('ARA PCM must be contiguous.')
			await session.backend.write(chunk)
			session.nextFrame += chunk.channels[0]!.length
			return true
		})
	}

	bind(owner: object, value: unknown): Promise<boolean> {
		const record = araRecord(value, ['sessionId'])
		return this.#run(owner, record.sessionId, async (session) => {
			if (session.bound || session.nextFrame !== session.source.frameCount) {
				throw new Error('ARA cannot bind an incomplete or already bound source.')
			}
			await session.backend.bind()
			session.bound = true
			return true
		})
	}

	openEditor(owner: object, value: unknown): Promise<boolean> {
		const record = araRecord(value, ['sessionId'])
		return this.#run(owner, record.sessionId, async (session) => {
			if (!session.bound) throw new Error('ARA source is not bound.')
			await session.backend.openEditor()
			return true
		})
	}

	render(owner: object, value: unknown): Promise<AraPcmChunk> {
		const record = araRecord(value, ['sessionId', 'startFrame', 'frameCount'])
		return this.#run(owner, record.sessionId, async (session) => {
			if (!session.bound) throw new Error('ARA source is not bound.')
			const startFrame = araInteger(record.startFrame, 0, session.source.frameCount - 1)
			const frameCount = araInteger(record.frameCount, 1, Math.min(ARA_CHUNK_FRAMES, session.source.frameCount - startFrame))
			const channels = await session.backend.render({ startFrame, frameCount, channelCount: session.source.channelCount })
			const result = admitAraPcm({ startFrame, channels }, session.source)
			if (result.channels[0]!.length !== frameCount) throw new Error('ARA returned the wrong rendered frame count.')
			return result
		})
	}

	async close(owner: object, value: unknown): Promise<boolean> {
		const record = araRecord(value, ['sessionId'])
		const sessionId = araId(record.sessionId)
		const session = this.#sessions.get(sessionId)
		if (!session) return false
		if (session.owner !== owner) throw new Error('ARA session belongs to another owner.')
		this.#sessions.delete(sessionId)
		session.closed = true
		await session.backend.close()
		return true
	}

	async revokeOwner(owner: object): Promise<void> {
		this.#revoked.add(owner)
		await Promise.all([...this.#sessions].filter(([, session]) => session.owner === owner)
			.map(([sessionId]) => this.close(owner, { sessionId })))
	}

	async disable(): Promise<void> {
		this.#epoch += 1
		await Promise.all([...this.#sessions].map(([sessionId, session]) => this.close(session.owner, { sessionId })))
	}

	async withdrawInstallation(installationId: string): Promise<void> {
		this.#epoch += 1
		await Promise.all([...this.#sessions].filter(([, session]) => session.installationId === installationId)
			.map(([sessionId, session]) => this.close(session.owner, { sessionId })))
	}

	async dispose(): Promise<void> { this.#disposed = true; await this.disable() }

	#assertEnabled(owner: object): void {
		if (this.#revoked.has(owner)) throw new Error('ARA owner has been revoked.')
		if (this.#disposed || !this.#options.isEnabled()) throw new Error('ARA plug-in discovery is disabled.')
	}

	async #run<T>(owner: object, id: unknown, operation: (session: Session) => Promise<T>): Promise<T> {
		this.#assertEnabled(owner)
		const session = this.#sessions.get(araId(id))
		if (!session || session.owner !== owner) throw new Error('ARA session belongs to another owner or is closed.')
		const result = session.tail.then(async () => {
			this.#assertEnabled(owner)
			if (this.#options.isAdmitted?.(session.installationId) === false) throw new Error('ARA installation admission was revoked.')
			if (session.closed) throw new Error('ARA session is closed.')
			const answer = await operation(session)
			this.#assertEnabled(owner)
			if (this.#options.isAdmitted?.(session.installationId) === false) throw new Error('ARA installation admission was revoked.')
			if (session.closed) throw new Error('ARA session closed before the operation completed.')
			return answer
		})
		session.tail = result.catch(() => undefined)
		return result
	}
}
