/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Reading a video source's timing out of what FFmpeg prints about it.
 *
 * The probe's whole answer lives in the log: `showinfo` states each frame's
 * presentation time, and the banner states the characteristics no filter
 * reports — pixel aspect, colour range, rotation — in the same run. It is
 * therefore the one operation whose exit code says almost nothing, and the
 * reason the runtime lease has to hand back logs at all.
 *
 * A `File` is mounted through WORKERFS where the runtime offers it, so a large
 * source is read as the browser holds it rather than copied into MEMFS first.
 * Every path the operation created is removed on the way out, mounted or not.
 */

import { isFfmpegSourceCharacteristicsLog, parseFfmpegVideoSourceCharacteristics } from './ffmpeg-video-source-characteristics.ts';
import {
	buildFfmpegVideoTimingProbeArgs,
	parseFfmpegVideoTimingLogs,
} from './ffmpeg-video-timing-probe.ts';
import type { VideoTimingProbeResult } from './video-timing-probe.ts';

type Awaitable<Value> = PromiseLike<Value> | Value;

export interface FfmpegVideoTimingProbeOptions {
	readonly file: Blob;
	readonly signal?: AbortSignal;
	run<Output>(operation: (instance: never) => Awaitable<Output>, beforeLoad?: () => void): Promise<Output>;
	terminateRuntime(): void;
	workerFsType(): unknown;
}

export async function probeFfmpegVideoTiming(
	options: FfmpegVideoTimingProbeOptions,
): Promise<VideoTimingProbeResult> {
	if (!(options.file instanceof Blob)) throw new TypeError('Expected a video Blob for timing probe.');
	const signal = options.signal;
	if (signal?.aborted) throw signal.reason ?? abortError();
	const file = options.file;
	const run = options.run as unknown as (
		operation: (instance: RawInstance) => Promise<VideoTimingProbeResult>,
		beforeLoad?: () => void,
	) => Promise<VideoTimingProbeResult>;
	const terminateRuntime = options.terminateRuntime;
	return run(async (instance) => {
		if (signal?.aborted) throw signal.reason ?? abortError();
		const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
		const mountPoint = `/editor-probe-${stamp}`;
		let input = `editor-probe-${stamp}`;
		let mounted = false;
		const logs: string[] = [];
		// The banner states the characteristics no filter reports, and it arrives in
		// the run the timing probe already pays for.
		const handleLog = ({ message = '' }: { message?: string }) => {
			if (typeof message === 'string' && (message.includes('showinfo')
				|| message.includes('config in time_base:') || isFfmpegSourceCharacteristicsLog(message))) {
				logs.push(message);
			}
		};
		const onAbort = () => terminateRuntime();
		instance.on('log', handleLog);
		signal?.addEventListener('abort', onAbort, { once: true });
		try {
			const workerFsType = options.workerFsType();
			if (typeof File !== 'undefined' && file instanceof File && workerFsType) {
				const inputName = safeFfmpegFileName(file.name, `video-${stamp}`);
				await instance.createDir(mountPoint);
				await instance.mount(workerFsType, {
					blobs: [{ name: inputName, data: file }],
				}, mountPoint);
				input = `${mountPoint}/${inputName}`;
				mounted = true;
			} else {
				await instance.writeFile(input, new Uint8Array(await file.arrayBuffer()), { signal });
			}
			const code = await instance.exec(buildFfmpegVideoTimingProbeArgs(input), -1, { signal });
			if (code !== 0) throw new Error(`FFmpeg timing probe exited with code ${code}.`);
			const timing = parseFfmpegVideoTimingLogs(logs);
			const rate = timing.nominalRate;
			return { ...timing, characteristics: parseFfmpegVideoSourceCharacteristics(logs, { rate }) };
		} finally {
			signal?.removeEventListener('abort', onAbort);
			try { instance.off('log', handleLog); } catch {}
			if (mounted) {
				await instance.unmount(mountPoint).catch(() => undefined);
				await instance.deleteDir(mountPoint).catch(() => undefined);
			} else await instance.deleteFile(input).catch(() => undefined);
		}
	}, () => {
		if (signal?.aborted) throw signal.reason ?? abortError();
	});
}

interface RawInstance {
	createDir(path: string): Promise<unknown>;
	mount(type: unknown, options: unknown, path: string): Promise<unknown>;
	unmount(path: string): Promise<unknown>;
	deleteDir(path: string): Promise<unknown>;
	deleteFile(path: string): Promise<unknown>;
	writeFile(path: string, data: Uint8Array, options?: unknown): Promise<unknown>;
	exec(arguments_: readonly string[], timeout?: number, options?: unknown): Promise<number>;
	on(event: string, listener: (entry: { message?: string }) => void): unknown;
	off(event: string, listener: (entry: { message?: string }) => void): unknown;
}

/** FFmpeg reads a mounted file under its own name, so a hostile one is flattened. */
function safeFfmpegFileName(value: string, fallback: string): string {
	const normalized = String(value || '').replaceAll('\0', '-').replace(/[\\/]/gu, '-');
	return normalized || fallback;
}

function abortError(): Error {
	return typeof DOMException === 'function'
		? new DOMException('The operation was aborted.', 'AbortError')
		: Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' });
}
