/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createFramescaperWebVcrRuntimeV1,
	type FramescaperWebVcrElectronWindow,
} from '../desktop/framescaper-web-vcr-runtime.ts';
import type { WebVcrSnapshot } from '../desktop/framescaper-web-vcr-contract.ts';
import type { FramescaperWebVcrResolvedTargetObservationV1 } from '../desktop/framescaper-web-vcr-target-observer.ts';

export function runtime(options: {
	readonly qualified?: boolean;
	readonly clearFailure?: boolean;
	readonly openFailure?: boolean;
	readonly fenceFailure?: boolean;
	readonly deferFence?: boolean;
} = {}) {
	let nowMs = 1_000;
	let nextId = 1;
	const windows: ReturnType<typeof fakeWindow>[] = [];
	const windowOptions: unknown[] = [];
	const events: string[] = [];
	let observerStarts = 0;
	let observerDisposals = 0;
	const recordingTokens: Array<string | null> = [];
	let resolveFence: (() => void) | null = null;
	let failNextLoad = options.openFailure ?? false;
	let observeTarget: ((value: Readonly<FramescaperWebVcrResolvedTargetObservationV1>) => void) | null = null;
	const snapshots: Readonly<WebVcrSnapshot>[] = [];
	const browserSession = {
		clearAuthCache: async () => { events.push('clear-auth'); },
		clearCache: async () => { events.push('clear-cache'); },
		clearStorageData: async () => {
			events.push('clear-storage');
			if (options.clearFailure) throw new Error('clear storage failed');
		},
	};
	const createWindow = (value: unknown): FramescaperWebVcrElectronWindow => {
		windowOptions.push(value);
		const created = fakeWindow(`window-${String(windows.length + 1)}`, events, failNextLoad);
		failNextLoad = false;
		windows.push(created);
		return created;
	};
	const value = createFramescaperWebVcrRuntimeV1({
		productId: 'framescaper',
		qualified: options.qualified ?? true,
		now: () => nowMs,
		createOpaqueId: () => (nextId++).toString(16).padStart(32, '0'),
		createWindow,
		browserSession,
		createTargetObserver: (observerOptions) => {
			observeTarget = observerOptions.onObservation;
			return {
				start: async () => { observerStarts += 1; },
				setRecordingToken: async (token) => {
					recordingTokens.push(token);
					if (options.fenceFailure && token !== null) throw new Error('recording fence failed');
					if (options.deferFence && token !== null) {
						await new Promise<void>((resolve) => { resolveFence = resolve; });
					}
				},
				dispose: () => { observerDisposals += 1; },
			};
		},
		emitSnapshot: (_owner, snapshot) => { snapshots.push(snapshot); },
	});
	return {
		value,
		windows,
		windowOptions,
		events,
		recordingTokens,
		snapshots,
		observe: (observation: Readonly<FramescaperWebVcrResolvedTargetObservationV1>) => {
			if (!observeTarget) throw new Error('observer is unavailable');
			observeTarget(observation);
		},
		createWindow,
		advance: (milliseconds: number) => { nowMs += milliseconds; },
		resolveFence: () => {
			if (!resolveFence) throw new Error('recording fence is not pending');
			const resolve = resolveFence;
			resolveFence = null;
			resolve();
		},
		get observerStarts() { return observerStarts; },
		get observerDisposals() { return observerDisposals; },
	};
}

export function referenceFor(value: Readonly<{ sessionId: string | null; generation: number }>) {
	if (!value.sessionId) throw new Error('session reference missing');
	return { version: 1 as const, sessionId: value.sessionId, generation: value.generation };
}

export function target(
	identity: string,
	mediaState: 'playing' | 'paused' | 'ended',
	aperture: Readonly<{ x: number; y: number; width: number; height: number }>,
) {
	return Object.freeze({
		targetId: identity.repeat(32), generation: 1, mediaState, aperture,
		intrinsicSize: { width: 1920, height: 1080 },
	});
}

export function targetIdentity(
	value: Readonly<{ targetId: string; generation: number; mediaState: 'playing' | 'paused' | 'ended' }>,
	mediaState: 'playing' | 'paused' | 'ended' = value.mediaState,
) {
	return Object.freeze({ targetId: value.targetId, generation: value.generation, mediaState });
}

function fakeWindow(name: string, events: string[], failLoad = false) {
	const windowListeners = new Map<string, Set<(...args: unknown[]) => void>>();
	const contentListeners = new Map<string, Set<(...args: unknown[]) => void>>();
	let openHandler: ((value: Readonly<{ readonly url: string }>) => Readonly<Record<string, unknown>>) | null = null;
	const value = {
		name,
		destroyed: false,
		failNextLoad: failLoad,
		redirectNextTo: null as string | null,
		loaded: [] as string[],
		input: [] as unknown[],
		audioMuted: [] as boolean[],
		webContents: {
			mainFrame: { name: `${name}-frame` },
			debugger: {} as never,
			navigationHistory: {
				canGoBack: () => false, canGoForward: () => false,
				goBack: () => undefined, goForward: () => undefined,
			},
			getURL: () => value.loaded.at(-1) ?? 'about:blank',
			reload: () => undefined,
			setAudioMuted: (muted: boolean) => { value.audioMuted.push(muted); },
			sendInputEvent: (event: unknown) => { value.input.push(event); },
			setWindowOpenHandler: (handler: typeof openHandler) => { openHandler = handler; },
			on: (event: string, listener: (...args: unknown[]) => void) => add(contentListeners, event, listener),
			removeListener: (event: string, listener: (...args: unknown[]) => void) => {
				contentListeners.get(event)?.delete(listener);
			},
		},
		isDestroyed: () => value.destroyed,
		destroy: () => {
			if (value.destroyed) return;
			value.destroyed = true;
			events.push(`destroy:${name}`);
		},
		loadURL: async (url: string) => {
			for (const listener of contentListeners.get('did-start-navigation') ?? []) {
				listener({}, url, false, true, 1, 1);
			}
			if (value.failNextLoad) {
				value.failNextLoad = false;
				throw new Error('guest load failed');
			}
			const committedUrl = value.redirectNextTo ?? url;
			value.redirectNextTo = null;
			value.loaded.push(committedUrl);
			if (committedUrl !== url) {
				for (const listener of contentListeners.get('did-navigate') ?? []) {
					listener({}, committedUrl, 200, 'OK');
				}
			}
		},
		on: (event: string, listener: (...args: unknown[]) => void) => add(windowListeners, event, listener),
		removeListener: (event: string, listener: (...args: unknown[]) => void) => {
			windowListeners.get(event)?.delete(listener);
		},
		openWindow(url: string) {
			if (!openHandler) throw new Error('window-open handler missing');
			return openHandler({ url }) as Readonly<{
				action: 'allow' | 'deny'; overrideBrowserWindowOptions?: unknown;
			}>;
		},
		createPopup(window: FramescaperWebVcrElectronWindow, url: string) {
			for (const listener of contentListeners.get('did-create-window') ?? []) listener(window, { url });
		},
		emitContent(name: string, ...args: unknown[]) {
			for (const listener of contentListeners.get(name) ?? []) listener(...args);
		},
	};
	return value;
}

function add(
	values: Map<string, Set<(...args: unknown[]) => void>>,
	name: string,
	listener: (...args: unknown[]) => void,
) {
	let listeners = values.get(name);
	if (!listeners) { listeners = new Set(); values.set(name, listeners); }
	listeners.add(listener);
}
