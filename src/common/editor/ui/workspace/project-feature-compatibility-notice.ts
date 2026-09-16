/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ProjectFeatureRequirementsReport } from '../../project-feature-requirements.ts';

/** The notification and menu agree on whether a detailed report is available. */
export function hasProjectFeatureCompatibilityReport(
	report: ProjectFeatureRequirementsReport | null | undefined,
): boolean {
	return report?.compatible === false && report.items.some((item) => (
		item.availability !== 'available'
	));
}

/** Keeps the detailed report reachable after the notification is dismissed. */
export function createProjectCompatibilityReportMenuItem(
	copy: Readonly<{ projectCompatibilityReport: string }>,
	report: ProjectFeatureRequirementsReport | null | undefined,
	onClick: () => void,
) {
	return {
		id: 'project-compatibility-report',
		label: copy.projectCompatibilityReport,
		disabled: !hasProjectFeatureCompatibilityReport(report),
		onClick,
	};
}
