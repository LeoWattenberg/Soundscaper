/* SPDX-License-Identifier: AGPL-3.0-only */
export const MOTION_SAVED_FILE_CHUNK_BYTES = 4 * 1024 * 1024;
export const MOTION_SAVED_FILE_MAXIMUM_BYTES = 64 * 1024 ** 3;
export interface MotionSavedFileWatch { readonly watchId: string; readonly name: string }
export interface MotionSavedFileSnapshot { readonly token: string; readonly name: string; readonly byteLength: number; readonly generation: number }
export type MotionSavedFileDiscovery =
	| Readonly<{ state: 'unchanged'; generation: number }>
	| Readonly<{ state: 'unavailable'; generation: number }>
	| Readonly<{ state: 'snapshot'; snapshot: MotionSavedFileSnapshot }>;
/** Platform-local permission; paths and watcher state never enter portable project intent. */
export interface MotionSavedFileCapabilities {
	select(): Promise<MotionSavedFileWatch | null>;
	poll(request: Readonly<{ watchId: string; afterGeneration: number }>): Promise<MotionSavedFileDiscovery>;
	read(request: Readonly<{ token: string; offset: number; length: number }>): Promise<Uint8Array>;
	release(request: Readonly<{ token: string }>): Promise<void>;
	cancel(request: Readonly<{ watchId: string }>): Promise<void>;
}

export function normalizeMotionSavedFileSnapshot(value: unknown): MotionSavedFileSnapshot {
	const record = closed(value, ['token', 'name', 'byteLength', 'generation']);
	return Object.freeze({ token: identity(record.token), name: displayName(record.name), byteLength: count(record.byteLength, MOTION_SAVED_FILE_MAXIMUM_BYTES, 1), generation: count(record.generation, Number.MAX_SAFE_INTEGER, 1) });
}
export function normalizeMotionSavedFileWatch(value: unknown): MotionSavedFileWatch {
	const record = closed(value, ['watchId', 'name']); return Object.freeze({ watchId: identity(record.watchId), name: displayName(record.name) });
}
export function normalizeMotionSavedFileDiscovery(value: unknown): MotionSavedFileDiscovery {
	const state = value && typeof value === 'object' ? Object.getOwnPropertyDescriptor(value, 'state')?.value as unknown : undefined;
	if (state === 'snapshot') { const record = closed(value, ['state', 'snapshot']); return Object.freeze({ state, snapshot: normalizeMotionSavedFileSnapshot(record.snapshot) }); }
	if (state === 'unchanged' || state === 'unavailable') { const record = closed(value, ['state', 'generation']); return Object.freeze({ state, generation: count(record.generation, Number.MAX_SAFE_INTEGER, 0) }); }
	throw new TypeError('Unsupported Motion saved-file discovery state.');
}
function closed(value: unknown, fields: readonly string[]): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value) || Reflect.ownKeys(value).length !== fields.length) throw new TypeError('Motion saved-file response has unsupported fields.');
	const result: Record<string, unknown> = {};
	for (const field of fields) { const descriptor = Object.getOwnPropertyDescriptor(value, field); if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) throw new TypeError('Motion saved-file response requires own data fields.'); result[field] = descriptor.value; }
	return result;
}
function identity(value: unknown): string { if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/u.test(value)) throw new TypeError('Invalid Motion saved-file capability identity.'); return value; }
function displayName(value: unknown): string { if (typeof value !== 'string' || !value || value.length > 512 || (value.includes('/') || value.includes('\\') || Array.from(value).some(character => character.charCodeAt(0) < 32))) throw new TypeError('Invalid Motion saved-file display name.'); return value; }
function count(value: unknown, maximum: number, minimum: number): number { if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) throw new RangeError('Motion saved-file response exceeds its numeric admission.'); return value; }
