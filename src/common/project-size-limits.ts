/* SPDX-License-Identifier: AGPL-3.0-only */

const MEBIBYTE = 1024 * 1024;

export interface PortableProjectSizeLimitOptions {
	readonly opfs?: boolean;
	readonly mobile?: boolean;
	readonly deviceMemory?: number;
}

export function getPortableProjectSizeLimit(options: PortableProjectSizeLimitOptions = {}): number {
	if (options.opfs === false) return 64 * MEBIBYTE;
	const memory = Number(options.deviceMemory);
	if (options.mobile || (Number.isFinite(memory) && memory <= 4)) return 128 * MEBIBYTE;
	if (Number.isFinite(memory) && memory >= 8) return 512 * MEBIBYTE;
	return 256 * MEBIBYTE;
}
