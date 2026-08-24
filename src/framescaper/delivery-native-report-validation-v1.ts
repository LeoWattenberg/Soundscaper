/* SPDX-License-Identifier: AGPL-3.0-only */

/** Closed-record and sealed-report validation shared by the native delivery receipt. */

import { fingerprintNativeMediaPlan } from '../common/editor/native-media-plan-canonical-form.ts';
import type {
	DeliveryDisposition,
	DeliveryReport,
	DeliveryReportItem,
	DeliveryReportSubject,
} from '../common/editor/delivery-report.ts';

const DISPOSITIONS = Object.freeze(['preserved', 'converted', 'missing', 'omitted'] as const);

export function snapshotDeliveryReport(value: unknown): DeliveryReport {
	const row = exactRecord(value, [
		'schemaVersion', 'format', 'direction', 'subject', 'items', 'counts',
	], 'sealed delivery report');
	if (row.schemaVersion !== 1 || row.format !== 'delivery' || row.direction !== 'export') {
		throw new TypeError('A native delivery job requires a sealed delivery report.');
	}
	const subject = reportSubject(row.subject);
	const items = denseArray(row.items, 0, 100_000, 'delivery report items').map(reportItem);
	const counts = exactRecord(row.counts, DISPOSITIONS, 'delivery report counts');
	const normalizedCounts = Object.fromEntries(DISPOSITIONS.map((disposition) => {
		const count = integer(counts[disposition], 0, 100_000, `delivery report ${disposition} count`);
		if (count !== items.filter((item) => item.disposition === disposition).length) {
			throw new Error('Delivery report counts do not describe its items.');
		}
		return [disposition, count];
	})) as Record<DeliveryDisposition, number>;
	return deepFreeze({
		schemaVersion: 1 as const, format: 'delivery' as const, direction: 'export' as const,
		subject, items: Object.freeze(items), counts: Object.freeze(normalizedCounts),
	});
}

function reportSubject(value: unknown): DeliveryReportSubject {
	const row = exactRecord(value, [
		'format', 'container', 'codec', 'sampleRate', 'channelCount', 'lossless',
	], 'delivery report subject');
	return Object.freeze({
		format: boundedText(row.format, 1, 512, 'delivery report format'),
		container: nullableBoundedText(row.container, 'delivery report container'),
		codec: nullableBoundedText(row.codec, 'delivery report codec'),
		sampleRate: nullableNumber(row.sampleRate, 'delivery report sample rate'),
		channelCount: nullableNumber(row.channelCount, 'delivery report channel count'),
		lossless: row.lossless === null || typeof row.lossless === 'boolean'
			? row.lossless : invalid('Delivery report lossless flag is invalid.'),
	});
}

function reportItem(value: unknown): DeliveryReportItem {
	const row = exactRecord(value, [
		'code', 'severity', 'disposition', 'scope', 'data', 'message',
	], 'delivery report item', ['message']);
	const severity = member(row.severity, ['info', 'warning', 'error'] as const, 'delivery report severity');
	const disposition = member(row.disposition, DISPOSITIONS, 'delivery report disposition');
	return Object.freeze({
		code: boundedText(row.code, 1, 512, 'delivery report item code'), severity, disposition,
		scope: snapshotPlainRecord(row.scope, 'delivery report item scope'),
		data: snapshotPlainRecord(row.data, 'delivery report item data'),
		...(row.message === undefined ? {} : {
			message: boundedText(row.message, 1, 4_096, 'delivery report item message'),
		}),
	});
}

function snapshotPlainRecord(value: unknown, name: string): Readonly<Record<string, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
		throw new TypeError(`${name} must be a plain record.`);
	}
	const cloned = structuredClone(value) as Record<string, unknown>;
	fingerprintNativeMediaPlan(cloned);
	return deepFreeze(cloned);
}

export function exactRecord(
	value: unknown,
	fields: readonly string[],
	name: string,
	optional: readonly string[] = [],
): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
		throw new TypeError(`${name} must be a closed plain record.`);
	}
	const keys = Reflect.ownKeys(value);
	if (keys.some((key) => typeof key !== 'string' || !fields.includes(key))
		|| fields.some((field) => !optional.includes(field) && !Object.hasOwn(value, field))) {
		throw new TypeError(`${name} has missing or unsupported fields.`);
	}
	return value as Record<string, unknown>;
}

export function denseArray(value: unknown, minimum: number, maximum: number, name: string): unknown[] {
	if (!Array.isArray(value) || value.length < minimum || value.length > maximum
		|| Reflect.ownKeys(value).length !== value.length + 1) {
		throw new TypeError(`${name} must be a bounded dense array.`);
	}
	return [...value];
}

export function member<const Value extends string>(value: unknown, values: readonly Value[], name: string): Value {
	if (typeof value !== 'string' || !(values as readonly string[]).includes(value)) {
		throw new RangeError(`${name} is unsupported.`);
	}
	return value as Value;
}

export function text(value: unknown, pattern: RegExp, name: string): string {
	if (typeof value !== 'string' || !pattern.test(value)) throw new TypeError(`${name} is invalid.`);
	return value;
}

export function boundedText(value: unknown, minimum: number, maximum: number, name: string): string {
	if (typeof value !== 'string' || value.length < minimum || value.length > maximum || value.includes('\0')) {
		throw new TypeError(`${name} is invalid.`);
	}
	return value;
}

export function nullableBoundedText(value: unknown, name: string): string | null {
	return value === null ? null : boundedText(value, 1, 512, name);
}

export function nullableNumber(value: unknown, name: string): number | null {
	if (value === null) return null;
	if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new TypeError(`${name} is invalid.`);
	return value;
}

export function integer(value: unknown, minimum: number, maximum: number, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
		throw new RangeError(`${name} is invalid.`);
	}
	return Number(value);
}

function invalid(message: string): never { throw new TypeError(message); }

export function deepFreeze<Value>(value: Value): Value {
	if (value && typeof value === 'object' && !Object.isFrozen(value)) {
		for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
		Object.freeze(value);
	}
	return value;
}
