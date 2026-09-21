/* SPDX-License-Identifier: AGPL-3.0-only */

import { EditorWarningToast } from '../EditorToast.tsx';

interface ProjectBinNoticesProps {
	readonly readOnly: boolean;
	readonly busy: boolean;
	readonly copy: Readonly<{ projectBinReadOnly: string; projectBinBusy: string; close: string }>;
	readonly projectId?: string | null;
}

export default function ProjectBinNotices({ readOnly, busy, copy, projectId }: ProjectBinNoticesProps) {
	if (!readOnly && !busy) return null;
	const id = readOnly ? 'project-bin-read-only' : 'project-bin-busy';
	return <div className="kw-audio-editor__project-bin-toasts" data-project-bin-toast>
		<EditorWarningToast key={`${projectId || 'no-project'}:${id}`} id={id}
			title={readOnly ? copy.projectBinReadOnly : copy.projectBinBusy} dismissLabel={copy.close} />
	</div>;
}
