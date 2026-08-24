/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	NativeAudioBackend, NativeAudioExactFormat, NativeAudioOpenAttempt,
	NativeAudioOpenOutcome, NativeAudioOpenRefusalCode, NativeAudioOpenRequest,
} from './native-audio-session-service.ts'

export function normalizeOpenRequest(value: unknown): Readonly<NativeAudioOpenRequest> {
	const record = closedRecord(value, [
		'candidates', 'direction', 'mode', 'sampleRate', 'periodFrames', 'channelCount',
	], 'native audio open request')
	if (!Array.isArray(record.candidates) || record.candidates.length < 1 || record.candidates.length > 4) {
		throw new RangeError('A native audio open requires one through four ordered candidates.')
	}
	const candidates = record.candidates.map((value, index) => {
		const candidate = closedRecord(value, ['backend', 'deviceHandle'], `audio candidate ${String(index)}`)
		const backend = enumValue(candidate.backend,
			['coreaudio', 'wasapi', 'asio', 'pipewire', 'alsa', 'jack'] as const, 'audio backend')
		if (typeof candidate.deviceHandle !== 'string' || !candidate.deviceHandle
			|| candidate.deviceHandle.length > 1_024 || candidate.deviceHandle.includes('\0')
			|| candidate.deviceHandle.includes('/') || candidate.deviceHandle.includes('\\')) {
			throw new TypeError('An audio candidate requires a bounded opaque device handle.')
		}
		return Object.freeze({ backend, deviceHandle: candidate.deviceHandle })
	})
	const mode = enumValue(record.mode, ['shared', 'exclusive'] as const, 'audio mode')
	if (candidates.some((candidate) => candidate.backend === 'asio') && mode !== 'exclusive') {
		throw new TypeError('ASIO audio candidates require exclusive mode.')
	}
	return Object.freeze({
		candidates: Object.freeze(candidates),
		direction: enumValue(record.direction, ['input', 'output', 'duplex'] as const, 'audio direction'),
		mode,
		sampleRate: boundedInteger(record.sampleRate, 8_000, 768_000, 'sample rate'),
		periodFrames: boundedInteger(record.periodFrames, 1, 16_384, 'period frames'),
		channelCount: boundedInteger(record.channelCount, 1, 32, 'channel count'),
	})
}

export function sameFormat(left: NativeAudioExactFormat, right: NativeAudioExactFormat): boolean {
	return left.direction === right.direction && left.mode === right.mode
		&& left.sampleRate === right.sampleRate && left.periodFrames === right.periodFrames
		&& left.channelCount === right.channelCount
}

export function snapshotFormat(value: NativeAudioExactFormat): NativeAudioExactFormat {
	return Object.freeze({ direction: value.direction, mode: value.mode,
		sampleRate: value.sampleRate, periodFrames: value.periodFrames, channelCount: value.channelCount })
}

export function attempt(backend: NativeAudioBackend, status: NativeAudioOpenAttempt['status'],
	detail: string): NativeAudioOpenAttempt {
	return Object.freeze({ backend, status, detail })
}

export function refused(code: NativeAudioOpenRefusalCode, message: string,
	attempts: readonly NativeAudioOpenAttempt[]): NativeAudioOpenOutcome {
	return Object.freeze({ status: 'refused' as const, code, message, attempts: Object.freeze([...attempts]) })
}

export function closedRecord<const Field extends string>(value: unknown, fields: readonly Field[],
	label: string): Readonly<Record<Field, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
		throw new TypeError(`${label} must be a plain record.`)
	}
	const keys = Reflect.ownKeys(value)
	if (keys.length !== fields.length || keys.some(
		(key) => typeof key !== 'string' || !fields.includes(key as Field),
	)) throw new TypeError(`${label} must contain exactly its schema fields.`)
	return value as Readonly<Record<Field, unknown>>
}

export function enumValue<const Values extends readonly string[]>(value: unknown, values: Values,
	label: string): Values[number] {
	if (typeof value !== 'string' || !(values as readonly string[]).includes(value)) {
		throw new TypeError(`An unsupported ${label} was requested.`)
	}
	return value as Values[number]
}

export function boundedInteger(value: unknown, minimum: number, maximum: number, label: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
		throw new RangeError(`The native audio ${label} is outside its admitted bounds.`)
	}
	return Number(value)
}

export function boundedDetail(value: unknown): string {
	return typeof value === 'string' && value.length <= 2_048
		? value : 'The audio backend refused the request.'
}
