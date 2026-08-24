/* SPDX-License-Identifier: AGPL-3.0-only */

/** Bounded one-request/one-answer control transport for an isolated native child. */

import type { ChildProcess } from 'node:child_process';
import type { Readable, Writable } from 'node:stream';

const MAGIC = Buffer.from('M5F1');
const HEADER_BYTES = 8;
const MAXIMUM_CONTROL_BYTES = 1024 * 1024;

export interface NativeChildFramedControlBinding {
	readonly protocolVersion: 1;
	readonly maximumMessageBytes: number;
	readonly maximumInFlightMessages: number;
}

export interface NativeChildFramedControl {
	send(bytes: Uint8Array): Promise<void>;
	receive(): Promise<Uint8Array>;
}

export interface NativeChildProcessCompletion {
	readonly exitCode: number;
	readonly signal: NodeJS.Signals | null;
	readonly stdout: string;
	readonly stderr: string;
}

export function bindNativeChildProcess(
	child: ChildProcess,
	binding: NativeChildFramedControlBinding | null,
): Readonly<{
	readonly control: NativeChildFramedControl | null;
	readonly completion: Promise<NativeChildProcessCompletion>;
}> {
	let terminalError: Error | null = null;
	const refuse = (error: Error) => {
		if (terminalError) return;
		terminalError = error;
		child.kill('SIGKILL');
	};
	const stderr = boundedText(child.stderr, 'stderr', refuse);
	const framed = binding === null ? null : framedControl(child, binding, refuse);
	const stdout = framed === null ? boundedText(child.stdout, 'stdout', refuse) : null;
	const completion = new Promise<NativeChildProcessCompletion>((resolve, reject) => {
		child.once('error', (error) => { terminalError ??= error; });
		child.once('close', (code, signal) => {
			framed?.closed();
			void Promise.all([stdout?.value() ?? '', stderr.value()]).then(
				([stdoutValue, stderrValue]) => terminalError ? reject(terminalError) : resolve(Object.freeze({
					exitCode: code ?? 128, signal, stdout: stdoutValue, stderr: stderrValue,
				})),
				reject,
			);
		});
	});
	return Object.freeze({ control: framed?.control ?? null, completion });
}

