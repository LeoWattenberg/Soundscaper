/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { rm } from 'node:fs/promises';
import type { TestContext } from 'node:test';

import type { DesktopLibraryOwner } from '../../desktop/project-library-contract.ts';
import { DesktopSharedProjectLibraryService } from '../../desktop/project-library-editor-service.ts';
import { DesktopProjectLibraryHost } from '../../desktop/project-library-host.ts';
import type { EngineChunkReadValue } from '../../src/common/editor/engine/types.ts';
import {
	type AudioEditorProjectCurrent,
} from '../../src/common/editor/project-current.ts';
import { createProjectStore, type AudioEditorProjectStore } from '../../src/common/editor/storage.js';
import type { DesktopSharedProjectBridge } from '../../src/common/editor/storage/desktop-shared-project-repository.ts';
import type { EditorController } from '../../src/common/editor/types.ts';
import { streamWavBlobPcm } from '../../src/common/editor/wav-import.js';

export interface BridgeProbe {
	readonly bodyReads: Array<Readonly<{ bindingId: string; length: number; offset: number }>>;
	readonly bridge: DesktopSharedProjectBridge;
}

export interface HeadlessEngineProbe {
	readonly engine: Readonly<Record<string, unknown>>;
	readonly project: () => AudioEditorProjectCurrent | null;
	readonly samplesFor: (sourceId: string) => readonly (readonly number[])[] | null;
	readonly state: () => 'paused' | 'playing' | 'stopped';
}

export interface ProjectActions {
	readonly prepareHandoff: () => Promise<Readonly<{ projectId: string; revision: number }>>;
}

export interface TransportActions {
	readonly playPause: () => PromiseLike<unknown> | unknown;
}

export interface ExportActions {
	readonly start: (settings?: Readonly<Record<string, unknown>>) => Promise<Readonly<{
		fileName?: string;
		mimeType?: string;
	}> | undefined>;
}

export function serviceBridge(service: DesktopSharedProjectLibraryService): BridgeProbe {
	const bodyReads: BridgeProbe['bodyReads'] = [];
	const bridge: DesktopSharedProjectBridge = {
		listSharedProjects: async () => service.listSharedProjects(),
		readSharedProject: (projectId: string) => service.readSharedProject(projectId),
		readSharedProjectBundle: (projectId: string) => service.readSharedProjectBundle(projectId),
		commitSharedProject: (request) => service.commitSharedProject(request),
		deleteSharedProject: (projectId: string) => service.deleteSharedProject(projectId),
		beginSharedSourceWrite: (value) => service.beginSharedSourceWrite(value),
		writeSharedSourceChunk: (value) => service.writeSharedSourceChunk(value),
		finishSharedSourceWrite: (value) => service.finishSharedSourceWrite(value),
		abortSharedSourceWrite: (writeId) => service.abortSharedSourceWrite(writeId),
		readSharedSourceChunk: (value) => {
			bodyReads.push(value);
			return service.readSharedSourceChunk(value.bindingId, {
				offset: value.offset,
				length: value.length,
			});
		},
	};
	return Object.freeze({
		bodyReads,
		bridge: Object.freeze(bridge),
	});
}

export function projectStore(databaseName: string, bridge: DesktopSharedProjectBridge) {
	return createProjectStore({
		databaseName,
		desktopProjectBridge: bridge,
		indexedDB: null,
		memoryFallback: true,
		preferOpfs: false,
	});
}

export async function writePcm(
	store: AudioEditorProjectStore,
	source: Readonly<{
		channelCount: number;
		chunkFrames: number;
		mimeType: string;
		name: string;
		sampleRate: number;
		storageKey: string;
	}>,
	channels: readonly (readonly number[])[],
): Promise<void> {
	const writer = await store.beginSourceWrite(source.storageKey, {
		name: source.name, mimeType: source.mimeType, sampleRate: source.sampleRate,
		channelCount: source.channelCount, chunkFrames: source.chunkFrames,
	});
	await writer.write(channels.map((channel) => Float32Array.from(channel)));
	await writer.commit({
		sampleRate: source.sampleRate,
		channelCount: source.channelCount,
		chunkFrames: source.chunkFrames,
	});
}

export async function readPcm(store: AudioEditorProjectStore, storageKey: string): Promise<number[][]> {
	const channels: number[][] = [];
	for await (const stored of store.readSourceChunks(storageKey)) {
		const chunkChannels = Array.isArray(stored) ? stored : stored.channels;
		for (const [index, channel] of chunkChannels.entries()) {
			channels[index] ??= [];
			channels[index]?.push(...channel);
		}
	}
	return channels;
}

export function createHeadlessEngine(): HeadlessEngineProbe {
	const appliedSources = new Map<string, readonly (readonly number[])[]>();
	let appliedProject: AudioEditorProjectCurrent | null = null;
	let state: 'paused' | 'playing' | 'stopped' = 'stopped';
	const capture = (project: unknown, buffers: unknown): void => {
		appliedProject = project as AudioEditorProjectCurrent;
		appliedSources.clear();
		if (!(buffers instanceof Map)) return;
		for (const [sourceId, buffer] of buffers) {
			if (typeof sourceId !== 'string' || !(buffer instanceof HeadlessAudioBuffer)) continue;
			appliedSources.set(sourceId, Object.freeze(Array.from(
				{ length: buffer.numberOfChannels },
				(_, channel) => Object.freeze([...buffer.getChannelData(channel)]),
			)));
		}
	};
	const engine = Object.freeze({
		setSourceResolver() { return this; },
		loadProject(project: unknown, buffers: unknown) { capture(project, buffers); },
		async applyProject(project: unknown, buffers: unknown) { capture(project, buffers); },
		async getAudioContext() {
			return Object.freeze({
				createBuffer: (channelCount: number, frameCount: number, sampleRate: number) => (
					new HeadlessAudioBuffer(channelCount, frameCount, sampleRate)
				),
			});
		},
		getPositionFrames() { return 0; },
		getState() { return Object.freeze({ state, loop: Object.freeze({ enabled: false }) }); },
		play() { state = 'playing'; },
		pause() { state = 'paused'; },
		stop() { state = 'stopped'; },
		seek(frame: number) { return Math.max(0, Math.round(frame)); },
		setLoop() {},
		async dispose() { state = 'stopped'; },
	});
	return Object.freeze({
		engine,
		project: () => appliedProject,
		samplesFor: (sourceId: string) => appliedSources.get(sourceId) ?? null,
		state: () => state,
	});
}

