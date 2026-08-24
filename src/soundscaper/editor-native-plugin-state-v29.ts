/* SPDX-License-Identifier: AGPL-3.0-only */

export const SOUNDSCAPER_NATIVE_PLUGIN_FORMATS_V29 = Object.freeze([
	'vst3', 'clap', 'au', 'lv2',
] as const)

export type SoundscaperNativePluginFormatV29 =
	(typeof SOUNDSCAPER_NATIVE_PLUGIN_FORMATS_V29)[number]

export const SOUNDSCAPER_NATIVE_PLUGIN_CONTINUITIES_V29 = Object.freeze([
	'live', 'bypass', 'frozen',
] as const)

export type SoundscaperNativePluginContinuityV29 =
	(typeof SOUNDSCAPER_NATIVE_PLUGIN_CONTINUITIES_V29)[number]

export const SOUNDSCAPER_NATIVE_PLUGIN_STATE_LIMITS_V29 = Object.freeze({
	maximumEntries: 4_096,
	maximumStateBytes: 16 * 1024 * 1024,
	maximumLatencySamples: 1_048_576,
	maximumIdentifierBytes: 1_024,
})

export interface SoundscaperNativePluginStateBodyV29 {
	readonly kind: 'native-plugin-state'
	readonly bodyId: string
	readonly byteLength: number
	readonly sha256: string
}

export interface SoundscaperNativePluginStateV29 {
	readonly instanceId: string
	readonly format: SoundscaperNativePluginFormatV29
	readonly stablePluginId: string
	readonly binarySha256: string
	readonly stateBody: Readonly<SoundscaperNativePluginStateBodyV29>
	readonly enabled: boolean
	readonly bypassed: boolean
	readonly continuity: SoundscaperNativePluginContinuityV29
	readonly latencySamples: number
}

const STATE_FIELDS = Object.freeze([
	'instanceId', 'format', 'stablePluginId', 'binarySha256', 'stateBody',
	'enabled', 'bypassed', 'continuity', 'latencySamples',
] as const)
const BODY_FIELDS = Object.freeze(['kind', 'bodyId', 'byteLength', 'sha256'] as const)
const OPAQUE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u
const SHA256 = /^[a-f0-9]{64}$/u

/** Normalize the document-side descriptor; opaque bytes never enter this model. */
export function createSoundscaperNativePluginStateV29(
	value: unknown,
): Readonly<SoundscaperNativePluginStateV29> {
	const record = closedRecord(value, STATE_FIELDS, 'Soundscaper native plug-in state')
	const format = enumValue(record.format, SOUNDSCAPER_NATIVE_PLUGIN_FORMATS_V29, 'plug-in format')
	const continuity = enumValue(
		record.continuity,
		SOUNDSCAPER_NATIVE_PLUGIN_CONTINUITIES_V29,
		'plug-in continuity',
	)
	const stateBody = normalizeStateBody(record.stateBody)
	const enabled = booleanValue(record.enabled, 'plug-in enabled flag')
	const bypassed = booleanValue(record.bypassed, 'plug-in bypass flag')
	if (continuity === 'live' && (!enabled || bypassed)) {
		throw new RangeError('Live native plug-in continuity requires an enabled, non-bypassed instance.')
	}
	if (continuity === 'bypass' && !bypassed) {
		throw new RangeError('Bypass native plug-in continuity requires the bypass flag.')
	}
	return Object.freeze({
		instanceId: opaqueId(record.instanceId, 'plug-in instance ID'),
		format,
		stablePluginId: boundedText(record.stablePluginId, 'stable plug-in ID'),
		binarySha256: digest(record.binarySha256, 'plug-in binary'),
		stateBody,
		enabled,
		bypassed,
		continuity,
		latencySamples: boundedInteger(
			record.latencySamples,
			0,
			SOUNDSCAPER_NATIVE_PLUGIN_STATE_LIMITS_V29.maximumLatencySamples,
			'plug-in latency',
		),
	})
}