function framedControl(
	child: ChildProcess,
	bindingValue: NativeChildFramedControlBinding,
	refuse: (error: Error) => void,
) {
	const binding = framedBinding(bindingValue);
	const input = child.stdin;
	const output = child.stdout;
	if (!input || !output) throw new Error('A framed isolated child requires stdin and stdout pipes.');
	let buffered = Buffer.alloc(0);
	let ended = false;
	let outstanding = 0;
	let writeTail = Promise.resolve();
	const queued: Buffer[] = [];
	const readers: Array<Readonly<{ resolve: (value: Uint8Array) => void; reject: (error: Error) => void }>> = [];
	const fail = (error: Error) => {
		if (ended) return;
		ended = true;
		for (const reader of readers.splice(0)) reader.reject(error);
		refuse(error);
	};
	const publish = (bytes: Buffer): boolean => {
		if (outstanding < 1) {
			fail(new Error('The isolated child sent an unsolicited framed answer.'));
			return false;
		}
		outstanding -= 1;
		const reader = readers.shift();
		if (reader) reader.resolve(new Uint8Array(bytes));
		else if (queued.length < binding.maximumInFlightMessages) queued.push(bytes);
		else {
			fail(new Error('The isolated child exceeded its framed answer window.'));
			return false;
		}
		return true;
	};
	const parse = (chunk: Buffer) => {
		if (ended) return;
		buffered = Buffer.concat([buffered, Buffer.from(chunk)]);
		if (buffered.byteLength > (binding.maximumMessageBytes + HEADER_BYTES)
			* binding.maximumInFlightMessages) {
			return fail(new Error('The isolated child framed answer is oversized.'));
		}
		while (buffered.byteLength >= HEADER_BYTES) {
			if (!buffered.subarray(0, MAGIC.byteLength).equals(MAGIC)) {
				return fail(new Error('The isolated child framed answer has an invalid preamble.'));
			}
			const length = buffered.readUInt32LE(MAGIC.byteLength);
			if (length < 1 || length > binding.maximumMessageBytes) {
				return fail(new Error('The isolated child framed answer length is invalid.'));
			}
			if (buffered.byteLength < HEADER_BYTES + length) return;
			if (!publish(Buffer.from(buffered.subarray(HEADER_BYTES, HEADER_BYTES + length)))) return;
			buffered = buffered.subarray(HEADER_BYTES + length);
		}
	};
	output.on('data', parse);
	output.once('error', fail);
	output.once('end', () => {
		if (!ended && buffered.byteLength !== 0) fail(new Error('The isolated child ended inside a framed answer.'));
	});
	const control = Object.freeze({
		send: async (value: Uint8Array) => {
			const bytes = ordinaryBytes(value, binding.maximumMessageBytes);
			if (ended) throw new Error('The isolated child framed control is closed.');
			if (outstanding >= binding.maximumInFlightMessages) {
				throw new Error('The isolated child framed request window is exhausted.');
			}
			outstanding += 1;
			const frame = Buffer.allocUnsafe(HEADER_BYTES + bytes.byteLength);
			MAGIC.copy(frame); frame.writeUInt32LE(bytes.byteLength, MAGIC.byteLength); bytes.copy(frame, HEADER_BYTES);
			const write = writeTail.then(() => writeBytes(input, frame)).catch((error: unknown) => {
				outstanding -= 1;
				throw error;
			});
			writeTail = write.catch(() => undefined);
			await write;
		},
		receive: async () => {
			const available = queued.shift();
			if (available) return new Uint8Array(available);
			if (ended) throw new Error('The isolated child framed control is closed.');
			return new Promise<Uint8Array>((resolve, reject) => { readers.push(Object.freeze({ resolve, reject })); });
		},
	});
	return Object.freeze({
		control,
		closed: () => {
			if (ended) return;
			ended = true;
			for (const reader of readers.splice(0)) reader.reject(new Error('The isolated child framed control closed.'));
		},
	});
}

function boundedText(stream: Readable | null, label: string, refuse: (error: Error) => void) {
	let bytes = Buffer.alloc(0);
	let error: Error | null = stream ? null : new Error(`The isolated child has no ${label} pipe.`);
	if (error) refuse(error);
	stream?.on('data', (chunk: Buffer) => {
		if (error) return;
		bytes = Buffer.concat([bytes, Buffer.from(chunk)]);
		if (bytes.byteLength > MAXIMUM_CONTROL_BYTES) {
			error = new Error(`The isolated child ${label} is oversized.`);
			refuse(error);
		}
	});
	return Object.freeze({
		value: async () => {
			if (error) throw error;
			return bytes.toString('utf8');
		},
	});
}

function framedBinding(value: NativeChildFramedControlBinding) {
	if (!value || Object.getPrototypeOf(value) !== Object.prototype
		|| JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([
			'maximumInFlightMessages', 'maximumMessageBytes', 'protocolVersion',
		]) || value.protocolVersion !== 1 || !Number.isSafeInteger(value.maximumMessageBytes)
		|| value.maximumMessageBytes < 1 || value.maximumMessageBytes > 16 * 1024 ** 2
		|| !Number.isSafeInteger(value.maximumInFlightMessages)
		|| value.maximumInFlightMessages < 1 || value.maximumInFlightMessages > 8) {
		throw new TypeError('A closed bounded native child frame binding is required.');
	}
	return Object.freeze({ ...value });
}

function ordinaryBytes(value: Uint8Array, maximum: number): Buffer {
	if (!(value instanceof Uint8Array) || value.byteLength < 1 || value.byteLength > maximum
		|| (typeof SharedArrayBuffer !== 'undefined' && value.buffer instanceof SharedArrayBuffer)) {
		throw new TypeError('A native child control message must carry bounded ordinary bytes.');
	}
	return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
}

function writeBytes(stream: Writable, bytes: Buffer): Promise<void> {
	return new Promise((resolve, reject) => {
		stream.write(bytes, (error) => { if (error) reject(error); else resolve(); });
	});
}
