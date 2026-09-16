/* SPDX-License-Identifier: AGPL-3.0-only */

import { createPortal } from 'react-dom';

import AudioEditorDialogShell from '../AudioEditorDialogShell.tsx';
import { formatResizeLabel } from '../localization-template.ts';
import ProjectFeatureCompatibilityReport, {
	type ProjectFeatureCompatibilityReportProps,
} from './ProjectFeatureCompatibilityReport.tsx';

interface ProjectFeatureCompatibilityDialogProps extends ProjectFeatureCompatibilityReportProps {
	readonly onClose?: () => void;
	readonly overlayTarget?: Element | null;
}

/** The complete report surface loads only when requested from a toast or menu. */
export default function ProjectFeatureCompatibilityDialog({
	onClose,
	overlayTarget,
	...props
}: ProjectFeatureCompatibilityDialogProps) {
	const { copy } = props;
	const dialog = <AudioEditorDialogShell
		title={copy.projectCompatibilityReport}
		resizeLabel={formatResizeLabel(copy, copy.projectCompatibilityReport)}
		onClose={onClose}
		initialFocus="dialog"
		dataAttributes={{ 'data-project-compatibility-report-dialog': true }}
	>
		<ProjectFeatureCompatibilityReport {...props} />
	</AudioEditorDialogShell>;
	return overlayTarget ? createPortal(dialog, overlayTarget) : dialog;
}
