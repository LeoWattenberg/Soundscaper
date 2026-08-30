/* SPDX-License-Identifier: AGPL-3.0-only */

import { fingerprintSoundscaperDeliveryPlanV1 } from '../soundscaper-delivery-contract-v1.ts';

export interface PersistentAudioDeliveryExecutionRequest {
	readonly settings: Readonly<Record<string, unknown>>;
	readonly exportPlan: Readonly<Record<string, unknown>>;
	readonly destination: unknown;
	readonly onProgress?: (progress: number) => unknown;
}

export function exactPersistentAudioDeliveryExecution(
	value: unknown,
): PersistentAudioDeliveryExecutionRequest {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| !closedKeys(value, ['settings', 'exportPlan', 'destination'], ['onProgress'])) {
		throw new TypeError('A closed claimed persistent audio delivery execution is required.');
	}
	const request = value as Readonly<Record<string, unknown>>;
	if (request.onProgress !== undefined && typeof request.onProgress !== 'function') {
		throw new TypeError('Persistent audio delivery progress must be a callback.');
	}
	return Object.freeze({
		settings: canonicalPersistentJsonRecord(request.settings, 'claimed normalized export settings'),
		exportPlan: canonicalPersistentJsonRecord(request.exportPlan, 'claimed exact export plan'),
		destination: request.destination,
		...(request.onProgress === undefined ? {} : { onProgress: request.onProgress as (progress: number) => unknown }),
	});
}

export function assertExactPersistentExportPlan(actual: unknown, expected: unknown): void {
	const actualFingerprint = fingerprintSoundscaperDeliveryPlanV1(
		canonicalPersistentJsonRecord(actual, 'fresh persistent export plan'),
	);
	const expectedFingerprint = fingerprintSoundscaperDeliveryPlanV1(
		canonicalPersistentJsonRecord(expected, 'claimed persistent export plan'),
	);
	if (actualFingerprint.sha256 !== expectedFingerprint.sha256
		|| actualFingerprint.canonical !== expectedFingerprint.canonical) {
		throw new Error('The ordinary audio export plan changed after persistent delivery was claimed.');
	}
}

export function canonicalPersistentJsonRecord(
	value: unknown,
	label: string,
): Readonly<Record<string, unknown>> {
	let snapshot: unknown;
	try { snapshot = JSON.parse(JSON.stringify(value)) as unknown; }
	catch (error) { throw new TypeError(`The ${label} is not canonical JSON.`, { cause: error }); }
	if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
		throw new TypeError(`The ${label} must be a record.`);
	}
	return deepFreeze(snapshot) as Readonly<Record<string, unknown>>;
}

function closedKeys(value: object, required: readonly string[], optional: readonly string[]): boolean {
	const keys = Reflect.ownKeys(value);
	return required.every((field) => keys.includes(field))
		&& keys.length >= required.length && keys.length <= required.length + optional.length
		&& keys.every((key) => typeof key === 'string' && (required.includes(key) || optional.includes(key)));
}

function deepFreeze(value: unknown): unknown {
	if (!value || typeof value !== 'object') return value;
	for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
	return Object.freeze(value);
}
