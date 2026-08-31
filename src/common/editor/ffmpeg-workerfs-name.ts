/* SPDX-License-Identifier: AGPL-3.0-only */

/** Keep the mounted WORKERFS name identical to the path passed to FFmpeg. */
export function safeFfmpegWorkerFsName(value: unknown, fallback: string): string {
	const normalized = String(value || '').replaceAll('\0', '-').replace(/[\\/]/gu, '-');
	return normalized || fallback;
}
