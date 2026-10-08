/* SPDX-License-Identifier: AGPL-3.0-only */

/** Pathless, bounded ARA clip transport shared by the desktop and renderer. */
export const ARA_CHUNK_FRAMES = 65_536
export const ARA_SOURCE_MAXIMUM_BYTES = 512 * 1_024 * 1_024
export const ARA_CHANNELS = Object.freeze({
	start: 'scape:v1:ara:start', write: 'scape:v1:ara:write', bind: 'scape:v1:ara:bind',
	editor: 'scape:v1:ara:editor', render: 'scape:v1:ara:render', close: 'scape:v1:ara:close',
})

export interface AraSource {
	readonly sourceId: string
	readonly name: string
	readonly sampleRate: number
	readonly channelCount: number
	readonly frameCount: number
	readonly sourceStartSeconds: number
	readonly playbackStartSeconds: number
	readonly durationSeconds: number
}

export interface AraPcmChunk {
	readonly startFrame: number
	readonly channels: readonly Float32Array[]
}

export interface AraBridge {
	start(request: Readonly<{ installationId: string; source: AraSource }>): Promise<Readonly<{ sessionId: string }>>
	write(request: AraPcmChunk & Readonly<{ sessionId: string }>): Promise<boolean>
	bind(request: Readonly<{ sessionId: string }>): Promise<boolean>
	openEditor(request: Readonly<{ sessionId: string }>): Promise<boolean>
	render(request: Readonly<{ sessionId: string; startFrame: number; frameCount: number }>): Promise<AraPcmChunk>
	close(request: Readonly<{ sessionId: string }>): Promise<boolean>
}

export function araRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) {
		throw new TypeError('ARA requires a plain record.')
	}
	const actual = Reflect.ownKeys(value)
	if (actual.length !== keys.length || actual.some((key) => typeof key !== 'string' || !keys.includes(key))) {
		throw new TypeError('ARA record fields are invalid.')
	}
	for (const key of keys) {
		const descriptor = Object.getOwnPropertyDescriptor(value, key)
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError('ARA record properties must be data properties.')
		}
	}
	return value as Record<string, unknown>
}

export function araInteger(value: unknown, minimum: number, maximum: number): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
		throw new RangeError('ARA integer is outside its range.')
	}
	return value
}

export function araId(value: unknown): string {
	if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u.test(value)) {
		throw new TypeError('ARA identifier is invalid.')
	}
	return value
}

export function admitAraSource(value: unknown): Readonly<AraSource> {
	const record = araRecord(value, ['sourceId', 'name', 'sampleRate', 'channelCount', 'frameCount',
		'sourceStartSeconds', 'playbackStartSeconds', 'durationSeconds'])
	const sourceId = araId(record.sourceId)
	if (typeof record.name !== 'string' || record.name.length === 0 || new TextEncoder().encode(record.name).length > 511
		|| record.name.includes('\0')) throw new TypeError('ARA source name is invalid.')
	const sampleRate = araInteger(record.sampleRate, 8_000, 768_000)
	const channelCount = araInteger(record.channelCount, 1, 2)
	const frameCount = araInteger(record.frameCount, 1, 0xffffffff)
	if (frameCount * channelCount * 4 > ARA_SOURCE_MAXIMUM_BYTES) {
		throw new RangeError('ARA source exceeds its memory limit.')
	}
	const seconds = (value: unknown): number => {
		if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 24 * 60 * 60) {
			throw new RangeError('ARA time is outside its range.')
		}
		return value
	}
	const sourceStartSeconds = seconds(record.sourceStartSeconds)
	const playbackStartSeconds = seconds(record.playbackStartSeconds)
	const durationSeconds = seconds(record.durationSeconds)
	if (Math.abs(durationSeconds * sampleRate - frameCount) > 0.0001 || sourceStartSeconds !== 0) {
		throw new RangeError('ARA duration must describe the complete prepared clip.')
	}
	return Object.freeze({ sourceId, name: record.name, sampleRate, channelCount, frameCount,
		sourceStartSeconds, playbackStartSeconds, durationSeconds })
}

export function admitAraPcm(value: unknown, source?: Pick<AraSource, 'channelCount' | 'frameCount'>): AraPcmChunk {
	const record = araRecord(value, ['startFrame', 'channels'])
	const startFrame = araInteger(record.startFrame, 0, 0xffffffff)
	if (!Array.isArray(record.channels) || record.channels.length < 1 || record.channels.length > 2
		|| source && record.channels.length !== source.channelCount) {
		throw new RangeError('ARA PCM channels are invalid.')
	}
	let frames = 0
	const buffers = new Set<ArrayBufferLike>()
	const channels: Float32Array[] = []
	for (const value of record.channels as unknown[]) {
		if (!(value instanceof Float32Array) || !(value.buffer instanceof ArrayBuffer)
			|| buffers.has(value.buffer)) throw new TypeError('ARA PCM requires distinct ordinary planes.')
		araInteger(value.length, 1, ARA_CHUNK_FRAMES)
		if (frames !== 0 && frames !== value.length) throw new RangeError('ARA PCM channels have different lengths.')
		frames = value.length
		buffers.add(value.buffer)
		for (const sample of value) if (!Number.isFinite(sample)) throw new TypeError('ARA PCM must be finite.')
		channels.push(value)
	}
	if (startFrame + frames > (source?.frameCount ?? 0xffffffff)) throw new RangeError('ARA PCM exceeds its range.')
	return Object.freeze({ startFrame, channels: Object.freeze(channels) })
}
