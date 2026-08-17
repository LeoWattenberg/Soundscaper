/* SPDX-License-Identifier: AGPL-3.0-only */

import { type DeliveryReport } from './delivery-report.ts';

/**
 * The saved form of a delivery report.
 *
 * A report is only useful as evidence if it outlives the session that produced
 * it, so it serializes to a stable, self-describing JSON document that saves
 * through the reserved `'report'` file purpose.
 *
 * Serialization is deterministic: keys are written in a fixed order and the
 * timestamp is supplied by the caller rather than read from the clock here, so
 * the same report always produces the same bytes and a fixture can pin them.
 */

export const DELIVERY_REPORT_DOCUMENT_VERSION = 1;

export interface DeliveryReportDocumentContext {
	/** ISO-8601 instant the delivery was reported, supplied by the caller. */
	readonly generatedAt?: string | null;
	readonly productName?: string | null;
	readonly projectTitle?: string | null;
}

export interface SerializedDeliveryReport {
	readonly text: string;
	readonly fileName: string;
	readonly mimeType: 'application/json';
}

export function serializeDeliveryReport(
	report: DeliveryReport,
	context: DeliveryReportDocumentContext = {},
): SerializedDeliveryReport {
	if (!report || report.format !== 'delivery' || report.schemaVersion !== 1) {
		throw new TypeError('A sealed delivery report is required.');
	}
	const document = {
		documentVersion: DELIVERY_REPORT_DOCUMENT_VERSION,
		kind: 'delivery-report',
		generatedAt: nonEmptyStringOrNull(context.generatedAt),
		productName: nonEmptyStringOrNull(context.productName),
		projectTitle: nonEmptyStringOrNull(context.projectTitle),
		subject: {
			format: report.subject.format,
			container: report.subject.container,
			codec: report.subject.codec,
			sampleRate: report.subject.sampleRate,
			channelCount: report.subject.channelCount,
			lossless: report.subject.lossless,
		},
		counts: {
			preserved: report.counts.preserved,
			converted: report.counts.converted,
			missing: report.counts.missing,
			omitted: report.counts.omitted,
		},
		items: report.items.map((item) => ({
			code: item.code,
			disposition: item.disposition,
			severity: item.severity,
			...(item.message ? { message: item.message } : {}),
			scope: sortedRecord(item.scope),
			data: sortedRecord(item.data),
		})),
	};
	return Object.freeze({
		text: `${JSON.stringify(document, null, '\t')}\n`,
		fileName: deliveryReportFileName(context),
		mimeType: 'application/json' as const,
	});
}

export function deliveryReportFileName(context: DeliveryReportDocumentContext = {}): string {
	const title = sanitizeSegment(context.projectTitle) || 'project';
	const stamp = sanitizeSegment((context.generatedAt ?? '').slice(0, 10));
	return stamp
		? `${title}-delivery-report-${stamp}.json`
		: `${title}-delivery-report.json`;
}

/**
 * Save through the reserved `'report'` purpose. Falls back to returning the
 * document rather than inventing a download path, so a host without a file
 * service degrades visibly instead of silently doing nothing.
 */
export async function saveDeliveryReport(
	report: DeliveryReport,
	context: DeliveryReportDocumentContext,
	fileService: {
		saveFile?: (request: Readonly<Record<string, unknown>>) => unknown;
	} | null | undefined,
): Promise<SerializedDeliveryReport> {
	const serialized = serializeDeliveryReport(report, context);
	if (fileService?.saveFile) {
		await fileService.saveFile({
			purpose: 'report',
			suggestedName: serialized.fileName,
			mimeType: serialized.mimeType,
			blob: new Blob([serialized.text], { type: serialized.mimeType }),
		});
	}
	return serialized;
}

function sortedRecord(value: Readonly<Record<string, unknown>>): Record<string, unknown> {
	const entries = Object.entries(value ?? {}).sort(([left], [right]) => (left < right ? -1 : 1));
	return Object.fromEntries(entries);
}

function nonEmptyStringOrNull(value: unknown): string | null {
	return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function sanitizeSegment(value: unknown): string {
	return String(value ?? '')
		.trim()
		.replaceAll(/[^\w.-]+/gu, '-')
		// Collapse separator runs so a path-shaped title cannot leave `..-..-`
		// fragments in the name, then trim them from the ends.
		.replaceAll(/[-.]{2,}/gu, '-')
		.replaceAll(/^[-.]+|[-.]+$/gu, '')
		.slice(0, 64);
}
