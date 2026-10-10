/* SPDX-License-Identifier: AGPL-3.0-only */

export default function MotionscaperWorkspace({ copy }: {
	readonly copy: Readonly<Record<string, string>>;
}) {
	return <section className="motionscaper-workspace" aria-labelledby="motion-workspace-title" data-motion-workspace>
		<h2 id="motion-workspace-title">{copy.workspaceMotion}</h2>
		<p>{copy.motionscaperWorkspaceEmpty}</p>
	</section>;
}
