/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The delivery report vocabulary.
 *
 * This generalizes the AUP4 compatibility report rather than inventing a second
 * way to say the same thing: the dispositions, the item shape, and the counts
 * block are the ones `aup4-profile.js` has been producing and retaining all
 * along, so an AUP4 report is already a valid instance of this model and the
 * same renderer can show either.
 *
 * A report describes what a delivery did to the material. It is built from a
 * plan (see `delivery-conversion-inventory.ts`) and never from a caller's
 * recollection, because a hand-assembled report is exactly how a conversion
 * goes unreported.
 */

export type DeliveryDisposition = 'preserved' | 'converted' | 'missing' | 'omitted';

export type DeliverySeverity = 'info' | 'warning' | 'error';

export const DELIVERY_DISPOSITIONS: readonly DeliveryDisposition[] = Object.freeze([
	'preserved', 'converted', 'missing', 'omitted',
]);

export interface DeliveryReportItem {
	readonly code: string;
	readonly severity: DeliverySeverity;
	readonly disposition: DeliveryDisposition;
	readonly scope: Readonly<Record<string, unknown>>;
	readonly data: Readonly<Record<string, unknown>>;
	readonly message?: string;
}

export interface DeliveryReportSubject {
	readonly format: string;
	readonly container: string | null;
	readonly codec: string | null;
	readonly sampleRate: number | null;
	readonly channelCount: number | null;
	readonly lossless: boolean | null;
}

export interface DeliveryReport {
	readonly schemaVersion: 1;
	readonly format: 'delivery';
	readonly direction: 'export';
	readonly subject: DeliveryReportSubject;
	readonly items: readonly DeliveryReportItem[];
	readonly counts: Readonly<Record<DeliveryDisposition, number>>;
}

interface MutableDeliveryReport {
	readonly schemaVersion: 1;
	readonly format: 'delivery';
	readonly direction: 'export';
	subject: DeliveryReportSubject;
	items: DeliveryReportItem[];
	counts: Record<DeliveryDisposition, number>;
}

export interface DeliveryReportDraft {
	readonly draft: true;
}

type Draft = MutableDeliveryReport & DeliveryReportDraft;

/** Start a report for one delivered artifact. Takes a subject, never a project. */
export function createDeliveryReport(subject: Partial<DeliveryReportSubject> & { format: string }): Draft {
	if (typeof subject?.format !== 'string' || !subject.format) {
		throw new TypeError('A delivery report subject requires a format.');
	}
	return {
		draft: true,
		schemaVersion: 1,
		format: 'delivery',
		direction: 'export',
		subject: Object.freeze({
			format: subject.format,
			container: subject.container ?? null,
			codec: subject.codec ?? null,
			sampleRate: numberOrNull(subject.sampleRate),
			channelCount: numberOrNull(subject.channelCount),
			lossless: typeof subject.lossless === 'boolean' ? subject.lossless : null,
		}),
		items: [],
		counts: { preserved: 0, converted: 0, missing: 0, omitted: 0 },
	};
}

/** Record one thing the delivery did. Rejects unknown dispositions rather than dropping them. */
export function addDeliveryReportItem(
	report: Draft,
	item: {
		code: string;
		disposition: DeliveryDisposition;
		severity?: DeliverySeverity;
		scope?: Readonly<Record<string, unknown>> | null;
		data?: Readonly<Record<string, unknown>> | null;
		message?: string;
	},
): DeliveryReportItem {
	if (!report?.draft || report.schemaVersion !== 1 || report.format !== 'delivery') {
		throw new TypeError('A delivery report draft is required.');
	}
	if (typeof item?.code !== 'string' || !item.code) {
		throw new TypeError('Delivery report items require a code.');
	}
	if (!DELIVERY_DISPOSITIONS.includes(item.disposition)) {
		throw new TypeError(`Unsupported delivery disposition: ${String(item.disposition)}.`);
	}
	const normalized: DeliveryReportItem = Object.freeze({
		code: item.code,
		severity: item.severity === 'error' || item.severity === 'warning' ? item.severity : 'info',
		disposition: item.disposition,
		scope: Object.freeze({ ...(item.scope ?? { kind: 'delivery' }) }),
		data: Object.freeze({ ...(item.data ?? {}) }),
		...(typeof item.message === 'string' && item.message.trim()
			? { message: item.message.trim() }
			: {}),
	});
	report.items.push(normalized);
	report.counts[normalized.disposition] += 1;
	return normalized;
}

/** Freeze the draft. A sealed report is the artifact; nothing may append to it afterwards. */
export function sealDeliveryReport(report: Draft): DeliveryReport {
	if (!report?.draft) throw new TypeError('A delivery report draft is required.');
	return Object.freeze({
		schemaVersion: 1 as const,
		format: 'delivery' as const,
		direction: 'export' as const,
		subject: report.subject,
		items: Object.freeze([...report.items]),
		counts: Object.freeze({ ...report.counts }),
	});
}

/** True for anything carrying the shared report vocabulary — delivery or AUP4 compatibility. */
export function isDispositionReport(value: unknown): value is {
	items: readonly { disposition?: unknown }[];
	counts: Readonly<Record<string, unknown>>;
} {
	if (!value || typeof value !== 'object') return false;
	const record = value as Record<string, unknown>;
	return Array.isArray(record.items) && Boolean(record.counts) && typeof record.counts === 'object';
}

function numberOrNull(value: unknown): number | null {
	return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
