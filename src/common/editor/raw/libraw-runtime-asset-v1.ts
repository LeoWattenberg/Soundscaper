/* SPDX-License-Identifier: AGPL-3.0-only */

import manifest from '../../../../config/lightscaper-libraw-runtime-manifest.json';

const PAGE = 65_536;
const BYTE_LENGTH = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), 'byteLength')!.get!;
let pending: Promise<WebAssembly.Module> | undefined;

/** Compile only the exact externally published decoder artifact. Imported
 * source metadata does not grant executable-byte authority. */
export async function compilePinnedLibRawModuleV1(bytes: Uint8Array<ArrayBuffer>): Promise<WebAssembly.Module> {
	const pin = manifest.runtime;
	if (!/^[a-f0-9]{64}$/u.test(pin.sha256) || !Number.isSafeInteger(pin.byteLength) || pin.byteLength < 8
		|| pin.byteLength > pin.maximumBytes || pin.maximumBytes > 8 * 1024 * 1024) throw new RangeError('LibRaw runtime publication is not pinned.');
	if (!(bytes instanceof Uint8Array) || Reflect.apply(BYTE_LENGTH, bytes, []) !== pin.byteLength) throw new RangeError('LibRaw runtime byte length differs from its pin.');
	// Capture before the first await: a caller can mutate its original span while
	// the digest promise is pending. Hash, audit and compile one owned snapshot.
	const owned = new Uint8Array(bytes);
	try {
		const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', owned));
		const hex = Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
		if (hex !== pin.sha256) throw new Error('LibRaw runtime SHA256 differs from its pin.');
		assertLibRawMemoryV1(owned);
		return await WebAssembly.compile(owned);
	} finally { owned.fill(0); }
}

/** The compiled module is reusable; native instances and their memory are not. */
export function loadLibRawModuleV1(): Promise<WebAssembly.Module> {
	if (pending) return pending;
	const work = fetchModule(); pending = work;
	void work.catch(() => { if (pending === work) pending = undefined; });
	return work;
}

async function fetchModule(): Promise<WebAssembly.Module> {
	const pin = manifest.runtime, url = new URL(pin.url);
	if (url.origin !== 'https://assets.soundscaper.org' || url.pathname !== '/runtime/libraw/0.22.2/libraw.wasm' || url.search || url.hash) {
		throw new TypeError('LibRaw runtime must use its versioned asset origin.');
	}
	const response = await fetch(url.href, { credentials: 'omit', redirect: 'error', mode: 'cors', cache: 'force-cache' });
	if (!response.ok || !response.body) throw new Error('LibRaw runtime download failed.');
	const reader = response.body.getReader(), parts: Uint8Array<ArrayBuffer>[] = [];
	let length = 0;
	try {
		for (;;) {
			const part = await reader.read(); if (part.done) break;
			if (length + part.value.byteLength > pin.byteLength || length + part.value.byteLength > pin.maximumBytes) {
				throw new RangeError('LibRaw runtime download exceeds its pinned length.');
			}
			const owned = new Uint8Array(part.value); parts.push(owned); length += owned.byteLength;
		}
		if (length !== pin.byteLength) throw new RangeError('LibRaw runtime download is truncated.');
		const bytes = new Uint8Array(length); let offset = 0;
		try {
			for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
			return await compilePinnedLibRawModuleV1(bytes);
		} finally { bytes.fill(0); }
	} finally {
		for (const part of parts) part.fill(0);
		try { await reader.cancel().catch(() => undefined); } finally { reader.releaseLock(); }
	}
}

/** Browser-side memory audit before compilation; no imported, shared, unbounded
 * or memory64 heap can be substituted for the reviewed scalar decoder. */
export function assertLibRawMemoryV1(bytes: Uint8Array): void {
	const header = [0, 97, 115, 109, 1, 0, 0, 0];
	if (bytes.length < 8 || header.some((byte, index) => bytes[index] !== byte)) throw new TypeError('Invalid LibRaw WebAssembly header.');
	let at = 8, memories = 0;
	const integer = (end: number) => {
		let value = 0;
		for (let index = 0; index < 5; index++) {
			if (at >= end) throw new RangeError('Truncated LibRaw WebAssembly integer.');
			const byte = bytes[at++]!;
			if (index === 4 && byte > 15) throw new RangeError('LibRaw WebAssembly integer exceeds 32 bits.');
			value += (byte & 127) * 2 ** (index * 7);
			if ((byte & 128) === 0) return value;
		}
		throw new RangeError('Invalid LibRaw WebAssembly integer.');
	};
	while (at < bytes.length) {
		const id = bytes[at++]!, size = integer(bytes.length), end = at + size;
		if (end > bytes.length) throw new RangeError('LibRaw WebAssembly section exceeds its artifact.');
		if (id === 5) {
			if (++memories !== 1 || integer(end) !== 1 || integer(end) !== 1) throw new RangeError('LibRaw requires one nonshared bounded memory.');
			const initial = integer(end), maximum = integer(end);
			if (initial * PAGE !== manifest.runtime.initialMemoryBytes || maximum * PAGE !== manifest.runtime.maximumMemoryBytes
				|| initial !== 512 || maximum !== 8192 || at !== end) throw new RangeError('LibRaw memory differs from its reviewed limits.');
		}
		at = end;
	}
	if (memories !== 1) throw new RangeError('LibRaw requires one defined bounded memory.');
}
