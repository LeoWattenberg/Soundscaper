/* SPDX-License-Identifier: AGPL-3.0-only */

export const CART_FIXED_PAYLOAD_BYTES = 1_024;
const MAX_CART_TEXT_BYTES = 1024 * 1024;

export interface CartTimer { readonly usage: string; readonly value: number; }
export interface CartMetadata {
	readonly version: string; readonly title: string; readonly artist: string; readonly cutId: string;
	readonly clientId: string; readonly category: string; readonly classification: string; readonly outCue: string;
	readonly startDate: string; readonly startTime: string; readonly endDate: string; readonly endTime: string;
	readonly producerAppId: string; readonly producerAppVersion: string; readonly userDef: string;
	readonly levelReference: number; readonly postTimers: readonly CartTimer[]; readonly url: string; readonly tagText: string;
}
export type CartMetadataInput = Partial<Omit<CartMetadata, 'postTimers'>> & { readonly postTimers?: readonly Partial<CartTimer>[] };

const FIELDS = Object.freeze([
	['version', 0, 4], ['title', 4, 64], ['artist', 68, 64], ['cutId', 132, 64], ['clientId', 196, 64],
	['category', 260, 64], ['classification', 324, 64], ['outCue', 388, 64], ['startDate', 452, 10],
	['startTime', 462, 8], ['endDate', 470, 10], ['endTime', 480, 8], ['producerAppId', 488, 64],
	['producerAppVersion', 552, 64], ['userDef', 616, 64],
] as const);

export function normalizeCartMetadata(input: CartMetadataInput = {}): CartMetadata {
	if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('CART metadata must be an object.');
	const values = Object.fromEntries(FIELDS.map(([field, , width]) => [field, ascii(input[field] ?? (field === 'version' ? '0101' : ''), width, `CART ${field}`)]));
	const timers = (input.postTimers || []).map((timer, index) => Object.freeze({
		usage: ascii(timer.usage ?? '', 4, `CART timer ${index} usage`).padEnd(4, ' '),
		value: uint32(timer.value ?? 0, `CART timer ${index} value`),
	}));
	if (timers.length > 8) throw new RangeError('CART supports at most eight post timers.');
	return Object.freeze({
		...values,
		levelReference: int32(input.levelReference ?? 0, 'CART levelReference'),
		postTimers: Object.freeze(timers),
		url: ascii(input.url ?? '', MAX_CART_TEXT_BYTES, 'CART URL'),
		tagText: ascii(input.tagText ?? '', MAX_CART_TEXT_BYTES, 'CART tag text'),
	}) as unknown as CartMetadata;
}

export function encodeCartPayload(input: CartMetadataInput = {}): Uint8Array {
	const value = normalizeCartMetadata(input);
	const suffix = new TextEncoder().encode(`${value.url}\0${value.tagText}\0`);
	if (CART_FIXED_PAYLOAD_BYTES + suffix.byteLength > MAX_CART_TEXT_BYTES) throw new RangeError('CART metadata exceeds 1 MiB.');
	const output = new Uint8Array(CART_FIXED_PAYLOAD_BYTES + suffix.byteLength);
	const view = new DataView(output.buffer);
	for (const [field, offset] of FIELDS) output.set(new TextEncoder().encode(value[field]), offset);
	view.setInt32(680, value.levelReference, true);
	for (let index = 0; index < value.postTimers.length; index += 1) {
		const offset = 684 + index * 8;
		output.set(new TextEncoder().encode(value.postTimers[index].usage), offset);
		view.setUint32(offset + 4, value.postTimers[index].value, true);
	}
	output.set(suffix, CART_FIXED_PAYLOAD_BYTES);
	return output;
}

export function createRiffCartChunk(input: CartMetadataInput | null | undefined): Uint8Array {
	if (input == null) return new Uint8Array(0);
	const payload = encodeCartPayload(input);
	const output = new Uint8Array(8 + payload.byteLength + (payload.byteLength & 1));
	output.set(new TextEncoder().encode('cart'));
	new DataView(output.buffer).setUint32(4, payload.byteLength, true);
	output.set(payload, 8);
	return output;
}

export function parseCartPayload(bytes: Uint8Array): CartMetadata {
	if (bytes.byteLength < CART_FIXED_PAYLOAD_BYTES) throw new Error('The CART payload is shorter than its fixed body.');
	if (bytes.byteLength > MAX_CART_TEXT_BYTES) throw new RangeError('The CART payload exceeds 1 MiB.');
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const values = Object.fromEntries(FIELDS.map(([field, offset, width]) => [field, decode(bytes.subarray(offset, offset + width))]));
	const timers = [];
	for (let index = 0; index < 8; index += 1) {
		const offset = 684 + index * 8;
		const usage = decode(bytes.subarray(offset, offset + 4));
		const value = view.getUint32(offset + 4, true);
		if (usage || value) timers.push({ usage, value });
	}
	const suffix = bytes.subarray(CART_FIXED_PAYLOAD_BYTES);
	const separator = suffix.indexOf(0);
	const url = decode(separator < 0 ? suffix : suffix.subarray(0, separator));
	const tagText = separator < 0 ? '' : decode(suffix.subarray(separator + 1));
	return normalizeCartMetadata({ ...values, levelReference: view.getInt32(680, true), postTimers: timers, url, tagText });
}

function ascii(value: unknown, maximum: number, name: string): string { if (typeof value !== 'string') throw new TypeError(`${name} must be a string.`); if (value.length > maximum) throw new RangeError(`${name} is too long.`); for (const character of value) { const code = character.charCodeAt(0); if (code < 0x20 || code > 0x7e) throw new RangeError(`${name} must contain printable ASCII only.`); } return value; }
function decode(bytes: Uint8Array): string { const end = bytes.indexOf(0); return new TextDecoder('ascii').decode(end < 0 ? bytes : bytes.subarray(0, end)).trimEnd(); }
function uint32(value: unknown, name: string): number { const number = Number(value); if (!Number.isInteger(number) || number < 0 || number > 0xffff_ffff) throw new RangeError(`${name} must be unsigned 32-bit.`); return number; }
function int32(value: unknown, name: string): number { const number = Number(value); if (!Number.isInteger(number) || number < -0x8000_0000 || number > 0x7fff_ffff) throw new RangeError(`${name} must be signed 32-bit.`); return number; }
