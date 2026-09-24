/* SPDX-License-Identifier: AGPL-3.0-only */

export interface EditorStartupAsset {
	readonly path: string;
	readonly rawBytes: number;
}

export interface EditorStartupAssetInventory {
	readonly schemaVersion: 1;
	readonly productId: 'soundscaper' | 'framescaper';
	readonly assets: readonly EditorStartupAsset[];
}

export type EditorStartupProgressSnapshot = Readonly<{
	phase: 'indeterminate' | 'loading' | 'preparing' | 'ready';
	percent: number | null;
}>;

type ResourceResult = Readonly<{
	decodedBodySize: number;
	responseStatus?: number;
	transferSize?: number;
}>;

export function parseEditorStartupAssetInventory(
	value: unknown,
	productId: 'soundscaper' | 'framescaper',
): EditorStartupAssetInventory {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('Editor startup asset inventory is missing.');
	}
	const record = value as Record<string, unknown>;
	if (record.schemaVersion !== 1 || record.productId !== productId) {
		throw new TypeError('Editor startup asset inventory names the wrong product or version.');
	}
	if (!Array.isArray(record.assets) || record.assets.length === 0 || record.assets.length > 100) {
		throw new RangeError('Editor startup asset inventory has an invalid asset count.');
	}
	const seen = new Set<string>();
	const assets = record.assets.map((value: unknown): EditorStartupAsset => {
		if (!value || typeof value !== 'object' || Array.isArray(value)) {
			throw new TypeError('Editor startup asset entry is invalid.');
		}
		const asset = value as Record<string, unknown>;
		if (typeof asset.path !== 'string' || !/^\/assets\/[A-Za-z0-9_./-]+\.(?:js|css)$/u.test(asset.path)) {
			throw new TypeError('Editor startup asset path is invalid.');
		}
		if (seen.has(asset.path)) throw new TypeError('Editor startup asset path is duplicated.');
		seen.add(asset.path);
		if (!Number.isSafeInteger(asset.rawBytes) || (asset.rawBytes as number) <= 0) {
			throw new RangeError('Editor startup asset size is invalid.');
		}
		return Object.freeze({ path: asset.path, rawBytes: asset.rawBytes as number });
	});
	return Object.freeze({ schemaVersion: 1, productId, assets: Object.freeze(assets) });
}

export function createEditorStartupProgressStore() {
	const listeners = new Set<() => void>();
	let snapshot: EditorStartupProgressSnapshot = Object.freeze({ phase: 'indeterminate', percent: null });
	let sizes = new Map<string, number>();
	let totalBytes = 0;
	let completedBytes = 0;
	const completed = new Set<string>();
	let observer: PerformanceObserver | null = null;
	let started = false;

	const publish = (next: EditorStartupProgressSnapshot): void => {
		if (snapshot.phase === next.phase && snapshot.percent === next.percent) return;
		snapshot = Object.freeze(next);
		for (const listener of listeners) listener();
	};
	const configure = (inventory: EditorStartupAssetInventory): void => {
		sizes = new Map(inventory.assets.map(({ path, rawBytes }) => [path, rawBytes]));
		totalBytes = inventory.assets.reduce((sum, asset) => sum + asset.rawBytes, 0);
		completedBytes = 0;
		completed.clear();
		publish({ phase: 'loading', percent: 0 });
	};
	const recordResource = (url: string, result: ResourceResult): void => {
		if (snapshot.phase !== 'loading') return;
		const path = url.startsWith('/') ? url : new URL(url, 'https://startup.invalid/').pathname;
		const size = sizes.get(path);
		if (size === undefined || completed.has(path)) return;
		if (typeof result.responseStatus === 'number' && result.responseStatus >= 400) return;
		if (result.decodedBodySize <= 0 && (!result.responseStatus || result.responseStatus >= 400)) return;
		completed.add(path);
		completedBytes += size;
		publish({ phase: 'loading', percent: Math.floor(completedBytes * 100 / totalBytes) });
	};
	const markPreparing = (): void => {
		if (snapshot.phase !== 'ready') publish({ phase: 'preparing', percent: null });
	};
	const finish = (): void => {
		observer?.disconnect();
		observer = null;
		publish({ phase: 'ready', percent: null });
	};
	const start = (productId: 'soundscaper' | 'framescaper'): void => {
		if (started) return;
		started = true;
		const element = document.querySelector('[data-editor-startup-assets]');
		try {
			configure(parseEditorStartupAssetInventory(JSON.parse(element?.textContent ?? ''), productId));
		} catch {
			return;
		}
		if (typeof PerformanceObserver !== 'function') {
			publish({ phase: 'indeterminate', percent: null });
			return;
		}
		const recordEntry = (entry: PerformanceEntry): void => {
			if (entry.entryType !== 'resource') return;
			const url = new URL(entry.name);
			if (url.protocol !== location.protocol || url.host !== location.host) return;
			const resource = entry as PerformanceResourceTiming;
			recordResource(url.pathname, {
				decodedBodySize: resource.decodedBodySize,
				responseStatus: resource.responseStatus,
				transferSize: resource.transferSize,
			});
		};
		try {
			performance.setResourceTimingBufferSize(512);
			observer = new PerformanceObserver((list) => {
				for (const entry of list.getEntries()) recordEntry(entry);
			});
			observer.observe({ type: 'resource', buffered: true });
			for (const entry of performance.getEntriesByType('resource')) recordEntry(entry);
		} catch {
			observer?.disconnect();
			observer = null;
			publish({ phase: 'indeterminate', percent: null });
		}
	};

	return Object.freeze({
		getSnapshot: () => snapshot,
		subscribe(listener: () => void) {
			listeners.add(listener);
			return () => { listeners.delete(listener); };
		},
		configure,
		recordResource,
		start,
		markPreparing,
		finish,
	});
}

export const editorStartupProgress = createEditorStartupProgressStore();
