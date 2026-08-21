/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	CapturePreviewLease,
	CaptureSourceEnumerateRequest,
	CaptureSourceOpenPreviewRequest,
	CaptureSourcePortV1,
	CaptureSourceProbeRequest,
} from '../platform/capture-source-port.ts';
import type {
	BrowserCaptureStream,
	BrowserCaptureTrack,
} from './framescaper-browser-capture-source.ts';
import type {
	FramescaperCaptureDisplaySelectionPort,
	FramescaperCaptureRecorder,
	FramescaperCaptureRecorderRequest,
} from './framescaper-capture-session-types.ts';
import type { FramescaperCaptureSourceAdapter } from './framescaper-capture-source-adapter-router.ts';

export interface FramescaperCaptureDesktopBridgeV1 {
	status(): PromiseLike<Readonly<{
		readonly version: 1;
		readonly available: boolean;
		readonly unavailableReason: string | null;
		readonly selectionMode: 'source-list' | 'system-picker' | 'unavailable';
		readonly systemAudio: 'windows-loopback' | 'unavailable';
	}>>;
	listSources(generation: number): PromiseLike<Readonly<{
		readonly generation: number;
		readonly sources: readonly Readonly<{
			readonly token: string;
			readonly name: string;
			readonly kind: 'screen' | 'window';
		}>[];
	}>>;
	grant(request: Readonly<{
		readonly generation: number;
		readonly roles: readonly ('camera' | 'microphone' | 'display' | 'system-audio')[];
		readonly sourceToken: string | null;
	}>): PromiseLike<unknown>;
	teardown(generation: number): PromiseLike<boolean>;
}

export interface FramescaperCaptureDesktopSelection {
	readonly port: FramescaperCaptureDisplaySelectionPort;
	status(): Promise<Readonly<{ readonly available: boolean; readonly systemAudio: boolean }>>;
	grantedGeneration(): number | null;
	teardown(generation: number): Promise<void>;
	dispose(): Promise<void>;
}

export interface FramescaperCaptureDeviceAdapterBinding {
	readonly desktop: Readonly<FramescaperCaptureDesktopSelection> | null;
	readonly adapter: Readonly<FramescaperCaptureSourceAdapter<BrowserCaptureStream, BrowserCaptureTrack>>;
}

export function createFramescaperCaptureDeviceAdapter(options: Readonly<{
	readonly sourcePort: CaptureSourcePortV1<BrowserCaptureStream, BrowserCaptureTrack>;
	readonly desktopBridge?: FramescaperCaptureDesktopBridgeV1 | null;
	createRecorder(request: FramescaperCaptureRecorderRequest<BrowserCaptureStream, BrowserCaptureTrack>):
		PromiseLike<FramescaperCaptureRecorder> | FramescaperCaptureRecorder;
}>): Readonly<FramescaperCaptureDeviceAdapterBinding> {
	const desktop = options.desktopBridge ? createDesktopCaptureSelection(options.desktopBridge) : null;
	return Object.freeze({
		desktop,
		adapter: Object.freeze({
			id: 'devices' as const,
			sourcePort: desktop ? wrapDesktopCaptureSource(options.sourcePort, desktop) : options.sourcePort,
			...(desktop ? { displaySelection: desktop.port } : {}),
			createRecorder: options.createRecorder,
		}),
	});
}

function createDesktopCaptureSelection(
	bridge: FramescaperCaptureDesktopBridgeV1,
): Readonly<FramescaperCaptureDesktopSelection> {
	let mode: 'source-list' | 'system-picker' = 'source-list';
	let systemAudio = false;
	let generation = 0;
	let inventoryGeneration: number | null = null;
	let currentGeneration: number | null = null;
	const port = Object.freeze({
		get mode() { return mode; },
		async listSources() {
			if (mode !== 'source-list') throw new Error('Desktop source listing is unavailable.');
			generation += 1;
			const listed = await bridge.listSources(generation);
			if (listed.generation !== generation) throw new Error('Desktop source inventory generation changed.');
			inventoryGeneration = generation;
			currentGeneration = generation;
			return listed.sources;
		},
		async authorize(request: Parameters<FramescaperCaptureDisplaySelectionPort['authorize']>[0]) {
			if (request.roles.includes('system-audio') && !systemAudio) {
				throw new Error('Desktop system audio is unavailable on this platform.');
			}
			const roles = systemAudio
				&& request.roles.includes('display')
				&& !request.roles.includes('system-audio')
				? Object.freeze([...request.roles, 'system-audio' as const])
				: request.roles;
			const usesInventory = mode === 'source-list' && request.roles.includes('display');
			const next = usesInventory ? inventoryGeneration : ++generation;
			if (!next) throw new Error('Choose a current desktop source before preview.');
			await bridge.grant({ ...request, roles, generation: next });
			inventoryGeneration = null;
			currentGeneration = next;
		},
	}) satisfies FramescaperCaptureDisplaySelectionPort;
	return Object.freeze({
		port,
		async status() {
			const value = await bridge.status();
			if (value.version !== 1 || !value.available
				|| (value.selectionMode !== 'source-list' && value.selectionMode !== 'system-picker')) {
				return Object.freeze({ available: false, systemAudio: false });
			}
			mode = value.selectionMode;
			systemAudio = value.systemAudio === 'windows-loopback';
			return Object.freeze({ available: true, systemAudio });
		},
		grantedGeneration: () => currentGeneration,
		async teardown(value: number) {
			await bridge.teardown(value);
			if (currentGeneration === value) currentGeneration = null;
		},
		async dispose() {
			if (currentGeneration !== null) await bridge.teardown(currentGeneration);
			currentGeneration = null;
			inventoryGeneration = null;
		},
	});
}

function wrapDesktopCaptureSource(
	source: CaptureSourcePortV1<BrowserCaptureStream, BrowserCaptureTrack>,
	desktop: FramescaperCaptureDesktopSelection,
): CaptureSourcePortV1<BrowserCaptureStream, BrowserCaptureTrack> {
	return Object.freeze({
		probe: (request: CaptureSourceProbeRequest) => source.probe({ ...request, embedded: false }),
		enumerate: (request: CaptureSourceEnumerateRequest) => source.enumerate(request),
		async openPreview(request: CaptureSourceOpenPreviewRequest) {
			const generation = desktop.grantedGeneration();
			if (generation === null) throw new Error('Desktop capture preview lacks a current grant.');
			let lease: CapturePreviewLease<BrowserCaptureStream, BrowserCaptureTrack>;
			try { lease = await source.openPreview(request); }
			catch (error) { await desktop.teardown(generation).catch(() => undefined); throw error; }
			let disposed = false;
			return Object.freeze({
				sources: lease.sources,
				async dispose() {
					if (disposed) return;
					disposed = true;
					try { await lease.dispose(); } finally { await desktop.teardown(generation); }
				},
			});
		},
	});
}
