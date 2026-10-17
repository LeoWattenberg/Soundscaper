/* SPDX-License-Identifier: AGPL-3.0-only */

import type { MotionscaperDocumentSnapshot } from '../../../../motionscaper/editor-document-session.ts';

export default function MotionscaperWorkspace({ copy, document }: {
	readonly copy: Readonly<Record<string, string>>;
	readonly document: MotionscaperDocumentSnapshot;
}) {
	const composition = document.project?.compositions.find((item) => item.id === document.project?.primaryCompositionId);
	return <section className="motionscaper-workspace" aria-labelledby="motion-workspace-title" data-motion-workspace>
		<h2 id="motion-workspace-title">{copy.workspaceMotion}</h2>
		{document.project && composition ? <>
			<h3 data-motion-project-title>{document.project.title}</h3>
			<p data-motion-save-status role="status">{document.busy ? copy.motionscaperWorking
				: document.dirty ? copy.motionscaperUnsaved : copy.motionscaperSaved}</p>
			<dl>
				<dt>{copy.motionscaperProjectDimensions}</dt><dd>{composition.width} × {composition.height}</dd>
				<dt>{copy.motionscaperFrameRate}</dt><dd>{composition.frameRate.num}/{composition.frameRate.den}</dd>
				<dt>{copy.motionscaperDuration}</dt><dd>{composition.durationFrames}</dd>
				<dt>{copy.motionscaperLayers}</dt><dd>{composition.layers.length}</dd>
			</dl>
		</> : <p>{copy.motionscaperWorkspaceEmpty}</p>}
	</section>;
}
