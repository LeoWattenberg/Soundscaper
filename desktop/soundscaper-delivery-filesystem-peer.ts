/* SPDX-License-Identifier: AGPL-3.0-only */

/** One bounded SDF1 helper exchange. */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

import {
	awaitDeliveryFilesystemRequest,
	deliveryFilesystemRequestTimeout,
} from './soundscaper-delivery-filesystem-deadline.ts';
import {
	DELIVERY_FILESYSTEM_HEADER_BYTES as HEADER_BYTES,
	DELIVERY_FILESYSTEM_MAGIC as MAGIC,
	DELIVERY_FILESYSTEM_MAXIMUM_CONTROL_BYTES as MAXIMUM_CONTROL_BYTES,
	DELIVERY_FILESYSTEM_VERSION as VERSION,
	DeliveryFilesystemFrameReader,
	type DeliveryFilesystemFrame as Frame,
} from './soundscaper-delivery-filesystem-frame-reader.ts';

export const MAXIMUM_CHUNK_BYTES = 4 * 1024 * 1024;
const ERROR = 0xff;

export const OP = Object.freeze({
	init: 0x01, data: 0x02, seal: 0x03, publish: 0x04, abort: 0x05, patch: 0x06, recover: 0x07,
	inspectFinal: 0x08,
	ready: 0x81, acknowledged: 0x82, sealed: 0x83, published: 0x84, aborted: 0x85,
	recovered: 0x87, finalInspection: 0x88,
});

export type SpawnProcess = typeof spawn;

export class FramedPeer {
	readonly #child: ChildProcessWithoutNullStreams;
	readonly #reader: DeliveryFilesystemFrameReader;
	readonly #requestTimeoutMs: number | null;
	readonly #decodeProcessError: (payload: Buffer) => Error;
	#requestId = 0;
	#closed = false;
	#failed = false;

	constructor(
		child: ChildProcessWithoutNullStreams,
		requestTimeoutMs: number | null,
		decodeProcessError: (payload: Buffer) => Error,
	) {
		this.#child = child;
		this.#reader = new DeliveryFilesystemFrameReader(child.stdout);
		this.#requestTimeoutMs = requestTimeoutMs;
		this.#decodeProcessError = decodeProcessError;
		child.once('error', (error) => { this.#failed = true; this.#reader.fail(error); });
	}

	async request(opcode: number, payload: Buffer, expectedOpcode: number): Promise<unknown> {
		if (this.#closed) throw new Error('Soundscaper delivery filesystem helper is closed.');
		if (this.#failed) throw new Error('Soundscaper delivery filesystem helper has failed.');
		if (payload.byteLength > (opcode === OP.data ? MAXIMUM_CHUNK_BYTES : MAXIMUM_CONTROL_BYTES)) {
			throw new RangeError('Soundscaper delivery filesystem helper payload is too large.');
		}
		const requestId = ++this.#requestId;
		const exchange = (async () => {
			await writeFrame(this.#child, { opcode, requestId, payload });
			return this.#reader.read();
		})();
		try {
			const response = await awaitDeliveryFilesystemRequest(
				exchange,
				deliveryFilesystemRequestTimeout(
					opcode === OP.data || opcode === OP.patch || opcode === OP.seal || opcode === OP.publish,
					this.#requestTimeoutMs,
				),
				(error) => this.#fail(error),
			);
			if (response.requestId !== requestId) throw new Error('Soundscaper delivery helper response lost synchronization.');
			if (response.opcode === ERROR) throw this.#decodeProcessError(response.payload);
			if (response.opcode !== expectedOpcode) throw new Error('Soundscaper delivery helper returned the wrong response.');
			return response.payload.byteLength ? parseJson(response.payload) : Object.freeze({});
		} catch (error) {
			this.#fail(error instanceof Error ? error : new Error(String(error)));
			throw error;
		}
	}

	#fail(error: Error): void {
		if (this.#failed) return;
		this.#failed = true;
		this.#reader.fail(error);
		try { this.#child.kill('SIGKILL'); } catch { /* process never spawned */ }
	}

	async close(): Promise<void> {
		if (this.#closed) return;
		this.#closed = true;
		this.#child.stdin.end();
		if (this.#failed) {
			try { this.#child.kill(); } catch { /* process never spawned */ }
			return;
		}
		if (this.#child.exitCode === null && this.#child.signalCode === null) {
			await new Promise<void>((resolve) => {
				const timer = setTimeout(() => { this.#child.kill(); resolve(); }, 2_000);
				timer.unref?.();
				this.#child.once('exit', () => { clearTimeout(timer); resolve(); });
			});
		}
	}
}

export function startPeer(
	spawnProcess: SpawnProcess,
	executablePath: string,
	args: string[],
	requestTimeoutMs: number | null,
	decodeProcessError: (payload: Buffer) => Error,
): FramedPeer {
	const child = spawnProcess(executablePath, args, {
		stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
	});
	let stderrBytes = 0;
	child.stderr.on('data', (chunk: Buffer) => {
		stderrBytes += chunk.byteLength;
		if (stderrBytes > MAXIMUM_CONTROL_BYTES) child.stderr.destroy();
	});
	return new FramedPeer(child, requestTimeoutMs, decodeProcessError);
}

async function writeFrame(child: ChildProcessWithoutNullStreams, frame: Frame): Promise<void> {
	const header = Buffer.alloc(HEADER_BYTES);
	MAGIC.copy(header, 0);
	header[4] = VERSION;
	header[5] = frame.opcode;
	header.writeUInt16BE(0, 6);
	header.writeUInt32BE(frame.requestId, 8);
	header.writeUInt32BE(frame.payload.byteLength, 12);
	const value = Buffer.concat([header, frame.payload]);
	if (child.stdin.write(value)) return;
	await new Promise<void>((resolve, reject) => {
		const cleanup = () => { child.stdin.off('drain', drained); child.stdin.off('error', failed); };
		const drained = () => { cleanup(); resolve(); };
		const failed = (error: Error) => { cleanup(); reject(error); };
		child.stdin.once('drain', drained);
		child.stdin.once('error', failed);
	});
}

export function parseJson(value: Buffer): unknown {
	try { return JSON.parse(value.toString('utf8')); }
	catch { throw new Error('Soundscaper delivery helper returned invalid JSON.'); }
}
