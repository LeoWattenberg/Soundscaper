/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizeRational, type RationalRate } from './timeline-time.ts';

interface FfmpegCfrInstance {
	createDir(path: string): Promise<void>;
	mount(type: unknown, options: unknown, path: string): Promise<void>;
	unmount(path: string): Promise<void>;
	deleteDir(path: string): Promise<void>;
	writeFile(path: string, bytes: Uint8Array, options?: unknown): Promise<void>;
	readFile(path: string, encoding?: unknown, options?: unknown): Promise<unknown>;
	deleteFile(path: string): Promise<void>;
	exec(args: readonly string[], timeout?: number, options?: unknown): Promise<number>;
}

export interface FfmpegCfrIngestOptions {
	readonly file: Blob;
	readonly rate: RationalRate;
	readonly run: <Value>(task: (instance: FfmpegCfrInstance) => PromiseLike<Value>) => Promise<Value>;
	readonly workerFsType: () => unknown;
	readonly terminateRuntime: () => void;
	readonly signal?: AbortSignal;
}

/** Materialize a genuine CFR MP4 before a source can claim conform-at-ingest timing. */
export async function conformFfmpegVideoToCfr(options: FfmpegCfrIngestOptions): Promise<Blob> {
	if (!(options.file instanceof Blob)) throw new TypeError('CFR ingest requires a video Blob.');
	const rate = normalizeRational(options.rate);
	if (rate.num <= 0) throw new RangeError('CFR ingest requires a positive rational rate.');
	throwIfAborted(options.signal);
	return options.run(async (instance) => {
		const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
		const mountPoint = `/editor-cfr-${stamp}`;
		const inputName = `input-${stamp}`;
		const output = `output-${stamp}.mp4`;
		let mounted = false;
		const onAbort = () => options.terminateRuntime();
		options.signal?.addEventListener('abort', onAbort, { once: true });
		try {
			const workerFsType = options.workerFsType();
			if (workerFsType) {
				await instance.createDir(mountPoint);
				await instance.mount(workerFsType, {
					blobs: [{ name: inputName, data: options.file }],
				}, mountPoint);
				mounted = true;
			} else {
				await instance.writeFile(inputName, new Uint8Array(await options.file.arrayBuffer()), {
					signal: options.signal,
				});
			}
			const input = mounted ? `${mountPoint}/${inputName}` : inputName;
			const code = await instance.exec([
				'-hide_banner', '-nostdin', '-i', input,
				'-map', '0:v:0', '-map', '0:a?',
				'-vf', `fps=fps=${String(rate.num)}/${String(rate.den)}`,
				'-fps_mode', 'cfr', '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
				'-c:a', 'aac', '-movflags', '+faststart', output,
			], -1, { signal: options.signal });
			throwIfAborted(options.signal);
			if (code !== 0) throw new Error(`FFmpeg CFR ingest exited with code ${String(code)}.`);
			const bytes = await instance.readFile(output, undefined, { signal: options.signal });
			if (!(bytes instanceof Uint8Array) || !bytes.byteLength) {
				throw new Error('FFmpeg CFR ingest returned no media bytes.');
			}
			return new Blob([Uint8Array.from(bytes).buffer], { type: 'video/mp4' });
		} finally {
			options.signal?.removeEventListener('abort', onAbort);
			await instance.deleteFile(output).catch(() => undefined);
			if (mounted) {
				await instance.unmount(mountPoint).catch(() => undefined);
				await instance.deleteDir(mountPoint).catch(() => undefined);
			} else await instance.deleteFile(inputName).catch(() => undefined);
		}
	});
}

function throwIfAborted(signal?: AbortSignal): void {
	if (!signal?.aborted) return;
	if (signal.reason !== undefined) throw signal.reason;
	throw new DOMException('CFR ingest was cancelled.', 'AbortError');
}
