/* SPDX-License-Identifier: AGPL-3.0-only */

import fontUrl from '@fontsource/inter/files/inter-latin-600-normal.woff2?url';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

export const IMAGE_EXPORT_TEXT_FONT_V1 = Object.freeze({ byteLength: 24_452,
	sha256: 'f9a06e79cd3a2a20951c0f0e28f66dd0e6d3fda73911d640a2125c8fcb78f21a' });
export interface ImageExportTextFontHandleV1 { readonly family: string; close(): void | Promise<void> }
export interface ImageExportTextFontPortV1 {
	fetch(url: string, signal?: AbortSignal): Promise<Response>;
	open(family: string, bytes: Uint8Array<ArrayBuffer>): Promise<ImageExportTextFontHandleV1>;
}
const CHECK = AbortSignal.prototype.throwIfAborted, FILL = Uint8Array.prototype.fill;
const BUFFER = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), 'buffer')!.get!;
const SIZE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!;
let serial = 0;

/** The native face is private to one export; its load and exact font transport
 * settle before removal. Only that face is removed from the existing font set.
 * The callback cannot outlive either owned resource. No installed/fallback face
 * substitutes for this pinned asset, and cancellation never abandons load. */
export async function withImageExportTextFontV1<Result>(consume: (family: string) => Result | Promise<Result>,
	options: Readonly<{ signal?: AbortSignal; port?: ImageExportTextFontPortV1 }> = {}): Promise<Result> {
	const signal = options.signal; if (signal !== undefined) assertImageExportTextSignalV1(signal);
	const check = () => { if (signal !== undefined) Reflect.apply(CHECK, signal, []); };
	const port = options.port ?? nativeFontPort(), fetch = capture(port, 'fetch'), open = capture(port, 'open');
	let bytes: Uint8Array<ArrayBuffer> | undefined, close: (() => void | Promise<void>) | undefined;
	let primary: { reason: unknown } | undefined, cleanup: { reason: unknown } | undefined, result: Result | undefined;
	try {
		bytes = await readPinnedFont(await fetch(fontUrl, signal), signal); check();
		const family = `scape-export-text-${++serial}`, handle = await open(family, bytes);
		close = capture(handle, 'close');
		if (handle.family !== family) throw new Error('Export text font lost its private family.');
		check(); result = await consume(family); check();
	} catch (error) { primary = { reason: error }; }
	try { await close?.(); } catch (error) { cleanup = { reason: error }; }
	wipeImageExportTextBytesV1(bytes);
	if (primary && cleanup) throw new AggregateError([primary.reason, cleanup.reason], 'Export text font and cleanup failed.', { cause: primary.reason });
	if (primary) throw primary.reason; if (cleanup) throw cleanup.reason;
	return result as Result;
}

async function readPinnedFont(response: Response, signal?: AbortSignal): Promise<Uint8Array<ArrayBuffer>> {
	const check = () => { if (signal !== undefined) Reflect.apply(CHECK, signal, []); };
	if (!response.ok || !response.body) throw new Error('The pinned export text font is unavailable.');
	const reader = response.body.getReader(), bytes = new Uint8Array(IMAGE_EXPORT_TEXT_FONT_V1.byteLength);
	let offset = 0, done = false, primary: { reason: unknown } | undefined;
	const cleanup: unknown[] = [];
	try {
		check();
		while (!done) {
			const next = await reader.read(); check(); done = next.done;
			if (!next.done) {
				if (next.value.byteLength === 0 || next.value.byteLength > bytes.length - offset) throw new RangeError('Export text font exceeds its exact byte limit or has an empty chunk.');
				bytes.set(next.value, offset); offset += next.value.byteLength;
			}
		}
		if (offset !== bytes.length || bytesToHex(sha256(bytes)) !== IMAGE_EXPORT_TEXT_FONT_V1.sha256) throw new RangeError('Export text font length or digest changed.');
	} catch (error) { primary = { reason: error }; }
	try { if (!done) await reader.cancel(); } catch (error) { cleanup.push(error); }
	try { reader.releaseLock(); } catch (error) { cleanup.push(error); }
	if (primary || cleanup.length) {
		wipeImageExportTextBytesV1(bytes);
		if (primary && cleanup.length) throw new AggregateError([primary.reason, ...cleanup], 'Export text font read and cleanup failed.', { cause: primary.reason });
		if (primary) throw primary.reason;
		if (cleanup.length > 1) throw new AggregateError(cleanup, 'Export text font reader cleanup failed.');
		throw cleanup[0];
	}
	return bytes;
}

function nativeFontPort(): ImageExportTextFontPortV1 {
	const fetch = globalThis.fetch, Face = globalThis.FontFace, fonts = globalThis.document?.fonts;
	if (typeof fetch !== 'function' || typeof Face !== 'function' || !fonts) throw new Error('Native export text fonts are unavailable.');
	const add = capture(fonts, 'add'), remove = capture(fonts, 'delete'), load = Face.prototype.load;
	return {
		fetch: (url, signal) => Reflect.apply(fetch, globalThis, [url, signal === undefined ? {} : { signal }]) as Promise<Response>,
		async open(family, bytes) {
			const face = new Face(family, bytes, { style: 'normal', weight: '600' });
			await (Reflect.apply(load, face, []) as Promise<FontFace>);
			try { add(face); }
			catch (error) {
				const failures: unknown[] = [];
				try { remove(face); }
				catch (cleanup) { failures.push(cleanup); }
				if (failures.length) throw new AggregateError([error, ...failures], 'Export text font publication and cleanup failed.', { cause: error });
				throw error;
			}
			let closed = false;
			return Object.freeze({ family, close() { if (!closed) { closed = true; remove(face); } } });
		},
	};
}

export function assertImageExportTextSignalV1(signal: AbortSignal): void {
	Reflect.apply(CHECK, signal, []);
	if (Object.getPrototypeOf(signal) !== AbortSignal.prototype || ['aborted', 'reason', 'throwIfAborted', 'addEventListener', 'removeEventListener'].some(key => Object.hasOwn(signal, key))) {
		throw new TypeError('Export text requires an unmodified native cancellation signal.');
	}
}
export function wipeImageExportTextBytesV1(value: Uint8Array<ArrayBuffer> | Uint8ClampedArray<ArrayBuffer> | undefined): void {
	if (!value) return;
	const buffer = Reflect.apply(BUFFER, value, []) as ArrayBuffer;
	if (Number(Reflect.apply(SIZE, buffer, []))) Reflect.apply(FILL, value, [0]);
}
function capture<Owner extends object, Key extends keyof Owner>(owner: Owner, key: Key): Owner[Key] {
	let current: object | null = owner;
	for (let depth = 0; current && depth < 32; depth++) {
		const descriptor = Object.getOwnPropertyDescriptor(current, key);
		if (descriptor) {
			if (!Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'function') throw new TypeError('Export text requires a captured data capability.');
			const method = descriptor.value as (...args: unknown[]) => unknown;
			return ((...args: unknown[]) => Reflect.apply(method, owner, args) as unknown) as Owner[Key];
		}
		current = Object.getPrototypeOf(current) as object | null;
	}
	throw new TypeError('Export text native capability is unavailable.');
}
