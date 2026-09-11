/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { assistanceElectronEventPort } from '../desktop/assistance-electron-data-port.ts';
import { receiveHelperDataPlaneFile, sendHelperDataPlaneFile } from '../desktop/helper-data-plane-io.ts';
import type { HelperDataPlaneBinding } from '../desktop/helper-data-plane.ts';

class ElectronPort extends EventEmitter {
	peer: ElectronPort | null = null;
	started = false;
	closed = false;
	postMessage(message: unknown, transfer: readonly unknown[] = []): void {
		assert.equal(transfer.length, 0, 'MessagePortMain accepts transferred ports, never ArrayBuffers');
		const data: unknown = structuredClone(message);
		queueMicrotask(() => { this.peer?.emit('message', { data }); });
	}
	start(): void { this.started = true; }
	close(): void { this.closed = true; }
}

test('assistance Electron output clones exact bytes with authenticated bounded acknowledgements', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'assistance-electron-port-'));
	const original = Buffer.from('nonempty native inference output for renderer review');
	const main = new ElectronPort(), renderer = new ElectronPort();
	main.peer = renderer;
	renderer.peer = main;
	const port = assistanceElectronEventPort({ ports: [main] });
	assert.ok(port);
	const binding: HelperDataPlaneBinding = { dataPlaneVersion: 1, transport: 'message-port',
		streamId: 'a'.repeat(40), direction: 'helper-to-host', byteLength: original.byteLength,
		sha256: createHash('sha256').update(original).digest('hex'),
		maximumChunkBytes: 7, maximumInFlightChunks: 1 };
	try {
		const source = join(directory, 'source.bin'), destination = join(directory, 'received.bin');
		await writeFile(source, original);
		await Promise.all([
			receiveHelperDataPlaneFile({ path: destination, binding, port: renderer,
				signal: AbortSignal.timeout(2_000) }),
			sendHelperDataPlaneFile({ path: source, binding, port }),
		]);
		assert.deepEqual(await readFile(destination), original);
		assert.equal(main.started, true);
		assert.equal(main.closed, true);
		assert.equal(main.listenerCount('message'), 0);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test('assistance Electron port admission closes extras and malformed candidates', () => {
	const first = new ElectronPort(), second = new ElectronPort();
	assert.equal(assistanceElectronEventPort({ ports: [first, second] }), null);
	assert.equal(first.closed, true);
	assert.equal(second.closed, true);
	let closed = false;
	assert.equal(assistanceElectronEventPort({ ports: [{ close() { closed = true; } }] }), null);
	assert.equal(closed, true);
	assert.equal(assistanceElectronEventPort(null), null);
	assert.equal(assistanceElectronEventPort({ ports: [] }), null);
});