export function normalizeSoundscaperNativePluginStatesV29(
	value: unknown,
): readonly Readonly<SoundscaperNativePluginStateV29>[] {
	if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype
		|| value.length > SOUNDSCAPER_NATIVE_PLUGIN_STATE_LIMITS_V29.maximumEntries) {
		throw new TypeError('project.nativePluginStates must be a bounded plain array.')
	}
	const result: Readonly<SoundscaperNativePluginStateV29>[] = []
	const instanceIds = new Set<string>()
	for (let index = 0; index < value.length; index += 1) {
		if (!Object.hasOwn(value, index)) throw new TypeError('project.nativePluginStates must be dense.')
		const state = createSoundscaperNativePluginStateV29(value[index])
		if (instanceIds.has(state.instanceId)) {
			throw new RangeError(`Native plug-in instance ${state.instanceId} is listed more than once.`)
		}
		instanceIds.add(state.instanceId)
		result.push(state)
	}
	return Object.freeze(result)
}

function normalizeStateBody(value: unknown): Readonly<SoundscaperNativePluginStateBodyV29> {
	const record = closedRecord(value, BODY_FIELDS, 'native plug-in state body')
	if (record.kind !== 'native-plugin-state') {
		throw new TypeError('A native plug-in state body must use the native-plugin-state kind.')
	}
	const sha256 = digest(record.sha256, 'native plug-in state body')
	const bodyId = `native-plugin-state:${sha256}`
	if (record.bodyId !== bodyId) {
		throw new TypeError('A native plug-in state body ID must be derived from its SHA-256.')
	}
	return Object.freeze({
		kind: 'native-plugin-state' as const,
		bodyId,
		byteLength: boundedInteger(
			record.byteLength,
			0,
			SOUNDSCAPER_NATIVE_PLUGIN_STATE_LIMITS_V29.maximumStateBytes,
			'native plug-in state byte length',
		),
		sha256,
	})
}

function closedRecord<const Field extends string>(
	value: unknown,
	fields: readonly Field[],
	label: string,
): Readonly<Record<Field, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
		throw new TypeError(`${label} must be a plain record.`)
	}
	const keys = Reflect.ownKeys(value)
	if (keys.length !== fields.length || keys.some(
		(key) => typeof key !== 'string' || !fields.includes(key as Field),
	)) throw new TypeError(`${label} must contain exactly its schema fields.`)
	for (const field of fields) {
		const descriptor = Object.getOwnPropertyDescriptor(value, field)
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`${label}.${field} must be an own enumerable data property.`)
		}
	}
	return value as Readonly<Record<Field, unknown>>
}

function enumValue<const Values extends readonly string[]>(
	value: unknown,
	values: Values,
	label: string,
): Values[number] {
	if (typeof value !== 'string' || !(values as readonly string[]).includes(value)) {
		throw new TypeError(`A native ${label} is unsupported.`)
	}
	return value as Values[number]
}

function opaqueId(value: unknown, label: string): string {
	if (typeof value !== 'string' || !OPAQUE_ID.test(value)) throw new TypeError(`A native ${label} is invalid.`)
	return value
}

function boundedText(value: unknown, label: string): string {
	if (typeof value !== 'string' || !value || value !== value.trim()
		|| new TextEncoder().encode(value).byteLength
			> SOUNDSCAPER_NATIVE_PLUGIN_STATE_LIMITS_V29.maximumIdentifierBytes) {
		throw new TypeError(`A native ${label} must be bounded canonical text.`)
	}
	return value
}

function digest(value: unknown, label: string): string {
	if (typeof value !== 'string' || !SHA256.test(value)) throw new TypeError(`A native ${label} digest is invalid.`)
	return value
}

function boundedInteger(value: unknown, minimum: number, maximum: number, label: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
		throw new RangeError(`A native ${label} is outside its admitted bounds.`)
	}
	return Number(value)
}

function booleanValue(value: unknown, label: string): boolean {
	if (typeof value !== 'boolean') throw new TypeError(`A native ${label} must be boolean.`)
	return value
}
