/* SPDX-License-Identifier: AGPL-3.0-only */

export function blobReadStats(values) {
	let blobValuesReturned = 0;
	let blobBytesReturned = 0;
	for (const value of values) {
		const payload = blobPayloadStats(value);
		if (payload.count) blobValuesReturned += 1;
		blobBytesReturned += payload.bytes;
	}
	return {
		returned: values.length,
		blobValuesReturned,
		blobBytesReturned,
	};
}

export function blobPayloadStats(value, seen = new WeakSet()) {
	if (!value || typeof value !== 'object') return { count: 0, bytes: 0 };
	if (typeof Blob === 'function' && value instanceof Blob) return { count: 1, bytes: value.size };
	if (seen.has(value)) return { count: 0, bytes: 0 };
	seen.add(value);
	if (value instanceof ArrayBuffer || ArrayBuffer.isView(value) || value instanceof Date) {
		return { count: 0, bytes: 0 };
	}
	const nested = value instanceof Map
		? [...value.entries()].flat()
		: value instanceof Set
			? [...value.values()]
			: Object.values(value);
	return nested.reduce((total, child) => {
		const payload = blobPayloadStats(child, seen);
		return { count: total.count + payload.count, bytes: total.bytes + payload.bytes };
	}, { count: 0, bytes: 0 });
}
