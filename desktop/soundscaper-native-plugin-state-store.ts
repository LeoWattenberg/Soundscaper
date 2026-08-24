/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'

export const SOUNDSCAPER_NATIVE_PLUGIN_STATE_BODY_MAXIMUM_BYTES = 16 * 1024 * 1024

export interface SoundscaperNativePluginStateBodyDescriptor {
	readonly kind: 'native-plugin-state'
	readonly bodyId: string
	readonly byteLength: number
	readonly sha256: string
}

export interface SoundscaperNativePluginStateBodyRecord extends
	SoundscaperNativePluginStateBodyDescriptor {
	readonly bytes: Uint8Array
}

/** Content-addressed opaque-state custody owned by desktop library V11. */
export class SoundscaperNativePluginStateStore {
	readonly #database: DatabaseSync

	constructor(database: DatabaseSync) {
		this.#database = database
	}

	put(value: unknown, now: number = Date.now()): Readonly<SoundscaperNativePluginStateBodyDescriptor> {
		const bytes = ordinaryBytes(value)
		const sha256 = createHash('sha256').update(bytes).digest('hex')
		const descriptor = descriptorFor(sha256, bytes.byteLength)
		this.#database.prepare(`
			INSERT OR IGNORE INTO native_plugin_state_bodies
			(body_id, sha256, byte_length, bytes, created_at_ms)
			VALUES (?, ?, ?, ?, ?)
		`).run(descriptor.bodyId, sha256, bytes.byteLength, bytes, timestamp(now))
		const row = this.#database.prepare(`
			SELECT sha256, byte_length FROM native_plugin_state_bodies WHERE body_id = ?
		`).get(descriptor.bodyId)
		if (row?.sha256 !== sha256 || row.byte_length !== bytes.byteLength) {
			throw new Error('The native plug-in state body collides with different persisted bytes.')
		}
		return descriptor
	}

	has(bodyId: unknown): boolean {
		const id = stateBodyId(bodyId)
		return this.#database.prepare(
			'SELECT 1 AS present FROM native_plugin_state_bodies WHERE body_id = ?',
		).get(id)?.present === 1
	}

	read(bodyId: unknown): Readonly<SoundscaperNativePluginStateBodyRecord> | null {
		const id = stateBodyId(bodyId)
		const row = this.#database.prepare(`
			SELECT sha256, byte_length, bytes FROM native_plugin_state_bodies WHERE body_id = ?
		`).get(id)
		if (!row) return null
		if (typeof row.sha256 !== 'string' || typeof row.byte_length !== 'number'
			|| !(row.bytes instanceof Uint8Array)) {
			throw new Error('The persisted native plug-in state body has an invalid row shape.')
		}
		const bytes = Uint8Array.from(row.bytes)
		const descriptor = descriptorFor(row.sha256, row.byte_length)
		if (bytes.byteLength !== descriptor.byteLength
			|| createHash('sha256').update(bytes).digest('hex') !== descriptor.sha256) {
			throw new Error('The persisted native plug-in state body failed its content digest.')
		}
		return Object.freeze({ ...descriptor, bytes })
	}
}

function ordinaryBytes(value: unknown): Uint8Array {
	if (!(value instanceof Uint8Array) || value.buffer instanceof SharedArrayBuffer
		|| value.byteLength > SOUNDSCAPER_NATIVE_PLUGIN_STATE_BODY_MAXIMUM_BYTES) {
		throw new RangeError('Native plug-in state must be an ordinary Uint8Array no greater than 16 MiB.')
	}
	return Uint8Array.from(value)
}

function descriptorFor(
	sha256Value: unknown,
	byteLengthValue: unknown,
): Readonly<SoundscaperNativePluginStateBodyDescriptor> {
	const sha256 = digest(sha256Value)
	if (!Number.isSafeInteger(byteLengthValue) || Number(byteLengthValue) < 0
		|| Number(byteLengthValue) > SOUNDSCAPER_NATIVE_PLUGIN_STATE_BODY_MAXIMUM_BYTES) {
		throw new RangeError('A native plug-in state body has an invalid persisted byte length.')
	}
	return Object.freeze({
		kind: 'native-plugin-state' as const,
		bodyId: `native-plugin-state:${sha256}`,
		byteLength: Number(byteLengthValue),
		sha256,
	})
}

function stateBodyId(value: unknown): string {
	if (typeof value !== 'string' || !value.startsWith('native-plugin-state:')) {
		throw new TypeError('A native plug-in state body ID is required.')
	}
	const sha256 = digest(value.slice('native-plugin-state:'.length))
	return `native-plugin-state:${sha256}`
}

function digest(value: unknown): string {
	if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) {
		throw new TypeError('A native plug-in state body SHA-256 is invalid.')
	}
	return value
}

function timestamp(value: unknown): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) {
		throw new RangeError('A native plug-in state timestamp must be a non-negative safe integer.')
	}
	return Number(value)
}
