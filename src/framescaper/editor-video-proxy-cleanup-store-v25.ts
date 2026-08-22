/* SPDX-License-Identifier: AGPL-3.0-only */

/** Durable per-project cleanup journal backed by the candidate store's value repository. */

const KEY_PREFIX = 'framescaper:video-proxy-cleanup:v1:';

export function framescaperVideoProxyCleanupStoreV25(storeValue: unknown) {
	const store = storeValue as Readonly<{
		loadSetting?: (key: string, fallback?: unknown) => Promise<unknown>;
		saveSetting?: (key: string, value: unknown) => Promise<unknown>;
	}>;
	if (typeof store?.loadSetting !== 'function' || typeof store.saveSetting !== 'function') {
		throw new TypeError('V25 proxy cleanup recovery requires the candidate value store.');
	}
	return Object.freeze({
		loadCleanupJournal: (projectId: string) => store.loadSetting!(key(projectId), []),
		saveCleanupJournal: async (projectId: string, journal: readonly unknown[]) => {
			await store.saveSetting!(key(projectId), structuredClone(journal));
		},
	});
}

function key(projectId: string): string {
	if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(projectId)) {
		throw new TypeError('A proxy cleanup journal requires a stable project ID.');
	}
	return `${KEY_PREFIX}${projectId}`;
}
