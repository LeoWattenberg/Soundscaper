/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	TrimMediaFfmpegHost,
	TrimMediaFfmpegRuntime,
} from './controller/document/trim-media-service.ts';

type DisposableTrimMediaRuntime = TrimMediaFfmpegHost & Readonly<{ dispose(): void }>;

export interface LazyBrowserTrimMediaRuntimeOptions extends Readonly<Record<string, unknown>> {
	readonly createTrimMediaRuntime?: () => PromiseLike<DisposableTrimMediaRuntime> | DisposableTrimMediaRuntime;
}

/** Keep the browser's large FFmpeg runtime outside startup and ordinary audio work. */
export function createLazyBrowserTrimMediaRuntime(
	options: LazyBrowserTrimMediaRuntimeOptions,
	disposedError: () => Error,
): TrimMediaFfmpegHost & Readonly<{ dispose(): void }> {
	let loading: Promise<DisposableTrimMediaRuntime> | null = null;
	let loaded: DisposableTrimMediaRuntime | null = null;
	let retired: DisposableTrimMediaRuntime | null = null;
	let disposed = false;

	const load = async (): Promise<DisposableTrimMediaRuntime> => {
		if (disposed) throw disposedError();
		const pending = loading ??= Promise.resolve().then(
			options.createTrimMediaRuntime ?? (() => createDefaultRuntime(options)),
		);
		let runtime: DisposableTrimMediaRuntime;
		try {
			runtime = await pending;
		} catch (error) {
			if (loading === pending) loading = null;
			throw error;
		}
		loaded = runtime;
		if (!disposed) return runtime;
		retire(runtime);
		throw disposedError();
	};

	const retire = (runtime: DisposableTrimMediaRuntime): void => {
		if (retired === runtime) return;
		retired = runtime;
		runtime.dispose();
	};

	const runTrimMediaOperation = async <Output>(
		operation: (lease: TrimMediaFfmpegRuntime) => Promise<Output>,
		settings?: Readonly<{ signal?: AbortSignal }>,
	): Promise<Output> => (await load()).runTrimMediaOperation(operation, settings);

	return Object.freeze({
		runTrimMediaOperation,
		dispose() {
			if (disposed) return;
			disposed = true;
			if (loaded) retire(loaded);
			else if (loading) void loading.then(retire, () => undefined);
		},
	});
}

async function createDefaultRuntime(
	options: LazyBrowserTrimMediaRuntimeOptions,
): Promise<DisposableTrimMediaRuntime> {
	const { createEditorFfmpeg } = await import('./ffmpeg.js');
	const onLoading = typeof options.onLoading === 'function' ? options.onLoading as () => void : null;
	const onProgress = typeof options.onProgress === 'function'
		? options.onProgress as (progress: number, time: number) => void : null;
	return createEditorFfmpeg({
		...(onLoading ? { onLoading } : {}),
		...(onProgress ? { onProgress } : {}),
	});
}
