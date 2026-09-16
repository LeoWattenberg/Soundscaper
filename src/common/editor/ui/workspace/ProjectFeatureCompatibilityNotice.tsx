/* SPDX-License-Identifier: AGPL-3.0-only */

import { Suspense, useState } from 'react';

import EditorToast from '../EditorToast.tsx';
import { lazyEditorModule } from '../../../offline/lazy-module.tsx';
import type { ProjectFeatureCompatibilityReportProps } from '../dialogs/ProjectFeatureCompatibilityReport.tsx';
import { hasProjectFeatureCompatibilityReport } from './project-feature-compatibility-notice.ts';

const ProjectFeatureCompatibilityDialog = lazyEditorModule(() => import('../dialogs/ProjectFeatureCompatibilityDialog.tsx'));

interface ProjectFeatureCompatibilityNoticeProps extends ProjectFeatureCompatibilityReportProps {
	readonly reportOpen?: boolean;
	readonly onOpenReport: () => void;
	readonly onCloseReport?: () => void;
	readonly overlayTarget?: Element | null;
}

export default function ProjectFeatureCompatibilityNotice({
	reportOpen = false,
	onOpenReport,
	onCloseReport,
	overlayTarget,
	...props
}: ProjectFeatureCompatibilityNoticeProps) {
	const [dismissedProjects, setDismissedProjects] = useState<ReadonlySet<string>>(() => new Set());
	const projectId = props.project?.id ?? 'no-project';
	if (!hasProjectFeatureCompatibilityReport(props.report)) return null;
	const { copy } = props;

	return <>
		{!dismissedProjects.has(projectId) && <div data-project-feature-compatibility-summary>
			<EditorToast
				id="project-feature-compatibility"
				title={copy.scapeCompatibilityTitle}
				description={copy.projectReadOnly}
				type="warning"
				actions={[{ label: copy.aup4CompatibilityViewReport, onClick: onOpenReport }]}
				dismissLabel={copy.aup4CompatibilityDismiss}
				onDismiss={() => setDismissedProjects((current) => new Set(current).add(projectId))}
			/>
		</div>}
		{reportOpen && <Suspense fallback={<span className="kw-audio-editor-sr-only" role="status">{copy.loading}</span>}>
			<ProjectFeatureCompatibilityDialog {...props} onClose={onCloseReport} overlayTarget={overlayTarget} />
		</Suspense>}
	</>;
}
