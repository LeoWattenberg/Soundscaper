/* SPDX-License-Identifier: AGPL-3.0-only */
import { useMemo } from 'react';
import { groupWorkspacePanelEntries, type WorkspacePanelPreference } from '../../workspace-panel-layout.ts';
import { workspacePanelAvailable } from './workspace-product-panel-runtime.ts';
import { workspaceSideDockColumns } from './workspace-side-dock-width.ts';
import { WORKSPACE_PANEL_IDS, ANALYZER_PANEL_ID_SET, workspacePanelLabel } from './workspace-panel-model.ts';

type Availability = Parameters<typeof workspacePanelAvailable>;
const EMPTY_PANELS: Readonly<Record<string, WorkspacePanelPreference>> = {};

export function useWorkspaceDockPresentation(dock: string, preferences: Readonly<Record<string, WorkspacePanelPreference>> = EMPTY_PANELS, productId: string,
	audioEffects: boolean | undefined, audioRecording: boolean | undefined, audioAnalysis: boolean | undefined,
	webVcr: Availability[2], capture: Availability[3], annotationsAvailable: boolean, projectBinOpen: boolean,
	copy: Parameters<typeof workspacePanelLabel>[0]) {
	const modeActive = webVcr?.modeActive, capability = webVcr?.capability, phase = capture?.phase;
	return useMemo(() => {
		const webVcrView = webVcr ? { modeActive, capability } as NonNullable<Availability[2]> : null;
		const captureView = phase ? { phase } : null;
		const availablePanels = WORKSPACE_PANEL_IDS.flatMap(id => {
			const panel = preferences[id];
			return panel?.visible && workspacePanelAvailable(productId, id, webVcrView, captureView)
				&& (audioEffects || id !== 'effects') && (audioRecording || id !== 'recording-meter')
				&& (audioAnalysis || (!ANALYZER_PANEL_ID_SET.has(id) && id !== 'ebu-r128'))
				&& (id !== 'markers' || annotationsAvailable) && (id !== 'project-bin' || projectBinOpen)
				? [[id, panel] as const] : [];
		});
		const forDock = (target: string) => availablePanels.filter(([, panel]) => panel.dock === target).sort((a, b) => a[1].order - b[1].order);
		const panels = forDock(dock); const groups = groupWorkspacePanelEntries(panels);
		const sideDock = dock === 'left' || dock === 'right'; const columns = sideDock ? workspaceSideDockColumns(groups) : [];
		const arrangeTargets = ['left', 'right', 'top', 'bottom'].flatMap(targetDock => groupWorkspacePanelEntries(forDock(targetDock)).map(group => ({
			dock: targetDock, groupId: group.id, panelId: group.entries[0]![0], panelIds: group.entries.map(([id]) => id),
			label: group.entries.map(([id]) => workspacePanelLabel(copy, id)).join(' / '),
		})));
		return { availablePanels, panels, groups, sideDock, columns, minimumDockWidth: columns.reduce((total, column) => total + column.minimumWidth, 0), arrangeTargets };
	}, [dock, preferences, productId, audioEffects, audioRecording, audioAnalysis, modeActive, capability, phase, annotationsAvailable, projectBinOpen, copy, Boolean(webVcr)]);
}
