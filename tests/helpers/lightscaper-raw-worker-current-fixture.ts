/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { build } from 'esbuild';
import type { LibRawWorkerPortV1 } from '../../src/common/editor/raw/libraw-runtime-v1.ts';

type EventType = Parameters<LibRawWorkerPortV1['addEventListener']>[0];
type Listener = Parameters<LibRawWorkerPortV1['addEventListener']>[1];
let bundled: Promise<string> | undefined;

function workerProgram(): Promise<string> {
	if (bundled) return bundled;
	bundled = (async () => {
		const output = await build({ entryPoints: [fileURLToPath(new URL('../../src/common/editor/raw/libraw-worker-v1.ts', import.meta.url))],
			bundle: true, write: false, format: 'iife', platform: 'browser', target: 'es2023', sourcemap: 'inline' });
		assert.equal(output.outputFiles.length, 1); const script = output.outputFiles[0]; assert.ok(script);
		// Only Web Worker transport is adapted. The bundled production worker,
		// actual WebAssembly.Module, native C ABI and all image bytes stay real.
		return `const { parentPort } = require('node:worker_threads');
globalThis.onmessage = null;
globalThis.postMessage = (message, transfer) => parentPort.postMessage(message, transfer);
parentPort.on('message', data => {
	if (typeof globalThis.onmessage !== 'function') throw new Error('Actual RAW worker did not install its native message handler.');
	globalThis.onmessage({ data });
});
${script.text}`;
	})();
	return bundled;
}

/** No output directory, temporary file, decoder replacement or worker fake.
 * Tests can assert actual thread termination has joined before consumption. */
export async function rawWorkerFixtureV1() {
	const script = await workerProgram(), active = new Map<LibRawWorkerPortV1, Worker>();
	const events: string[] = [], statistics = { created: 0, posts: 0, messages: 0, terminations: 0, joined: 0, exits: 0 };
	function createWorker(): LibRawWorkerPortV1 {
		const native = new Worker(script, { eval: true }), listeners = new Map<EventType, Set<Listener>>();
		statistics.created++; events.push('created'); let retirement: Promise<number> | undefined;
		const emit = (type: EventType, data?: unknown) => { for (const listener of [...listeners.get(type) ?? []]) listener({ data }); };
		const port: LibRawWorkerPortV1 = {
			postMessage(message, transfer) {
				assert.equal(this, port); statistics.posts++; events.push('post'); native.postMessage(message, transfer as readonly ArrayBuffer[]);
			},
			addEventListener(type, listener) {
				assert.equal(this, port); const owned = listeners.get(type) ?? new Set<Listener>(); owned.add(listener); listeners.set(type, owned);
			},
			removeEventListener(type, listener) { assert.equal(this, port); listeners.get(type)?.delete(listener); },
			terminate() {
				assert.equal(this, port);
				if (retirement) return retirement;
				statistics.terminations++; events.push('terminate');
				retirement = native.terminate().then(code => { statistics.joined++; events.push('joined'); active.delete(port); return code; });
				return retirement;
			},
		};
		active.set(port, native);
		native.on('message', (value: unknown) => { statistics.messages++; events.push('message'); emit('message', value); });
		native.on('error', error => { events.push('error'); emit('error', error); });
		native.on('messageerror', (error: unknown) => { events.push('messageerror'); emit('messageerror', error); });
		native.once('exit', () => { statistics.exits++; events.push('exit'); });
		return port;
	}
	return { createWorker, events, statistics, active: () => active.size,
		async close() {
			const results = await Promise.allSettled([...active.keys()].map(port => port.terminate()));
			const errors = results.flatMap(result => result.status === 'rejected' ? [result.reason as unknown] : []);
			if (errors.length) throw new AggregateError(errors, 'Actual RAW worker fixture cleanup failed.');
		},
	};
}
