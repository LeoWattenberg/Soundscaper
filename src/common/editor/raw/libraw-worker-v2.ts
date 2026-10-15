/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from '../closed-domain-value.ts';
import { decodeLibRawRecoveryWasmV2 } from './libraw-wasm-instance-v2.ts';

const scope = globalThis as unknown as {
	onmessage: ((event: Readonly<{ data: unknown }>) => void) | null;
	postMessage(message: unknown, transfer: Transferable[]): void;
};
const TYPED = Object.getPrototypeOf(Uint8Array.prototype) as object;
const BUFFER = Object.getOwnPropertyDescriptor(TYPED, 'buffer')!.get!;
const LENGTH = Object.getOwnPropertyDescriptor(TYPED, 'byteLength')!.get!;
const OFFSET = Object.getOwnPropertyDescriptor(TYPED, 'byteOffset')!.get!;
const RESIZABLE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'resizable')?.get;
let admitted = false;
scope.onmessage = event => {
	if (admitted) return; admitted = true;
	let input: Uint8Array<ArrayBuffer> | undefined, output: ArrayBuffer | undefined, response: unknown;
	try {
		const candidate: unknown = typeof event.data === 'object' && event.data !== null ? Object.getOwnPropertyDescriptor(event.data, 'bytes')?.value : undefined;
		if (candidate instanceof Uint8Array && Object.getPrototypeOf(candidate) === Uint8Array.prototype) {
			const physical = Reflect.apply(BUFFER, candidate, []) as ArrayBuffer;
			if (physical instanceof ArrayBuffer && (!RESIZABLE || Reflect.apply(RESIZABLE, physical, []) !== true) && physical.byteLength <= 64 * 1024 * 1024) {
				input = new Uint8Array(physical);
			}
		}
		const request = record(event.data, 'LibRaw recovery worker request', ['schemaVersion', 'kind', 'profile', 'module', 'bytes']);
		const bytes = field(request, 'bytes', 'LibRaw recovery worker request'), module = field(request, 'module', 'LibRaw recovery worker request');
		if (!(bytes instanceof Uint8Array) || Object.getPrototypeOf(bytes) !== Uint8Array.prototype) throw new TypeError('Recovery worker requires native transferred bytes.');
		const buffer = Reflect.apply(BUFFER, bytes, []) as ArrayBuffer, length = Number(Reflect.apply(LENGTH, bytes, []));
		if (!(buffer instanceof ArrayBuffer) || (RESIZABLE && Reflect.apply(RESIZABLE, buffer, []) === true) || buffer.byteLength > 64 * 1024 * 1024) {
			throw new RangeError('Recovery worker requires fixed bounded private input.');
		}
		input = new Uint8Array(buffer);
		for (const name of ['buffer', 'byteLength', 'byteOffset', 'length']) if (Object.hasOwn(bytes, name)) throw new TypeError('Recovery input may not shadow its native geometry.');
		if (length < 1 || Reflect.apply(OFFSET, bytes, []) !== 0 || length !== buffer.byteLength
			|| field(request, 'schemaVersion', 'LibRaw recovery worker request') !== 2 || field(request, 'kind', 'LibRaw recovery worker request') !== 'recovery'
			|| !(module instanceof WebAssembly.Module)) throw new TypeError('Recovery worker requires its closed ABI2 request and exact input.');
		const profile = field(request, 'profile', 'LibRaw recovery worker request');
		if (profile !== 'linear-headroom-v1' && profile !== 'highlight-recovery-v1') throw new RangeError('Unsupported fixed RAW recovery profile.');
		const view = decodeLibRawRecoveryWasmV2(module, input, profile); output = view.frame.pixels.buffer;
		response = { schemaVersion: 2, kind: 'recovery', ...view };
	} catch (error) {
		let message = 'LibRaw recovery native operation failed.';
		try {
			const detail: unknown = typeof error === 'object' && error !== null ? Object.getOwnPropertyDescriptor(error, 'message')?.value : undefined;
			if (typeof detail === 'string' && detail.length <= 1024) message = detail;
		} catch { /* Opaque errors never become coercion or accessor authority. */ }
		response = { schemaVersion: 2, kind: 'error', error: { name: 'Error', message } };
	}
	// The instance destroyed its decoder and wiped the entire Wasm heap. Retire
	// the worker's private encoded input before transferring any owned Float32.
	input?.fill(0);
	try { scope.postMessage(response, output ? [output] : []); }
	catch (error) { if (output && output.byteLength) new Uint8Array(output).fill(0); throw error; }
};
