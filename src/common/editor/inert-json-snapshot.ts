/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainArray } from './closed-domain-value.ts'

export interface InertJsonSnapshotOptions {
	readonly maximumArrayLength: number
	readonly maximumNodes: number
}

/** Snapshot untrusted JSON-shaped input without invoking accessors or inherited state. */
export function snapshotInertJsonValue(
	value: unknown,
	name: string,
	options: InertJsonSnapshotOptions,
): unknown {
	return snapshot(value, name, options, new Set<object>(), { remaining: options.maximumNodes })
}

function snapshot(
	value: unknown,
	name: string,
	options: InertJsonSnapshotOptions,
	seen: Set<object>,
	budget: { remaining: number },
): unknown {
	budget.remaining -= 1
	if (budget.remaining < 0) throw new TypeError(`${name} exceeds the inert value budget`)
	if (
		value === null
		|| typeof value === 'string'
		|| typeof value === 'boolean'
		|| (typeof value === 'number' && Number.isFinite(value) && !Object.is(value, -0))
	) return value
	if (Array.isArray(value)) {
		if (seen.has(value)) throw new TypeError(`${name} must not be cyclic`)
		seen.add(value)
		const input = readClosedDomainArray(value, name, 0, options.maximumArrayLength)
		const output = input.map((entry, index) => snapshot(
			entry,
			`${name}[${index}]`,
			options,
			seen,
			budget,
		))
		seen.delete(value)
		return Object.freeze(output)
	}
	if (typeof value !== 'object' || value === null) {
		throw new TypeError(`${name} must contain inert JSON-compatible values`)
	}
	if (seen.has(value)) throw new TypeError(`${name} must not be cyclic`)
	seen.add(value)
	const prototype = Object.getPrototypeOf(value)
	if (prototype !== Object.prototype && prototype !== null) {
		throw new TypeError(`${name} must be a plain record`)
	}
	if (Object.getOwnPropertySymbols(value).length > 0) {
		throw new TypeError(`${name} must not contain symbol keys`)
	}
	const output: Record<string, unknown> = Object.create(null) as Record<string, unknown>
	for (const key of Object.keys(value)) {
		const descriptor = Object.getOwnPropertyDescriptor(value, key)
		if (descriptor === undefined || !('value' in descriptor)) {
			throw new TypeError(`${name}.${key} must be an inert data field`)
		}
		output[key] = snapshot(descriptor.value, `${name}.${key}`, options, seen, budget)
	}
	seen.delete(value)
	return Object.freeze(output)
}
