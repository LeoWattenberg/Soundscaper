/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, open, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ReadCapabilityStore } from '../../desktop/file-capabilities.js';
import { registerFileCapabilityIpc } from '../../desktop/main-file-capability-ipc.mjs';
import { createProtocolHandler } from '../../desktop/protocol.js';
import { AtomicSaveManager, SaveTargetStore } from '../../desktop/save-targets.js';

const CHANNELS = Object.freeze({
	chooseFiles: 'files:choose', releaseRead: 'files:release', chooseSaveTarget: 'save:choose',
	beginWrite: 'save:begin', writeChunk: 'save:chunk', patchFinalPrefix: 'save:prefix',
	finishWrite: 'save:finish', abortWrite: 'save:abort',
});

export async function nativeSidecarFixture(name: string, text: string | Uint8Array, options: Readonly<{ saveName?: string; cancelSave?: boolean }> = {}) {
	const directory = await mkdtemp(join(tmpdir(), 'framescaper-native-sidecar-'));
	const path = join(directory, name);
	await writeFile(path, text);
	const owner = {};
	const reads = new ReadCapabilityStore();
	const targets = new SaveTargetStore();
	const saveOptions = { targets, openImpl: open };
	const saves = new AtomicSaveManager(saveOptions);
	const savePath = options.saveName ? join(directory, options.saveName) : null;
	const calls: unknown[] = [];
	const saveChoices: unknown[] = [];
	const releases: string[] = [];
	const handlers = new Map<string, (event: unknown, value: unknown) => unknown>();
	registerFileCapabilityIpc({
		channels: CHANNELS,
		desktopSmokeProbe: { resolveOpenPaths: () => null, resolveSavePath: async () => null },
		dialog: {
			showOpenDialog: async (_window: unknown, options: unknown) => {
				calls.push(options);
				return { canceled: false, filePaths: [path] };
			},
			showSaveDialog: async (_window: unknown, request: unknown) => {
				saveChoices.push(request);
				return { canceled: options.cancelSave === true || savePath === null, filePath: savePath ?? '' };
			},
		},
		handle: (channel: string, listener: (event: unknown, value: unknown) => unknown) => {
			handlers.set(channel, listener);
		},
		opaqueId: (value: unknown) => String(value ?? ''), ownerFor: () => owner,
		pendingOpenProjects: { dispatch: async () => undefined }, readCapabilities: reads, saves,
		saveTargets: targets, windowFor: () => null,
	});
	const choose = handlers.get(CHANNELS.chooseFiles);
	const release = handlers.get(CHANNELS.releaseRead);
	assert.ok(choose);
	assert.ok(release);
	const invokeSave = async (channel: keyof typeof CHANNELS, value: unknown): Promise<unknown> => {
		const listener = handlers.get(CHANNELS[channel]);
		assert.ok(listener); return await listener({}, value);
	};
	const protocol = createProtocolHandler({
		productId: 'framescaper', rendererRoot: directory, runtimeRoot: directory,
		readCapabilities: reads,
	});
	const bridge = {
		chooseFiles: async (request: unknown): Promise<unknown> => await choose({}, request),
		releaseRead: async (id: string): Promise<unknown> => {
			releases.push(id);
			return await release({}, id);
		},
		...(savePath ? {
			chooseSaveTarget: async (value: unknown) => await invokeSave('chooseSaveTarget', value),
			beginWrite: async (value: unknown) => await invokeSave('beginWrite', value),
			writeChunk: async (value: unknown) => await invokeSave('writeChunk', value),
			patchFinalPrefix: async (value: unknown) => await invokeSave('patchFinalPrefix', value),
			finishWrite: async (value: unknown) => await invokeSave('finishWrite', value),
			abortWrite: async (value: unknown) => await invokeSave('abortWrite', value),
		} : {}),
	};
	return {
		bridge, calls, saveChoices, releases,
		savedBytes: async () => savePath ? await readFile(savePath) : null,
		fetch: async (url: string, options?: RequestInit): Promise<Response> =>
			await protocol(new Request(url, options)),
		close: async (): Promise<void> => {
			await reads.dispose();
			await saves.dispose(); targets.dispose();
			await rm(directory, { recursive: true, force: true });
		},
	};
}