export function audioChunkChannels(value: EngineChunkReadValue): readonly Float32Array[] {
	if (Array.isArray(value)) return value as readonly Float32Array[];
	return (value as Readonly<{ channels: readonly Float32Array[] }>).channels;
}

export async function readWavPcm(blob: Blob): Promise<number[][]> {
	const channels: number[][] = [];
	await streamWavBlobPcm(blob, {
		onChunk(chunk: readonly Float32Array[]) {
			for (const [index, channel] of chunk.entries()) {
				channels[index] ??= [];
				channels[index]?.push(...channel);
			}
		},
	});
	return channels;
}

export class HeadlessAudioBuffer {
	readonly #channels: readonly Float32Array[];
	readonly length: number;
	readonly numberOfChannels: number;
	readonly sampleRate: number;

	constructor(numberOfChannels: number, length: number, sampleRate: number) {
		this.numberOfChannels = numberOfChannels;
		this.length = length;
		this.sampleRate = sampleRate;
		this.#channels = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
	}

	getChannelData(channel: number): Float32Array {
		const values = this.#channels[channel];
		if (!values) throw new RangeError('Headless audio-buffer channel is unavailable');
		return values;
	}

	copyToChannel(values: Float32Array, channel: number, offset = 0): void {
		this.getChannelData(channel).set(values, offset);
	}
}

export function canonicalPcmBytes(channels: readonly (readonly number[])[]): Uint8Array {
	const frameCount = channels[0]?.length ?? 0;
	const bytes = new Uint8Array(4 + frameCount * channels.length * Float32Array.BYTES_PER_ELEMENT);
	const view = new DataView(bytes.buffer);
	view.setUint32(0, frameCount, true);
	let offset = 4;
	for (const channel of channels) {
		for (const sample of channel) {
			view.setFloat32(offset, sample, true);
			offset += Float32Array.BYTES_PER_ELEMENT;
		}
	}
	return bytes;
}

export function digest(bytes: Uint8Array): string {
	return createHash('sha256').update(bytes).digest('hex');
}

export function owner(
	product: 'framescaper' | 'soundscaper',
	processId: number,
	instanceId: string,
): DesktopLibraryOwner {
	return Object.freeze({ product, processId, instanceId });
}

export function projectActions(controller: EditorController): ProjectActions {
	return controller.actions.project as unknown as ProjectActions;
}

export function exportActions(controller: EditorController): ExportActions {
	return controller.actions.export as unknown as ExportActions;
}

export function createDownloadFileService(
	downloads: Array<Readonly<{ blob: Blob; purpose?: unknown; suggestedName?: unknown }>>,
) {
	return Object.freeze({
		isDesktop: false,
		async createDownload(request: Readonly<{
			blob: Blob;
			purpose?: unknown;
			suggestedName?: unknown;
		}>) {
			downloads.push(request);
			return Object.freeze({
				url: null,
				fileName: request.suggestedName,
				method: 'test',
				async cleanup() {},
			});
		},
	});
}

export function trackResources(context: TestContext, appDataPath: string) {
	const controllers = new Set<EditorController>();
	const hosts = new Set<DesktopProjectLibraryHost>();
	const services = new Set<DesktopSharedProjectLibraryService>();
	const stores = new Set<AudioEditorProjectStore>();
	context.after(async () => {
		const failures: unknown[] = [];
		for (const controller of [...controllers].reverse()) try { await controller.dispose(); } catch (error) { failures.push(error); }
		for (const store of [...stores].reverse()) try { await store.close(); } catch (error) { failures.push(error); }
		for (const service of [...services].reverse()) try { await service.dispose(); } catch (error) { failures.push(error); }
		for (const host of [...hosts].reverse()) try { await host.close(); } catch (error) { failures.push(error); }
		try { await rm(appDataPath, { recursive: true, force: true }); } catch (error) { failures.push(error); }
		if (failures.length) throw new AggregateError(failures, 'Fallback handoff fixture cleanup failed');
	});
	return Object.freeze({
		trackController(controller: EditorController) { controllers.add(controller); return controller; },
		trackHost(host: DesktopProjectLibraryHost) { hosts.add(host); return host; },
		trackService(service: DesktopSharedProjectLibraryService) { services.add(service); return service; },
		trackStore(store: AudioEditorProjectStore) { stores.add(store); return store; },
		async startHost(ownerValue: DesktopLibraryOwner) {
			return this.trackHost(await DesktopProjectLibraryHost.start({
				appDataPath, owner: ownerValue, leaseTtlMs: 5_000, renewIntervalMs: 1_000,
			}));
		},
		async disposeController(controller: EditorController) { await controller.dispose(); controllers.delete(controller); },
		async closeHost(host: DesktopProjectLibraryHost) { await host.close(); hosts.delete(host); },
		async disposeService(service: DesktopSharedProjectLibraryService) { await service.dispose(); services.delete(service); },
		async closeStore(store: AudioEditorProjectStore) { await store.close(); stores.delete(store); },
	});
}
