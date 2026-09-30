/* SPDX-License-Identifier: AGPL-3.0-only */

/** Keep the mounted WORKERFS name identical to the path passed to FFmpeg. */
export function safeFfmpegWorkerFsName(value: unknown, fallback: string): string {
	const normalized = normalizeWorkerFsName(value);
	if (isWorkerFsFileName(normalized)) return normalized;
	const normalizedFallback = normalizeWorkerFsName(fallback);
	return isWorkerFsFileName(normalizedFallback) ? normalizedFallback : 'file';
}

function normalizeWorkerFsName(value: unknown): string {
	return String(value || '').replaceAll('\0', '-').replace(/[\\/]/gu, '-');
}

function isWorkerFsFileName(value: string): boolean {
	return value !== '' && value !== '.' && value !== '..';
}
