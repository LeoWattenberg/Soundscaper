/* SPDX-License-Identifier: AGPL-3.0-only */

import AttributionTab from '../AttributionTab.tsx';
import { freesoundAttributionCopy } from '../../../i18n/freesound-attribution-copy.js';
import type {
	AttributionCsvFileService,
	AttributionReportPresentation,
} from '../attribution-presentation-contract.ts';
import { createProjectAttributionReport } from '../../project-attribution-report.ts';
import {
	presentProjectAttributionReport,
	saveProjectAttributionCsv,
} from './project-attribution-presentation.ts';

export interface ProjectAttributionTabProps {
	readonly project: Readonly<Record<string, unknown>> | null | undefined;
	readonly copy: Readonly<Record<string, string>>;
	readonly locale?: string;
	readonly fileService?: AttributionCsvFileService | null;
	readonly run?: (operation: () => unknown) => unknown;
	readonly report?: AttributionReportPresentation | null;
	readonly onExportCsv?: () => void;
}

/** Lazy project adapter which keeps report generation and CSV serialization off the startup graph. */
export function ProjectAttributionTab({
	project,
	copy,
	locale,
	fileService,
	run,
	report: suppliedReport,
	onExportCsv,
}: ProjectAttributionTabProps) {
	const domainReport = project ? createProjectAttributionReport(project) : null;
	const report = suppliedReport ?? (domainReport ? presentProjectAttributionReport(domainReport) : null);
	const exportCsv = onExportCsv ?? (domainReport && fileService ? () => {
		const operation = () => saveProjectAttributionCsv(domainReport, project?.title, fileService);
		if (run) void run(operation);
		else void operation();
	} : undefined);

	return <AttributionTab
		copy={{ ...copy, ...freesoundAttributionCopy(locale, copy) }}
		report={report}
		onExportCsv={exportCsv}
	/>;
}

export default ProjectAttributionTab;
