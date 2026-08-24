/* SPDX-License-Identifier: AGPL-3.0-only */

import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'

export const SOUNDSCAPER_DESKTOP_NATIVE_PLUGIN_STATE_MAXIMUM_BYTES_V1 = 16 * 1024 * 1024

export interface SoundscaperDesktopNativePluginStateBodyDescriptorV1 {
	readonly kind: 'native-plugin-state'
	readonly bodyId: string
	readonly byteLength: number
	readonly sha256: string
}

export interface SoundscaperDesktopNativePluginStateBodyRecordV1 extends
	SoundscaperDesktopNativePluginStateBodyDescriptorV1 {
	readonly bytes: Uint8Array
}

const DESCRIPTOR_FIELDS = Object.freeze(['kind', 'bodyId', 'byteLength', 'sha256'] as const)
const RECORD_FIELDS = Object.freeze([...DESCRIPTOR_FIELDS, 'bytes'] as const)
const DIGEST = /^[a-f0-9]{64}$/u

/** Validate an opaque body before it crosses the sandbox/main boundary. */
export function validateSoundscaperNativePluginStateBytesV1(value: unknown): Uint8Array {
	if (!(value instanceof Uint8Array) || value.buffer instanceof SharedArrayBuffer) {
		throw new TypeError('Native plug-in state transport requires ordinary Uint8Array bytes.')
	}
	if (value.byteLength > SOUNDSCAPER_DESKTOP_NATIVE_PLUGIN_STATE_MAXIMUM_BYTES_V1) {
		throw new RangeError('Native plug-in state transport exceeds its 16 MiB byte ceiling.')
	}
	return Uint8Array.from(value)
}

export function validateSoundscaperNativePluginStateBodyIdV1(value: unknown): string {
	if (typeof value !== 'string' || !value.startsWith('native-plugin-state:')) {
		throw new TypeError('A content-addressed native plug-in state body ID is required.')
	}
	const digest = validateDigest(value.slice('native-plugin-state:'.length))
	return `native-plugin-state:${digest}`
}

export function validateSoundscaperNativePluginStateBodyDescriptorV1(
	value: unknown,
): Readonly<SoundscaperDesktopNativePluginStateBodyDescriptorV1> {
	const raw = exactRecord(value, DESCRIPTOR_FIELDS, 'native plug-in state descriptor')
	const sha256Value = validateDigest(raw.sha256)
	const bodyId = validateSoundscaperNativePluginStateBodyIdV1(raw.bodyId)
	if (raw.kind !== 'native-plugin-state' || bodyId !== `native-plugin-state:${sha256Value}`) {
		throw new TypeError('The native plug-in state descriptor identity changed.')
	}
	return Object.freeze({
		kind: 'native-plugin-state',
		bodyId,
		byteLength: validateByteLength(raw.byteLength),
		sha256: sha256Value,
	})
}

export function validateSoundscaperPersistedNativePluginStateBodyV1(
	value: unknown,
	bytesValue: unknown,
): Readonly<SoundscaperDesktopNativePluginStateBodyDescriptorV1> {
	const descriptor = validateSoundscaperNativePluginStateBodyDescriptorV1(value)
	const bytes = validateSoundscaperNativePluginStateBytesV1(bytesValue)
	if (descriptor.byteLength !== bytes.byteLength || descriptor.sha256 !== bytesToHex(sha256(bytes))) {
		throw new Error('Native plug-in state persistence returned another content identity.')
	}
	return descriptor
}

export function validateSoundscaperNativePluginStateBodyRecordV1(
	value: unknown,
): Readonly<SoundscaperDesktopNativePluginStateBodyRecordV1> {
	const raw = exactRecord(value, RECORD_FIELDS, 'native plug-in state body record')
	const descriptor = validateSoundscaperNativePluginStateBodyDescriptorV1({
		kind: raw.kind,
		bodyId: raw.bodyId,
		byteLength: raw.byteLength,
		sha256: raw.sha256,
	})
	const bytes = validateSoundscaperNativePluginStateBytesV1(raw.bytes)
	if (bytes.byteLength !== descriptor.byteLength
		|| bytesToHex(sha256(bytes)) !== descriptor.sha256) {
		throw new Error('The native plug-in state body failed its length or digest.')
	}
	return Object.freeze({ ...descriptor, bytes })
}

function validateByteLength(value: unknown): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0
		|| Number(value) > SOUNDSCAPER_DESKTOP_NATIVE_PLUGIN_STATE_MAXIMUM_BYTES_V1) {
		throw new RangeError('The native plug-in state byte length is invalid.')
	}
	return Number(value)
}

function validateDigest(value: unknown): string {
	if (typeof value !== 'string' || !DIGEST.test(value)) {
		throw new TypeError('The native plug-in state digest is invalid.')
	}
	return value
}

function exactRecord<const Field extends string>(
	value: unknown,
	fields: readonly Field[],
	label: string,
): Readonly<Record<Field, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
		throw new TypeError(`The ${label} must be a plain record.`)
	}
	const keys = Reflect.ownKeys(value)
	if (keys.length !== fields.length || keys.some(
		(key) => typeof key !== 'string' || !fields.includes(key as Field),
	)) throw new TypeError(`The ${label} has missing or unsupported fields.`)
	const result = Object.create(null) as Record<Field, unknown>
	for (const field of fields) {
		const descriptor = Object.getOwnPropertyDescriptor(value, field)
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`The ${label}.${field} must be an own data property.`)
		}
		result[field] = descriptor.value
	}
	return result
}
