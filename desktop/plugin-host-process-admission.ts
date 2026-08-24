/* SPDX-License-Identifier: AGPL-3.0-only */

/** Soundscaper's fixed upper bound on live plus starting plug-in host processes. */
export const PLUGIN_HOST_MAXIMUM_PROCESSES = 128;

export function hasPluginHostProcessCapacity(currentHostCount: number): boolean {
	return currentHostCount < PLUGIN_HOST_MAXIMUM_PROCESSES;
}

/** The isolation unit, spelled once so no caller can invent a looser one. */
export function pluginHostIsolationKey(ownerId: string, binarySha256: string): string {
	return `${ownerId}:${binarySha256}`;
}
