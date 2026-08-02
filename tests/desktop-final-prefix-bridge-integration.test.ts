/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

import { IPC } from '../desktop/constants.js';
import { AtomicSaveManager, SaveTargetStore } from '../desktop/save-targets.js';
import { openDirectPcmDestination } from '../src/common/editor/controller/direct-pcm-export.ts';
import { createDesktopPreparedSave } from '../src/common/editor/file-save-stream.ts';

const OWNER = Object.freeze({ name: 'bridge-integration-owner' });
const PREFIX_BYTES = 32;
type DesktopBridge = Parameters<typeof createDesktopPreparedSave>[0]['bridge'];

test('VM preload bridges a sealed direct save through final-prefix patch and atomic commit', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-prefix-bridge-'));
	const destinationPath = join(root, 'integrated.wav');
	const targets = new SaveTargetStore({ randomBytesImpl: (size) => Buffer.alloc(size, 0xaa) });
	const managerOptions = {
		targets,
		randomBytesImpl: (size: number) => Buffer.alloc(size, 0xbb),
	};
	const manager = new AtomicSaveManager(managerOptions);
	context.after(async () => {
		await manager.dispose();
		await rm(root, { recursive: true, force: true });
	});
	const target = targets.registerPath(destinationPath, { owner: OWNER, purpose: 'audio-pcm-mix' });
	assert.equal(target.id, 'aa'.repeat(24));
	let writeId = '';
	const bridge = await loadPreloadBridge(async (channel, value) => {
		const request = value as Readonly<Record<string, unknown>>;
		switch (channel) {
			case IPC.beginWrite: {
				const admission = await manager.begin({
					owner: OWNER,
					targetId: request.targetId,
					size: request.size,
					maximumSize: request.maximumSize,
					finalPrefixByteLength: request.finalPrefixByteLength,
				});
				writeId = admission.writeId;
				return admission;
			}
			case IPC.writeChunk:
				return manager.writeChunk({ owner: OWNER, ...request });
			case IPC.patchFinalPrefix:
				return manager.patchFinalPrefix({ owner: OWNER, ...request });
			case IPC.finishWrite:
				return manager.finish(value as string, { owner: OWNER });
			case IPC.abortWrite:
				return manager.abort(value as string, { owner: OWNER });
			default:
				throw new Error(`Unexpected preload IPC channel: ${channel}`);
		}
	});
	const prepared = createDesktopPreparedSave({
		bridge,
		fileName: target.name,
		target,
	});
	const plannedBytes = 40;
	const opened = await openDirectPcmDestination(
		prepared,
		plannedBytes,
		'WAV',
		'exact',
		{ finalPrefixByteLength: PREFIX_BYTES },
	);
	assert.ok(opened.destination);
	const body = new Uint8Array(plannedBytes);
	body.set([41, 42, 43, 44, 45, 46, 47, 48], PREFIX_BYTES);
	await opened.destination.write(body.subarray(0, 17));
	await opened.destination.write(body.subarray(17));
	await opened.destination.close();
	const prefix = Uint8Array.from({ length: PREFIX_BYTES }, (_value, index) => index + 1);
	await opened.destination.patchFinalPrefix!(prefix);
	assert.equal(writeId, 'bb'.repeat(16));
	assert.equal(opened.destination.bytesWritten(), plannedBytes);
	assert.deepEqual(await opened.destination.commit(), {
		method: 'desktop',
		fileName: 'integrated.wav',
		size: plannedBytes,
	});
	const saved = await readFile(destinationPath);
	assert.equal(saved.byteLength, plannedBytes);
	assert.deepEqual([...saved], [...prefix, 41, 42, 43, 44, 45, 46, 47, 48]);
});

async function loadPreloadBridge(
	invoke: (channel: string, value?: unknown) => Promise<unknown>,
): Promise<DesktopBridge> {
	let bridge: DesktopBridge | undefined;
	const source = await readFile(new URL('../desktop/preload.mjs', import.meta.url), 'utf8');
	vm.runInNewContext(source, {
		ArrayBuffer, Object, Promise, RangeError, String, TypeError, Uint8Array, URL,
		require: () => ({
			contextBridge: {
				exposeInMainWorld(name: string, value: Readonly<{ v1: DesktopBridge }>) {
					if (name === 'scapeDesktop') bridge = value.v1;
				},
			},
			ipcRenderer: { invoke, send: () => undefined, on: () => undefined, removeListener: () => undefined },
		}),
	});
	if (!bridge) throw new Error('Sandbox preload did not expose its v1 bridge');
	return bridge;
}
