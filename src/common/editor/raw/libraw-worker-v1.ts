/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from '../closed-domain-value.ts';
import { decodeLibRawOriginalWasmV1, decodeLibRawWasmV1, readLibRawEmbeddedPreviewWasmV1 } from './libraw-wasm-instance-v1.ts';

const scope = globalThis as unknown as {
	onmessage: ((event: Readonly<{ data: unknown }>) => void) | null;
	postMessage(message: unknown, transfer: Transferable[]): void;
};
let admitted = false;
const RESIZABLE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'resizable')?.get;
scope.onmessage = event => {
	if (admitted) return; admitted = true;
	let input: Uint8Array<ArrayBuffer> | undefined;
	let response: unknown, output: ArrayBuffer | undefined;
	try {
		const request = record(event.data, 'LibRaw worker request', ['schemaVersion', 'kind', 'module', 'bytes']);
		const bytes = field(request, 'bytes', 'LibRaw worker request'), module = field(request, 'module', 'LibRaw worker request');
		if (!(bytes instanceof Uint8Array) || Object.getPrototypeOf(bytes) !== Uint8Array.prototype || !(bytes.buffer instanceof ArrayBuffer)
			|| (RESIZABLE && Reflect.apply(RESIZABLE, bytes.buffer, []) === true) || bytes.byteOffset !== 0 || bytes.byteLength !== bytes.buffer.byteLength) throw new TypeError('LibRaw worker requires its private transferred input.');
		const admittedInput = new Uint8Array(bytes.buffer, 0, bytes.byteLength); input = admittedInput;
		if (field(request, 'schemaVersion', 'LibRaw worker request') !== 1 || !(module instanceof WebAssembly.Module)) throw new TypeError('LibRaw worker requires its audited compiled module.');
		const kind = field(request, 'kind', 'LibRaw worker request');
		if (kind === 'decode') {
			const frame = decodeLibRawWasmV1(module, admittedInput); output = frame.pixels.buffer;
			response = { schemaVersion: 1, kind: 'frame', frame };
		} else if (kind === 'original') {
			const original = decodeLibRawOriginalWasmV1(module, admittedInput); output = original.frame.pixels.buffer;
			response = { schemaVersion: 1, kind: 'original', frame: original.frame, rawFlip: original.rawFlip };
		} else if (kind === 'preview') {
			const preview = readLibRawEmbeddedPreviewWasmV1(module, admittedInput); output = preview?.bytes.buffer;
			response = { schemaVersion: 1, kind: 'preview', preview };
		} else throw new RangeError('Unsupported LibRaw worker request.');
	} catch (error) {
		let message = 'LibRaw native operation failed.';
		try {
			const detail: unknown = typeof error === 'object' && error !== null ? Object.getOwnPropertyDescriptor(error, 'message')?.value : undefined;
			if (typeof detail === 'string' && detail.length <= 1024) message = detail;
		} catch { /* Foreign error values never become property/coercion authority. */ }
		response = { schemaVersion: 1, kind: 'error', error: { name: 'Error', message } };
	}
	// The native scope already destroyed and wiped its heap; wipe the received
	// private input too before making any output visible outside this worker.
	input?.fill(0);
	try { scope.postMessage(response, output ? [output] : []); }
	catch (error) { if (output && output.byteLength) new Uint8Array(output).fill(0); throw error; }
};
