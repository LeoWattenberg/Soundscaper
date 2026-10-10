/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ReadCapabilityStore } from '../../desktop/file-capabilities.js';
import { IPC, MAX_READ_CAPABILITIES_PER_OWNER } from '../../desktop/constants.js';
import { registerFileCapabilityIpc } from '../../desktop/main-file-capability-ipc.mjs';
import { OriginalFileOverwriteStore } from '../../desktop/original-file-overwrite.ts';
import { cleanReadCapabilityDisplayName } from '../../desktop/read-capability-support.js';
import { createProtocolHandler } from '../../desktop/protocol.js';
import { AtomicSaveManager, SaveTargetStore } from '../../desktop/save-targets.js';
import { acceptsFile } from '../../desktop/validation.js';

/** Retain real chooser, selected-range read and writable original authority, with no injected project state. */
export async function nativeOriginalImportFixture(file: File) {
	const directory = await mkdtemp(join(tmpdir(), 'soundscaper-native-original-'));
	const path = join(directory, file.name);
	await writeFile(path, new Uint8Array(await file.arrayBuffer()));
	const owner = {};
	const reads = new ReadCapabilityStore();
	const targets = new SaveTargetStore();
	const originals = new OriginalFileOverwriteStore({ reads, targets, acceptsFile,
		cleanDisplayName: cleanReadCapabilityDisplayName, maximumCount: MAX_READ_CAPABILITIES_PER_OWNER });
	const saves = new AtomicSaveManager({ targets } as never);
	const choices: unknown[] = [], selections: unknown[] = [], completed: unknown[] = [], operations: string[] = [];
	const handlers = new Map<string, (event: unknown, value: unknown) => unknown>();
	registerFileCapabilityIpc({ channels: IPC,
		desktopSmokeProbe: { resolveOpenPaths: () => null, resolveSavePath: async () => null },
		dialog: {
			showOpenDialog: async (_window: unknown, request: unknown) => {
				choices.push(request); return { canceled: false, filePaths: [path] };
			},
			showSaveDialog: async () => ({ canceled: true, filePath: '' }),
		},
		handle: (channel: string, listener: (event: unknown, value: unknown) => unknown) => { handlers.set(channel, listener); },
		opaqueId: (value: unknown) => String(value ?? ''), ownerFor: () => owner,
		pendingOpenProjects: { dispatch: async () => undefined }, readCapabilities: reads, saves,
		saveTargets: targets, originalFiles: originals, windowFor: () => null,
	});
	const invoke = async (channel: string, value: unknown) => {
		operations.push(channel);
		const handler = handlers.get(channel); assert.ok(handler); return await handler({}, value);
	};
	const protocol = createProtocolHandler({ productId: 'soundscaper', rendererRoot: directory,
		runtimeRoot: directory, readCapabilities: reads });
	return {
		choices, selections, completed, operations,
		savedBytes: async () => await readFile(path),
		bridge: {
			chooseFiles: async (request: unknown) => {
				const selected: unknown = await invoke(IPC.chooseFiles, request); selections.push(selected); return selected;
			},
			releaseRead: async (id: string) => await invoke(IPC.releaseRead, id),
			releaseOriginalFile: async (id: string) => await invoke(IPC.releaseOriginalFile, id),
			prepareOriginalOverwrite: async (id: string) => await invoke(IPC.prepareOriginalOverwrite, id),
			beginWrite: async (request: unknown) => await invoke(IPC.beginWrite, request),
			writeChunk: async (request: unknown) => await invoke(IPC.writeChunk, request),
			finishWrite: async (id: string) => {
				const result: unknown = await invoke(IPC.finishWrite, id); completed.push(result); return result;
			},
			abortWrite: async (id: string) => await invoke(IPC.abortWrite, id),
		},
		fetch: async (url: string, options?: RequestInit) => await protocol(new Request(url, options)),
		close: async () => {
			originals.dispose(); await reads.dispose(); await saves.dispose(); targets.dispose();
			await rm(directory, { recursive: true, force: true });
		},
	};
}
