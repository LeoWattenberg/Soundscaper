/* SPDX-License-Identifier: AGPL-3.0-only */

const jsonCache = new WeakMap<object, string>();
const envelopeCache = new WeakMap<object, string>();

/** Cache exact JSON only for a deeply frozen value snapshot; mutable inputs stay live. */
export function immutableWaveformKeyJson(value: unknown): string {
	if (!value || typeof value !== 'object') return JSON.stringify(value ?? null) ?? 'null';
	const cached = jsonCache.get(value);
	if (cached !== undefined) return cached;
	const json = JSON.stringify(value) ?? 'null';
	if (deeplyFrozen(value)) jsonCache.set(value, json);
	return json;
}

export function waveformEnvelopeKeyJson(envelope: readonly Readonly<{ frame?: number; value?: number }>[] | undefined): string {
	if (!envelope) return '[]';
	const cached = envelopeCache.get(envelope);
	if (cached !== undefined) return cached;
	const json = JSON.stringify(envelope.map(point => [point.frame ?? 0, point.value ?? 1]));
	if (deeplyFrozen(envelope)) envelopeCache.set(envelope, json);
	return json;
}

function deeplyFrozen(value: object, seen = new Set<object>()): boolean {
	if (!Object.isFrozen(value) || (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) return false;
	if (seen.has(value)) return true;
	seen.add(value);
	return Reflect.ownKeys(value).every(key => {
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (!descriptor || !Object.hasOwn(descriptor, 'value')) return false;
		const child: unknown = descriptor.value;
		return !child || typeof child !== 'object' || deeplyFrozen(child, seen);
	});
}
