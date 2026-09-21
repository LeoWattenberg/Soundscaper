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
}

/** Lazy project adapter which keeps report generation and CSV serialization off the startup graph. */
export function ProjectAttributionTab({
	project,
	copy,
	locale,
	fileService,
	run,
}: ProjectAttributionTabProps) {
	const localizedCopy = { ...copy, ...freesoundAttributionCopy(locale, copy) };
	let domainReport: ReturnType<typeof createProjectAttributionReport> | null = null;
	let report: AttributionReportPresentation | null = null;
	let reportFailed = false;
	try {
		domainReport = project ? createProjectAttributionReport(project) : null;
		report = domainReport ? presentProjectAttributionReport(domainReport) : null;
	} catch {
		domainReport = null;
		reportFailed = true;
	}
	const exportCsv = domainReport && fileService ? () => {
		const operation = () => saveProjectAttributionCsv(domainReport, project?.title, fileService);
		if (run) void run(operation);
		else void operation();
	} : undefined;

	return <AttributionTab
		copy={localizedCopy}
		report={report}
		onExportCsv={exportCsv}
		errorMessage={reportFailed ? localizedCopy.reportError : undefined}
	/>;
}

export default ProjectAttributionTab;
