/* SPDX-License-Identifier: AGPL-3.0-only */

import { type DeliveryReport } from '../delivery-report.ts';
import { saveDeliveryReport } from '../delivery-report-document.ts';

/**
 * Save the report the current session's last delivery produced.
 *
 * The timestamp is read here rather than inside the serializer so the document
 * itself stays deterministic and a fixture can pin its bytes.
 */
export async function saveCurrentDeliveryReport(runtime: {
	readonly state: { readonly deliveryReport?: unknown };
	readonly productName?: string | null;
	readonly projectTitle?: string | null;
	readonly fileService?: { saveFile?: (request: Readonly<Record<string, unknown>>) => unknown } | null;
}): Promise<unknown> {
	const report = runtime?.state?.deliveryReport;
	if (!report) return null;
	return saveDeliveryReport(report as DeliveryReport, {
		generatedAt: new Date().toISOString(),
		productName: runtime.productName ?? null,
		projectTitle: runtime.projectTitle ?? null,
	}, runtime.fileService);
}
