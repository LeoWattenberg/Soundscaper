/* SPDX-License-Identifier: AGPL-3.0-only */

import { extendApplicationMenuProductPanelItems } from './application-menu-product-runtime.js';
import { timelineAnnotationsAvailable } from './timeline/timeline-annotation-ui-model.ts';
import {
	ANALYZER_PANEL_ID_SET,
	WORKSPACE_DISCOVERABLE_PANEL_IDS,
	workspacePanelLabel,
} from './workspace/workspace-panel-model.ts';
import { workspaceSwitcherOptions } from './workspace/workspace-switcher-options.ts';

/** Projects, workspace presets and panel visibility share one flat Window menu. */
export function createApplicationWindowMenu(context, viewMenu, actions) {
	const {
		blocked, capabilities, copy, divider, effectsPanelOpen, preferences, productId,
		productItems, project, projectBinEffectivelyOpen, selectedAudioTrack, snapshot,
	} = context;
	const seenProjects = new Set();
	const customWorkspaceIds = new Set(preferences.workspace.custom.map((workspace) => workspace.id));
	const projects = (snapshot.projectTabs || snapshot.projects || []).filter((entry) => {
		if (!entry?.id || seenProjects.has(entry.id)) return false;
		seenProjects.add(entry.id);
		return true;
	});
	return {
		id: 'window',
		label: copy.windowMenu,
		items: [
			...projects.map((entry) => ({
				id: `window-project-${entry.id}`,
				documentationId: 'window-project',
				label: entry.title,
				checked: entry.id === project?.id,
				disabled: blocked,
				onClick: () => actions.switchProject(entry.id),
			})),
			...(projects.length ? [divider()] : []),
			...workspaceSwitcherOptions(productId, copy, preferences.workspace.custom).map((workspace) => ({
				id: `workspace-${workspace.id}`,
				...(customWorkspaceIds.has(workspace.id) ? { documentationId: 'workspace-custom' } : {}),
				label: workspace.name,
				checked: preferences.workspace.activeId === workspace.id,
				onClick: () => viewMenu.setWorkspace(workspace.id),
			})),
			divider(),
			...WORKSPACE_DISCOVERABLE_PANEL_IDS
				.filter((panelId) => !ANALYZER_PANEL_ID_SET.has(panelId)
					&& (capabilities.audioEffects || panelId !== 'effects')
					&& (capabilities.audioRecording || panelId !== 'recording-meter')
					&& (capabilities.audioAnalysis || panelId !== 'ebu-r128')
					&& (panelId !== 'markers' || timelineAnnotationsAvailable(snapshot)))
				.flatMap((panelId) => panelId === 'effects'
					? [{
						id: 'show-effects',
						label: copy.effects,
						checked: effectsPanelOpen,
						visibilityToggle: true,
						disabled: !selectedAudioTrack,
						onClick: actions.openEffects,
					}]
					: extendApplicationMenuProductPanelItems(panelId, {
						id: `panel-${panelId}`,
						label: workspacePanelLabel(copy, panelId),
						checked: panelId === 'project-bin'
							? projectBinEffectivelyOpen
							: preferences.workspace.panels[panelId].visible,
						visibilityToggle: true,
						onClick: () => viewMenu.togglePanel(panelId),
					}, productItems)),
		],
	};
}
