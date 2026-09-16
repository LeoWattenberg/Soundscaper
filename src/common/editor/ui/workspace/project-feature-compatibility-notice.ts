/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ProjectFeatureRequirementsReport } from '../../project-feature-requirements.ts';

/** Whether the notification offers a detailed compatibility report. */
export function hasProjectFeatureCompatibilityReport(
	report: ProjectFeatureRequirementsReport | null | undefined,
): boolean {
	return report?.compatible === false && report.items.some((item) => (
		item.availability !== 'available'
	));
}
