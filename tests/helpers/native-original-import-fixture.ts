/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { readDesktopPreloadSource } from './desktop-preload-source.mjs';
import { ReadCapabilityStore } from '../../desktop/file-capabilities.js';
import { IPC, MAX_READ_CAPABILITIES_PER_OWNER } from '../../desktop/constants.js';
import { registerFileCapabilityIpc } from '../../desktop/main-file-capability-ipc.mjs';
import { OriginalFileOverwriteStore } from '../../desktop/original-file-overwrite.ts';
import { cleanReadCapabilityDisplayName } from '../../desktop/read-capability-support.js';
import { createProtocolHandler } from '../../desktop/protocol.js';
import { AtomicSaveManager, SaveTargetStore } from '../../desktop/save-targets.js';
import { acceptsFile } from '../../desktop/validation.js';

interface NativeOriginalBridge {
	chooseFiles(request: unknown): Promise<unknown>;
	releaseRead(request: unknown): Promise<unknown>;
	releaseOriginalFile(request: unknown): Promise<unknown>;
	prepareOriginalOverwrite(request: unknown): Promise<unknown>;
	releaseSaveTarget?(request: unknown): Promise<unknown>;
	beginWrite(request: unknown): Promise<unknown>;
	writeChunk(request: unknown): Promise<unknown>;
	finishWrite(request: unknown): Promise<unknown>;
	abortWrite(request: unknown): Promise<unknown>;
}
type Preparation = Readonly<{ id: string; name: string }>;

/** Retain the packaged preload, real chooser, selected-range read and writable original authority. */
export async function nativeOriginalImportFixture(file: File, options: {
	maximumTargets?: number;
	holdPreparationAt?: number;
} = {}) {
	const directory = await mkdtemp(join(tmpdir(), 'soundscaper-native-original-'));
	const path = join(directory, file.name);
	await writeFile(path, new Uint8Array(await file.arrayBuffer()));
	const owner = {};
	const reads = new ReadCapabilityStore();
	const targets = new SaveTargetStore({ maximumTargets: options.maximumTargets });
	const originals = new OriginalFileOverwriteStore({ reads, targets, acceptsFile,
		cleanDisplayName: cleanReadCapabilityDisplayName, maximumCount: MAX_READ_CAPABILITIES_PER_OWNER });
	const saves = new AtomicSaveManager({ targets } as never);
	const choices: unknown[] = [], selections: unknown[] = [], completed: unknown[] = [], operations: string[] = [];
	const prepared: Preparation[] = [], releases: unknown[] = [];
	let completePreparation: (() => void) | undefined;
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
		opaqueId: (value: unknown, size: number) => {
			assert.equal(typeof value, 'string');
			assert.match(String(value), new RegExp(`^[a-f0-9]{${String(size)}}$`, 'u'));
			return String(value);
		}, ownerFor: (event: { owner?: object }) => event.owner ?? owner,
		pendingOpenProjects: { dispatch: async () => undefined }, readCapabilities: reads, saves,
		saveTargets: targets, originalFiles: originals, windowFor: () => null,
	});
	// The host bootstrap is independent of file authority; keep its ordinary Linux environment response.
	handlers.set(IPC.environment, () => ({ platform: process.platform, arch: process.arch,
		version: 'test', development: false, locale: 'en', supportedLocales: ['en'],
		runtimeVersions: { node: process.versions.node }, capabilities: { displayAudio: false, updates: false },
	}));
	const invoke = async (channel: string, value: unknown, otherOwner = false) => {
		operations.push(channel);
		const handler = handlers.get(channel); assert.ok(handler);
		const result: unknown = await handler(otherOwner ? { owner: {} } : {}, value);
		if (channel === IPC.chooseFiles) selections.push(result);
		if (channel === IPC.finishWrite) completed.push(result);
		if (channel === 'soundscaper:v1:save:release-target') releases.push(result);
		if (channel === IPC.prepareOriginalOverwrite) {
			assert.ok(result && typeof result === 'object' && 'id' in result && 'name' in result);
			assert.equal(typeof result.id, 'string'); assert.equal(typeof result.name, 'string');
			prepared.push(result as Preparation);
			if (prepared.length === options.holdPreparationAt) await new Promise<void>((resolve) => { completePreparation = resolve; });
		}
		return result;
	};
	const preloadSource = await readDesktopPreloadSource();
	let bridge: NativeOriginalBridge | undefined;
	vm.runInNewContext(preloadSource, {
		ArrayBuffer, Object, Promise, RangeError, String, TypeError, Uint8Array, URL,
		require: () => ({
			contextBridge: { exposeInMainWorld: (name: string, value: { v1: NativeOriginalBridge }) => { if (name === 'scapeDesktop') bridge = value.v1; } },
			ipcRenderer: { invoke, send: () => {}, on: () => {}, removeListener: () => {} },
		}), process: { argv: [] },
	});
	assert.ok(bridge);
	const protocol = createProtocolHandler({ productId: 'soundscaper', rendererRoot: directory,
		runtimeRoot: directory, readCapabilities: reads });
	return {
		choices, selections, completed, operations, prepared, releases, preloadSource, invoke,
		completePreparation: () => { assert.ok(completePreparation); completePreparation(); },
		reserveNextTarget: () => targets.registerPath(join(directory, 'Next mix.wav'), { owner, purpose: 'audio' }),
		savedBytes: async () => await readFile(path),
		bridge,
		fetch: async (url: string, options?: RequestInit) => await protocol(new Request(url, options)),
		close: async () => {
			originals.dispose(); await reads.dispose(); await saves.dispose(); targets.dispose();
			await rm(directory, { recursive: true, force: true });
		},
	};
}
