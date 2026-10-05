/* SPDX-License-Identifier: AGPL-3.0-only */

import WorkspacePanelDock from './WorkspacePanelDock.jsx';

/** The video workspace uses the same move, tab, float and resize controls as every other panel. */
export default function VideoEditorWorkspacePanels({ panelDockRuntime }) {
	const { snapshot, copy } = panelDockRuntime;
	if (!Object.values(snapshot.preferences?.workspace?.panels ?? {}).some((panel) => panel.visible && panel.dock === 'top')) return null;
	return <section
		className="kw-audio-editor__video-workspace"
		data-video-workspace
		aria-label={`${copy.workspace}: ${copy.workspaceVideo}`}
	>
		<WorkspacePanelDock {...panelDockRuntime} dock="top" />
	</section>;
}
