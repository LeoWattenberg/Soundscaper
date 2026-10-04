/* SPDX-License-Identifier: AGPL-3.0-only */

import { createContext, useContext } from 'react';

import { groupWorkspacePanelEntries } from '../../workspace-panel-layout.ts';
import WorkspacePanelHeader from './WorkspacePanelHeader.jsx';
import { workspacePanelLabel } from './workspace-panel-model.ts';
import { focusWorkspaceMeterSettings } from './workspace-panel-focus.js';

const MeterPanelControlsContext = createContext(null);
export const MeterPanelGripContext = createContext(null);

/** Keep panel commands available from meter settings in both toolbar and panel. */
export function MeterPanelControlsProvider({ snapshot, onPanelMove, onPanelActivate, children }) {
	return <MeterPanelControlsContext.Provider value={{ snapshot, onPanelMove, onPanelActivate }}>
		{children}
	</MeterPanelControlsContext.Provider>;
}

export function MeterPanelPositionMenu({ copy, meterKind, settings, onChange }) {
	const runtime = useContext(MeterPanelControlsContext);
	if (!runtime) return null;
	const panelId = `${meterKind}-meter`;
	const panels = runtime.snapshot.preferences.workspace.panels;
	const panel = panels[panelId];
	const targets = ['left', 'right', 'top', 'bottom'].flatMap((dock) => (
		groupWorkspacePanelEntries(Object.entries(panels)
			.filter(([, entry]) => entry.visible && entry.dock === dock)
			.sort((left, right) => left[1].order - right[1].order))
			.filter((group) => group.entries.some(([id]) => id !== panelId))
			.map((group) => ({
				dock,
				panelId: group.entries.find(([id]) => id !== panelId)[0],
				label: group.entries.map(([id]) => workspacePanelLabel(copy, id)).join(' / '),
				tabDisabled: panel.tabGroup != null && group.id === panel.tabGroup,
			}))
	));
	const move = (target, ownerDocument, menuButton) => {
		const previous = menuButton?.closest('[data-workspace-panel]')?.querySelector('.kw-audio-editor__audacity-level-button');
		if (settings.position !== 'panel') onChange((current) => ({ ...current, position: 'panel' }));
		runtime.onPanelMove(panelId, target);
		focusWorkspaceMeterSettings(ownerDocument, panelId, previous);
	};
	return <WorkspacePanelHeader
		menuOnly
		panelId={panelId}
		label={workspacePanelLabel(copy, panelId)}
		copy={copy}
		currentDock={settings.position === 'panel' ? panel.dock : null}
		arrangeTargets={targets}
		tabs={panel.tabGroup ? Object.entries(panels).filter(([, entry]) => entry.visible && entry.tabGroup === panel.tabGroup)
			.map(([id]) => ({ id, label: workspacePanelLabel(copy, id) })) : []}
		onTabActivate={runtime.onPanelActivate}
		onDock={(dock, ownerDocument, menuButton) => move({ kind: 'dock', dock, groupIndex: Number.MAX_SAFE_INTEGER }, ownerDocument, menuButton)}
		onArrange={(targetPanelId, kind, ownerDocument, menuButton) => move({ kind, targetPanelId }, ownerDocument, menuButton)}
		onClose={() => onChange((current) => ({ ...current, position: 'flyout' }))}
	/>;
}

/** The meter's only panel chrome sits directly above its settings icon. */
export function MeterPanelGrip() {
	const grip = useContext(MeterPanelGripContext);
	if (!grip) return null;
	return <button
		type="button"
		className="kw-audio-editor__workspace-drag-handle kw-audio-editor__meter-panel-grip"
		data-workspace-panel-drag-handle={grip.panelId}
		data-meter-panel-grip
		draggable
		aria-label={`${grip.copy.workspaceMove}: ${workspacePanelLabel(grip.copy, grip.panelId)}`}
		onDragStart={grip.dragHandle.onDragStart}
		onDragEnd={grip.dragHandle.onDragEnd}
		onKeyDown={grip.dragHandle.onKeyDown}
		onPointerDown={grip.onPointerDown}
	>⠿</button>;
}
