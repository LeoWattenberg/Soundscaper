/* SPDX-License-Identifier: AGPL-3.0-only */

export function createProjectStoreId(prefix: string): string {
	if (globalThis.crypto?.randomUUID) return `${prefix}-${globalThis.crypto.randomUUID()}`;
	return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function reportDesktopSharedProjectLocalCleanupError(): void {
	globalThis.console?.error?.('A deleted shared project could not be removed from this product local cache.');
}
