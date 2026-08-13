/* SPDX-License-Identifier: AGPL-3.0-only */

/** Copy finite JSON-shaped own data without invoking accessors or prototype setters. */
export function snapshotStrictJsonData(value, path = 'value') {
	return snapshotValue(value, path, new WeakSet());
}

function snapshotValue(value, path, ancestors) {
	if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
	if (typeof value === 'number') {
		if (!Number.isFinite(value)) throw new Error(`${path} must contain only finite JSON data.`);
		return value;
	}
	if (typeof value !== 'object') throw new Error(`${path} must contain only JSON data.`);
	if (ancestors.has(value)) throw new Error(`${path} must not contain cyclic JSON data.`);
	ancestors.add(value);
	try {
		return Array.isArray(value)
			? snapshotArray(value, path, ancestors)
			: snapshotRecord(value, path, ancestors);
	} finally {
		ancestors.delete(value);
	}
}

function snapshotArray(value, path, ancestors) {
	if (Object.getPrototypeOf(value) !== Array.prototype) {
		throw new Error(`${path} must be a plain dense array.`);
	}
	if (value.length > 1_000_000) throw new Error(`${path} exceeds the strict JSON array limit.`);
	const result = new Array(value.length);
	for (let index = 0; index < value.length; index += 1) {
		const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
		if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
			throw new Error(`${path} must be a dense own-data array.`);
		}
		result[index] = snapshotValue(descriptor.value, `${path}[${index}]`, ancestors);
	}
	const unexpected = Reflect.ownKeys(value).filter((key) => (
		key !== 'length'
		&& (typeof key !== 'string'
			|| !/^(?:0|[1-9]\d*)$/u.test(key)
			|| Number(key) >= value.length)
	));
	if (unexpected.length > 0) throw new Error(`${path} must not contain extra or symbol array keys.`);
	return result;
}

function snapshotRecord(value, path, ancestors) {
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) {
		throw new Error(`${path} must be a plain record.`);
	}
	const result = {};
	for (const key of Reflect.ownKeys(value)) {
		if (typeof key !== 'string' || key === '__proto__') {
			throw new Error(`${path} must contain only safe string-keyed own data properties.`);
		}
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
			throw new Error(`${path}.${key} must be an own data property.`);
		}
		Object.defineProperty(result, key, {
			configurable: true,
			enumerable: true,
			writable: true,
			value: snapshotValue(descriptor.value, `${path}.${key}`, ancestors),
		});
	}
	return result;
}
