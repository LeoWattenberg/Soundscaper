/* SPDX-License-Identifier: AGPL-3.0-only */

/** A published session report keeps the identity of the project it described. */
export interface DeliveryReportOrigin {
	readonly projectTitle: string | null;
}

const reportOrigins = new WeakMap<object, DeliveryReportOrigin>();

export function rememberDeliveryReportOrigin(report: unknown, projectTitle: unknown): void {
	if (!report || typeof report !== 'object'
		|| !('format' in report) || report.format !== 'delivery'
		|| reportOrigins.has(report)) return;
	reportOrigins.set(report, Object.freeze({
		projectTitle: typeof projectTitle === 'string' ? projectTitle : null,
	}));
}

export function deliveryReportOrigin(report: object): DeliveryReportOrigin | undefined {
	return reportOrigins.get(report);
}
