/* SPDX-License-Identifier: AGPL-3.0-only */

/** One FFT column, ordered by audio channel, with borrowed immutable band arrays. */
export type SpectrogramColumn = readonly (readonly number[])[];

export interface SpectrogramColumnCacheView {
	read(centerFrame: number): SpectrogramColumn | null;
	write(centerFrame: number, column: SpectrogramColumn): void;
}

interface Namespace {
	readonly key: string;
	readonly bytes: number;
	readonly entries: Map<number, Entry>;
}

interface Entry {
	readonly namespace: Namespace;
	readonly centerFrame: number;
	readonly column: SpectrogramColumn;
	readonly bytes: number;
}

/** Account band doubles, array/entry overhead, and namespace strings in one LRU. */
export function createSpectrogramColumnCache(budget: number) {
	if (!Number.isSafeInteger(budget) || budget < 0) throw new RangeError('Invalid spectral column cache budget.');
	const namespaces = new Map<string, Namespace>();
	const recent = new Map<Entry, true>();
	let bytes = 0;
	const remove = (entry: Entry): void => {
		recent.delete(entry);
		entry.namespace.entries.delete(entry.centerFrame);
		bytes -= entry.bytes;
		if (entry.namespace.entries.size === 0) {
			namespaces.delete(entry.namespace.key);
			bytes -= entry.namespace.bytes;
		}
	};
	return {
		forKey(key: string): SpectrogramColumnCacheView {
			return {
				read(centerFrame) {
					const entry = namespaces.get(key)?.entries.get(centerFrame);
					if (!entry) return null;
					recent.delete(entry);
					recent.set(entry, true);
					return entry.column;
				},
				write(centerFrame, column) {
					if (!Number.isSafeInteger(centerFrame) || centerFrame < 0) return;
					const entryBytes = 64 + 32 + column.reduce((sum, bands) => sum + 32 + bands.length * 8, 0);
					const namespaceBytes = 64 + key.length * 2;
					if (!Number.isSafeInteger(entryBytes) || entryBytes + namespaceBytes > budget) return;
					const previous = namespaces.get(key)?.entries.get(centerFrame);
					if (previous) remove(previous);
					while (bytes + entryBytes + (namespaces.has(key) ? 0 : namespaceBytes) > budget) {
						const oldest = recent.keys().next().value;
						if (!oldest) break;
						remove(oldest);
					}
					let namespace = namespaces.get(key);
					if (!namespace) {
						namespace = { key, bytes: namespaceBytes, entries: new Map() };
						namespaces.set(key, namespace);
						bytes += namespaceBytes;
					}
					const entry: Entry = { namespace, centerFrame, column, bytes: entryBytes };
					namespace.entries.set(centerFrame, entry);
					recent.set(entry, true);
					bytes += entryBytes;
				},
			};
		},
		clear(): void { recent.clear(); namespaces.clear(); bytes = 0; },
		snapshot: () => ({ bytes, entries: recent.size, namespaces: namespaces.size }),
	};
}
