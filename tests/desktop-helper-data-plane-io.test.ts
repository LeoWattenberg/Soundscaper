/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import type { HelperDataPlaneBinding } from '../desktop/helper-data-plane.ts';
import {
	receiveHelperDataPlaneFile,
	sendHelperDataPlaneFile,
	type HelperDataPlaneIoPort,
} from '../desktop/helper-data-plane-io.ts';

const BYTES = Buffer.from('bounded canonical plan bytes');

test('data-plane file IO preserves exact bytes with sequence, digest, and acknowledgement backpressure', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'framescaper-plane-'));
	try {
		const source = join(directory, 'source.bin');
		const destination = join(directory, 'destination.bin');
		await writeFile(source, BYTES);
		const [host, helper] = portPair();
		const transfer = binding('host-to-helper', BYTES, 5, 2);
		const received = receiveHelperDataPlaneFile({ binding: transfer, port: helper, path: destination });
		const sent = sendHelperDataPlaneFile({ binding: transfer, port: host, path: source });
		assert.deepEqual(await sent, completion(transfer));
		assert.deepEqual(await received, completion(transfer));
		assert.deepEqual(await readFile(destination), BYTES);
		assert.equal(host.maximumUnacknowledged, 1, 'the implementation uses strict one-chunk backpressure');
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test('tamper, reordering, oversize chunks, and early completion remove the partial spool', async () => {
	for (const message of [
		{
			dataPlaneVersion: 1, type: 'chunk', streamId: 'ab'.repeat(20), sequence: 1,
			offset: 0, bytes: new Uint8Array([1]),
		},
		{
			dataPlaneVersion: 1, type: 'chunk', streamId: 'ab'.repeat(20), sequence: 0,
			offset: 0, bytes: new Uint8Array(6),
		},
		{
			dataPlaneVersion: 1, type: 'complete', streamId: 'ab'.repeat(20),
			byteLength: BYTES.byteLength, sha256: digest(BYTES),
		},
	] as const) {
		const directory = await mkdtemp(join(tmpdir(), 'framescaper-plane-fault-'));
		try {
			const destination = join(directory, 'partial.bin');
			const [, helper] = portPair();
			const receive = receiveHelperDataPlaneFile({
				binding: binding('host-to-helper', BYTES, 5, 1), port: helper, path: destination,
			});
			helper.peer!.postMessage(message);
			await assert.rejects(receive);
			await assert.rejects(readFile(destination), /ENOENT/u);
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	}
});

test('abort propagates a typed cancellation and closes both stream ends', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'framescaper-plane-abort-'));
	try {
		const [, helper] = portPair();
		const abort = new AbortController();
		const receive = receiveHelperDataPlaneFile({
			binding: binding('host-to-helper', BYTES),
			port: helper,
			path: join(directory, 'partial.bin'),
			signal: abort.signal,
		});
		abort.abort();
		await assert.rejects(receive, (error: unknown) => (
			error instanceof Error && error.name === 'AbortError'
		));
		assert.equal(helper.closed, 1);
		assert.equal(helper.messages.some((message) => (
			typeOf(message) === 'cancel' && streamOf(message) === 'ab'.repeat(20)
		)), true);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

function binding(
	direction: HelperDataPlaneBinding['direction'],
	bytes = BYTES,
	maximumChunkBytes = 8,
	maximumInFlightChunks = 2,
): HelperDataPlaneBinding {
	return Object.freeze({
		dataPlaneVersion: 1, transport: 'message-port', streamId: 'ab'.repeat(20),
		direction, byteLength: bytes.byteLength, sha256: digest(bytes),
		maximumChunkBytes, maximumInFlightChunks,
	});
}

function completion(value: HelperDataPlaneBinding) {
	return { streamId: value.streamId, byteLength: value.byteLength, sha256: value.sha256 };
}

function digest(bytes: Uint8Array): string {
	return createHash('sha256').update(bytes).digest('hex');
}

class Port extends EventEmitter implements HelperDataPlaneIoPort {
	peer: Port | null = null;
	closed = 0;
	readonly messages: unknown[] = [];
	maximumUnacknowledged = 0;
	#unacknowledged = 0;

	postMessage(message: unknown): void {
		this.messages.push(message);
		if (typeOf(message) === 'chunk') {
			this.#unacknowledged += 1;
			this.maximumUnacknowledged = Math.max(this.maximumUnacknowledged, this.#unacknowledged);
		}
		if (typeOf(message) === 'ack') this.peer?.acknowledged();
		queueMicrotask(() => this.peer?.emit('message', { data: message }));
	}

	start(): void {}
	close(): void { this.closed += 1; }
	acknowledged(): void { this.#unacknowledged -= 1; }
}

function portPair(): readonly [Port, Port] {
	const left = new Port();
	const right = new Port();
	left.peer = right;
	right.peer = left;
	return [left, right] as const;
}

function typeOf(value: unknown): unknown {
	return value && typeof value === 'object' ? (value as { type?: unknown }).type : null;
}

function streamOf(value: unknown): unknown {
	return value && typeof value === 'object' ? (value as { streamId?: unknown }).streamId : null;
}
