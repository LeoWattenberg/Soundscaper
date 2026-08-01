/* SPDX-License-Identifier: AGPL-3.0-only */

import { createBrowserFfmpegRuntimeStore } from './browser-runtime-store.ts';
import {
	installLatestFfmpegRuntime,
	type InstallLatestFfmpegRuntimeOptions,
	type InstallLatestFfmpegRuntimeResult,
	type VerifiedRuntimeRelease,
	type VerifiedRuntimeStore,
} from './ffmpeg-runtime-cache.ts';

export const DEFAULT_FFMPEG_RUNTIME_POINTER_URL =
	'https://assets.soundscaper.org/runtime/ffmpeg/0.12.10/latest.json';

export type BrowserFfmpegRuntimeStatus =
	| Readonly<{ status: 'unsupported' }>
	| Readonly<{ status: 'not-installed' }>
	| Readonly<{ status: 'ready'; release: VerifiedRuntimeRelease }>;

export interface BrowserFfmpegRuntimeInstallOptions {
	readonly signal?: AbortSignal;
	readonly onProgress?: InstallLatestFfmpegRuntimeOptions['onProgress'];
}

export interface BrowserFfmpegRuntimeManager {
	read(): Promise<BrowserFfmpegRuntimeStatus>;
	install(options?: BrowserFfmpegRuntimeInstallOptions): Promise<InstallLatestFfmpegRuntimeResult>;
	resolveCoreBaseUrl(fallbackBaseUrl: string): Promise<string>;
}

type RuntimeInstaller = (
	options: InstallLatestFfmpegRuntimeOptions,
) => Promise<InstallLatestFfmpegRuntimeResult>;

export interface BrowserFfmpegRuntimeManagerOptions {
	readonly createStore?: () => VerifiedRuntimeStore | null;
	readonly fetchImpl?: typeof fetch;
	readonly installLatest?: RuntimeInstaller;
	readonly pointerUrl?: string | URL;
}

/** Web-only facade over the verified two-version runtime store. */
export function createBrowserFfmpegRuntimeManager(
	options: BrowserFfmpegRuntimeManagerOptions = {},
): BrowserFfmpegRuntimeManager {
	const createStore = options.createStore ?? (() => createBrowserFfmpegRuntimeStore());
	const installLatest = options.installLatest ?? installLatestFfmpegRuntime;
	let initialized = false;
	let runtimeStore: VerifiedRuntimeStore | null = null;

	function store(): VerifiedRuntimeStore | null {
		if (initialized) return runtimeStore;
		initialized = true;
		try {
			runtimeStore = createStore();
		} catch {
			runtimeStore = null;
		}
		return runtimeStore;
	}

	async function read(): Promise<BrowserFfmpegRuntimeStatus> {
		const activeStore = store();
		if (!activeStore) return Object.freeze({ status: 'unsupported' });
		const release = await activeStore.readActive();
		return release
			? Object.freeze({ status: 'ready', release })
			: Object.freeze({ status: 'not-installed' });
	}

	async function install(
		installOptions: BrowserFfmpegRuntimeInstallOptions = {},
	): Promise<InstallLatestFfmpegRuntimeResult> {
		const activeStore = store();
		if (!activeStore) throw new Error('Browser CacheStorage is unavailable for the FFmpeg runtime.');
		return installLatest({
			pointerUrl: options.pointerUrl ?? DEFAULT_FFMPEG_RUNTIME_POINTER_URL,
			store: activeStore,
			...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
			...(installOptions.signal ? { signal: installOptions.signal } : {}),
			...(installOptions.onProgress ? { onProgress: installOptions.onProgress } : {}),
		});
	}

	async function resolveCoreBaseUrl(fallbackBaseUrl: string): Promise<string> {
		const fallback = normalizeBaseUrl(fallbackBaseUrl);
		try {
			const status = await read();
			return status.status === 'ready' ? normalizeBaseUrl(status.release.baseUrl) : fallback;
		} catch {
			return fallback;
		}
	}

	return Object.freeze({ read, install, resolveCoreBaseUrl });
}

function normalizeBaseUrl(value: string): string {
	const normalized = String(value).replace(/\/+$/u, '');
	if (!normalized) throw new TypeError('FFmpeg core base URL is required.');
	return normalized;
}
