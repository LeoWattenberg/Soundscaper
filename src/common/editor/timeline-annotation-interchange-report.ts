/* SPDX-License-Identifier: AGPL-3.0-only */

export type TimelineAnnotationInterchangeDisposition =
	| 'preserved'
	| 'converted'
	| 'clipped'
	| 'omitted';

export interface TimelineAnnotationInterchangeItem {
	readonly code: string;
	readonly disposition: TimelineAnnotationInterchangeDisposition;
	readonly annotationId: string | null;
	readonly message: string;
	readonly data: Readonly<Record<string, unknown>>;
}

export interface TimelineAnnotationInterchangeReport {
	readonly schemaVersion: 1;
	readonly format: 'riff';
	readonly direction: 'import' | 'export';
	readonly source: 'timeline-annotations' | 'label-track' | 'none';
	readonly items: readonly TimelineAnnotationInterchangeItem[];
	readonly counts: Readonly<Record<TimelineAnnotationInterchangeDisposition, number>>;
}

interface MutableTimelineAnnotationInterchangeReport {
	readonly schemaVersion: 1;
	readonly format: 'riff';
	readonly direction: 'import' | 'export';
	readonly source: TimelineAnnotationInterchangeReport['source'];
	readonly items: TimelineAnnotationInterchangeItem[];
	readonly counts: Record<TimelineAnnotationInterchangeDisposition, number>;
}

export function createTimelineAnnotationInterchangeReport(
	direction: TimelineAnnotationInterchangeReport['direction'],
	source: TimelineAnnotationInterchangeReport['source'],
): MutableTimelineAnnotationInterchangeReport {
	return {
		schemaVersion: 1,
		format: 'riff',
		direction,
		source,
		items: [],
		counts: { preserved: 0, converted: 0, clipped: 0, omitted: 0 },
	};
}

export function addTimelineAnnotationInterchangeItem(
	report: MutableTimelineAnnotationInterchangeReport,
	item: TimelineAnnotationInterchangeItem,
): void {
	if (!report || report.schemaVersion !== 1 || report.format !== 'riff') {
		throw new TypeError('A versioned RIFF annotation interchange report is required.');
	}
	if (!item.code || !item.message) {
		throw new TypeError('RIFF annotation interchange items require a code and message.');
	}
	report.items.push(deepFreeze({
		...item,
		data: cloneJsonValue(item.data, 'RIFF annotation interchange item data'),
	}));
	report.counts[item.disposition] += 1;
}

export function finalizeTimelineAnnotationInterchangeReport(
	report: MutableTimelineAnnotationInterchangeReport,
): TimelineAnnotationInterchangeReport {
	return deepFreeze({
		...report,
		items: [...report.items],
		counts: { ...report.counts },
	});
}

function cloneJsonValue<Value>(value: Value, name: string): Value {
	try {
		assertJsonValue(value, name, new Set());
		return structuredClone(value);
	} catch {
		throw new TypeError(`${name} must be JSON-safe.`);
	}
}

function assertJsonValue(value: unknown, name: string, active: Set<object>): void {
	if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
	if (typeof value === 'number' && Number.isFinite(value)) return;
	if (!value || typeof value !== 'object') throw new TypeError(`${name} has an unsupported scalar.`);
	if (active.has(value)) throw new TypeError(`${name} cannot contain cycles.`);
	active.add(value);
	if (Array.isArray(value)) {
		if (Object.getPrototypeOf(value) !== Array.prototype) throw new TypeError(`${name} must use ordinary arrays.`);
		for (const key of Reflect.ownKeys(value)) {
			if (key === 'length') continue;
			if (typeof key !== 'string' || !canonicalArrayIndex(key, value.length)) {
				throw new TypeError(`${name} arrays cannot have named properties.`);
			}
		}
		for (let index = 0; index < value.length; index += 1) {
			const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
			if (!descriptor) throw new TypeError(`${name} arrays cannot be sparse.`);
			assertJsonValue(dataValue(descriptor, `${name}[${String(index)}]`), name, active);
		}
	} else {
		const prototype = Object.getPrototypeOf(value);
		if (prototype !== Object.prototype && prototype !== null) throw new TypeError(`${name} must use plain objects.`);
		for (const key in value) if (!Object.hasOwn(value, key)) throw new TypeError(`${name} cannot inherit data.`);
		for (const key of Reflect.ownKeys(value)) {
			if (typeof key !== 'string') throw new TypeError(`${name} cannot use symbol keys.`);
			const descriptor = Object.getOwnPropertyDescriptor(value, key);
			if (!descriptor) throw new TypeError(`${name}.${key} is unavailable.`);
			assertJsonValue(dataValue(descriptor, `${name}.${key}`), name, active);
		}
	}
	active.delete(value);
}

function dataValue(descriptor: PropertyDescriptor, name: string): unknown {
	if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError(`${name} must be an enumerable data property.`);
	}
	return descriptor.value;
}

function canonicalArrayIndex(value: string, length: number): boolean {
	const index = Number(value);
	return Number.isInteger(index) && index >= 0 && index < length && String(index) === value;
}

function deepFreeze<Value>(value: Value): Value {
	if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
	for (const nested of Object.values(value)) deepFreeze(nested);
	return Object.freeze(value);
}
