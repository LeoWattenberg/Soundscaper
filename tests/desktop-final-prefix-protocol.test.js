import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

import { IPC } from '../desktop/constants.js';

const PREFIX_BYTES = 32;
const TARGET_ID = 'a'.repeat(48);
const WRITE_ID = 'b'.repeat(32);

test('desktop final-prefix IPC has a dedicated owner-derived, offset-free handler', async () => {
	assert.equal(IPC.patchFinalPrefix, 'soundscaper:v1:save:prefix');
	const source = await readFile(new URL('../desktop/main-file-capability-ipc.mjs', import.meta.url), 'utf8');
	const start = source.indexOf('handle(channels.patchFinalPrefix');
	const end = source.indexOf('\n\thandle(', start + 1);
	assert.ok(start >= 0, 'missing patchFinalPrefix handler');
	const handler = source.slice(start, end);
	assert.match(handler, /saves\.patchFinalPrefix/u);
	// The owner is read off the IPC event, never accepted from the renderer's payload.
	assert.match(handler, /owner: ownerFor\(event\)/u);
	assert.doesNotMatch(handler, /offset/u);
});

test('sandbox bridge admits only the fixed declared prefix contract', async () => {
	const calls = [];
	const bridge = await preloadBridge((channel, value) => {
		calls.push({ channel, value });
		return Promise.resolve(channel === IPC.patchFinalPrefix ? { byteLength: PREFIX_BYTES } : null);
	});
	await bridge.beginWrite({
		targetId: TARGET_ID,
		size: 64,
		finalPrefixByteLength: PREFIX_BYTES,
	});
	assert.deepEqual({ ...calls[0].value }, {
		targetId: TARGET_ID,
		size: 64,
		finalPrefixByteLength: PREFIX_BYTES,
	});
	assert.throws(
		() => bridge.beginWrite({ targetId: TARGET_ID, maximumSize: 64, finalPrefixByteLength: PREFIX_BYTES }),
		/exact-size save/u,
	);
	assert.throws(
		() => bridge.beginWrite({ targetId: TARGET_ID, size: 31, finalPrefixByteLength: PREFIX_BYTES }),
		/at least 32 bytes/u,
	);
	assert.throws(
		() => bridge.beginWrite({ targetId: TARGET_ID, size: 64, finalPrefixByteLength: 31 }),
		/exactly 32 bytes/u,
	);
	assert.equal(calls.length, 1, 'invalid declarations do not cross IPC');
});

test('sandbox bridge clones exact prefix bytes, strips offsets, and validates acknowledgement', async () => {
	const calls = [];
	const bridge = await preloadBridge((channel, value) => {
		calls.push({ channel, value });
		return Promise.resolve({ byteLength: 64 });
	});
	const source = new Uint8Array(PREFIX_BYTES).fill(7);
	const acknowledgement = await bridge.patchFinalPrefix({ writeId: WRITE_ID, bytes: source, offset: 99 });
	source.fill(0);
	assert.deepEqual({ ...acknowledgement }, { byteLength: 64 });
	assert.equal(Object.isFrozen(acknowledgement), true);
	assert.equal(calls[0].channel, IPC.patchFinalPrefix);
	assert.deepEqual(Object.keys(calls[0].value).sort(), ['bytes', 'writeId']);
	assert.equal(calls[0].value.writeId, WRITE_ID);
	assert.deepEqual([...calls[0].value.bytes], new Array(PREFIX_BYTES).fill(7));
	assert.throws(
		() => bridge.patchFinalPrefix({ writeId: WRITE_ID, bytes: new Uint8Array(PREFIX_BYTES - 1) }),
		/exactly 32 bytes/u,
	);
	assert.equal(calls.length, 1, 'invalid prefix bytes do not cross IPC');

	for (const byteLength of [-1, '64', PREFIX_BYTES - 1]) {
		const malformed = await preloadBridge(() => Promise.resolve({ byteLength }));
		await assert.rejects(
			malformed.patchFinalPrefix({ writeId: WRITE_ID, bytes: new Uint8Array(PREFIX_BYTES) }),
			/(non-negative safe integer|invalid final-prefix acknowledgement)/u,
		);
	}
});

async function preloadBridge(invoke) {
	let bridge;
	const source = await readFile(new URL('../desktop/preload.mjs', import.meta.url), 'utf8');
	vm.runInNewContext(source, {
		ArrayBuffer,
		Object,
		Promise,
		RangeError,
		String,
		TypeError,
		Uint8Array,
		URL,
		require: () => ({
			contextBridge: {
				exposeInMainWorld(name, value) {
					if (name === 'scapeDesktop') bridge = value.v1;
				},
			},
			ipcRenderer: { invoke, send: () => {}, on: () => {}, removeListener: () => {} },
		}),
	});
	return bridge;
}
