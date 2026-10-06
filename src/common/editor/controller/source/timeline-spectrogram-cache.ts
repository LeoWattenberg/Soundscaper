/* SPDX-License-Identifier: AGPL-3.0-only */

import { createBoundedWorkQueue } from './internal/bounded-work-queue.ts';

const jobs = createBoundedWorkQueue(2, 128);
export function queueTimelineSpectrogramJob<Result>(operation: () => Promise<Result>, options: Readonly<{ signal?: AbortSignal; priority?: number }> = {}): Promise<Result> {
	return jobs.run(operation, options);
}

export type SpectrogramChannels = readonly (readonly (readonly number[])[])[];

interface CacheEntry<Value> {
	readonly key: readonly unknown[];
	readonly value: Value;
	readonly bytes: number;
}

interface CacheOptions<Image> {
	readonly analysisByteBudget?: number;
	readonly pixelByteBudget?: number;
	readonly releaseImage: (image: Image) => void;
}

/** Keep FFT columns independent of raster settings and transient selection state. */
export function createTimelineSpectrogramCache<Image>(options: CacheOptions<Image>) {
	const analysis = createBoundedCache<SpectrogramChannels>(options.analysisByteBudget ?? 32 * 1024 ** 2);
	const pixels = createBoundedCache<Image>(options.pixelByteBudget ?? 32 * 1024 ** 2, options.releaseImage);
	const pixelIdentities = new WeakMap<object, symbol>();
	const pixelIdentity = (value: unknown): unknown => {
		if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return value;
		let identity = pixelIdentities.get(value);
		if (!identity) { identity = Symbol(); pixelIdentities.set(value, identity); }
		return identity;
	};
	return {
		analysis(owner: object, key: readonly unknown[], compute: () => SpectrogramChannels | null) {
			const cached = analysis.get(owner, key);
			if (cached) return cached;
			analysis.release(owner);
			const columns = compute();
			if (columns) {
				// Include array overhead as well as the double-sized energy values.
				const bytes = 32 + columns.reduce((sum, channel) => sum + 32
					+ channel.reduce((total, bands) => total + 32 + bands.length * 8, 0), 0);
				analysis.set(owner, key, columns, bytes);
			}
			return columns;
		},
		image(owner: object, key: readonly unknown[], width: number, height: number, paint: () => Image | null) {
			// Raster identities must not keep FFT arrays alive after analysis eviction.
			const pixelKey = [...key.map(pixelIdentity), width, height];
			const cached = pixels.get(owner, pixelKey);
			if (cached) return cached;
			pixels.release(owner);
			const bytes = width * height * 4;
			if (!(bytes > 0) || !Number.isSafeInteger(bytes) || bytes > pixels.budget) return null;
			const image = paint();
			if (image) pixels.set(owner, pixelKey, image, bytes);
			return image;
		},
		release(owner: object) {
			analysis.release(owner);
			pixels.release(owner);
		},
		dispose() {
			analysis.dispose();
			pixels.dispose();
		},
		snapshot: () => ({ analysisBytes: analysis.bytes(), pixelBytes: pixels.bytes() }),
	};
}

function createBoundedCache<Value>(budget: number, releaseValue?: (value: Value) => void) {
	const entries = new Map<object, CacheEntry<Value>>();
	let bytes = 0;
	const release = (owner: object) => {
		const entry = entries.get(owner);
		if (!entry) return;
		entries.delete(owner);
		bytes -= entry.bytes;
		releaseValue?.(entry.value);
	};
	return {
		budget,
		get(owner: object, key: readonly unknown[]) {
			const entry = entries.get(owner);
			if (!entry || key.length !== entry.key.length
				|| key.some((part, index) => !Object.is(part, entry.key[index]))) return null;
			entries.delete(owner);
			entries.set(owner, entry);
			return entry.value;
		},
		set(owner: object, key: readonly unknown[], value: Value, size: number) {
			release(owner);
			if (size > budget) return;
			while (bytes + size > budget && entries.size) {
				const oldest = entries.keys().next().value;
				if (oldest) release(oldest);
			}
			entries.set(owner, { key: [...key], value, bytes: size });
			bytes += size;
		},
		release,
		dispose() { for (const owner of entries.keys()) release(owner); },
		bytes: () => bytes,
	};
}
