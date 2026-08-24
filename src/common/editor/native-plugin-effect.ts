/* SPDX-License-Identifier: AGPL-3.0-only */

import { createStableId } from './stable-id.js'

export interface NativePluginRackEffect {
	readonly id: string
	readonly type: 'native-plugin'
	readonly enabled: boolean
	readonly bypassed: boolean
	readonly params: Readonly<{ readonly instanceId: string; readonly latencyFrames: number }>
	readonly context: Readonly<{
		readonly format: 'vst3' | 'clap' | 'au' | 'lv2'
		readonly stablePluginId: string
		readonly binarySha256: string
	}>
}

export function normalizeNativePluginEffect(value: unknown): NativePluginRackEffect {
	const effect = record(value, 'native plug-in effect')
	if (effect.type !== 'native-plugin') throw new TypeError('A native plug-in effect type is required.')
	const params = record(effect.params, 'native plug-in effect parameters')
	const context = record(effect.context, 'native plug-in effect context')
	return Object.freeze({
		id: identifier(effect.id, 'effect ID'),
		type: 'native-plugin',
		enabled: effect.enabled !== false,
		bypassed: effect.bypassed === true,
		params: Object.freeze({
			instanceId: identifier(params.instanceId, 'instance ID'),
			latencyFrames: integer(params.latencyFrames, 0, 1_048_576, 'latency'),
		}),
		context: Object.freeze({
			format: format(context.format),
			stablePluginId: text(context.stablePluginId, 'stable plug-in ID'),
			binarySha256: digest(context.binarySha256),
		}),
	})
}

export function createNativePluginEffect(options: Readonly<Record<string, unknown>> = {}): NativePluginRackEffect {
	return normalizeNativePluginEffect({
		id: options.id ?? createStableId('native-plugin-effect'),
		type: 'native-plugin',
		enabled: options.enabled ?? true,
		bypassed: options.bypassed ?? false,
		params: options.params,
		context: options.context,
	})
}

export function updateNativePluginEffect(
	effect: unknown,
	changesValue: Readonly<Record<string, unknown>> = {},
): NativePluginRackEffect {
	const current = normalizeNativePluginEffect(effect)
	const changes = record(changesValue, 'native plug-in effect changes')
	return normalizeNativePluginEffect({
		...current,
		enabled: changes.enabled ?? current.enabled,
		bypassed: changes.bypassed ?? current.bypassed,
		params: { ...current.params, ...(recordOrEmpty(changes.params)) },
		context: { ...current.context, ...(recordOrEmpty(changes.context)) },
	})
}

function record(value: unknown, label: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be a record.`)
	return value as Record<string, unknown>
}
function recordOrEmpty(value: unknown): Record<string, unknown> { return value === undefined ? {} : record(value, 'native plug-in metadata') }
function identifier(value: unknown, label: string): string {
	if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u.test(value)) {
		throw new TypeError(`The native plug-in ${label} is invalid.`)
	}
	return value
}
function text(value: unknown, label: string): string {
	if (typeof value !== 'string' || !value.trim() || value.length > 1_024) {
		throw new TypeError(`The native ${label} is invalid.`)
	}
	return value
}
function format(value: unknown): NativePluginRackEffect['context']['format'] {
	if (value !== 'vst3' && value !== 'clap' && value !== 'au' && value !== 'lv2') {
		throw new TypeError('The native plug-in format is unsupported.')
	}
	return value
}
function digest(value: unknown): string {
	if (typeof value !== 'string' || !/^[a-f\d]{64}$/u.test(value)) throw new TypeError('The native binary digest is invalid.')
	return value
}
function integer(value: unknown, minimum: number, maximum: number, label: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
		throw new RangeError(`The native plug-in ${label} is outside its bounds.`)
	}
	return Number(value)
}
