/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, useRef, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';

import type { WorkspacePanelPlacement } from '../../workspace-panel-layout.ts';
import { FloatingWorkspacePanelMove } from './floating-workspace-panel-move.ts';
import { retainFloatingPanelMoveLifecycle } from './floating-panel-move-lifecycle.ts';
import { clampFloatingPanelGeometry } from './workspace-panel-model.ts';
import { focusWorkspaceMeterSettings } from './workspace-panel-focus.js';

interface FloatingPanelMoveController {
	readonly actions: Readonly<{ preferences: Readonly<{
		setPanel(panelId: string, coordinates: Readonly<{ x: number; y: number }>): unknown;
	}> }>;
}

export function useFloatingWorkspacePanelMove(input: Readonly<{
	dock: string;
	dockRef: RefObject<HTMLElement | null>;
	resizeSessionRef: RefObject<unknown>;
	controller: FloatingPanelMoveController;
	run(operation: () => unknown): unknown;
	setActiveFloatingPanelId(panelId: string): void;
	onPanelDragStart(panelId: string): void;
	onPanelDragEnd(): void;
	onPanelMove(panelId: string, placement: WorkspacePanelPlacement): unknown;
}>) {
	const sessionRef = useRef<FloatingWorkspacePanelMove | null>(null);
	const { dock } = input;
	useEffect(() => {
		if (dock !== 'floating') return undefined;
		return retainFloatingPanelMoveLifecycle(window, sessionRef);
	}, [dock]);

	return (event: ReactPointerEvent<HTMLElement>, panelId: string): void => {
		if (dock !== 'floating' || event.button !== 0 || event.isPrimary === false
			|| input.resizeSessionRef.current || sessionRef.current) return;
		const target = event.target instanceof Element ? event.target : null;
		const meterGrip = Boolean(target?.closest('[data-meter-panel-grip]'));
		if (target?.closest('button, select, input, label, a, [role="menu"]') && !meterGrip) return;
		const element = event.currentTarget.closest<HTMLElement>('[data-workspace-panel]');
		const workspace = input.dockRef.current;
		if (!element || !workspace) return;
		const workspaceBounds = workspace.getBoundingClientRect();
		const elementBounds = element.getBoundingClientRect();
		const startGeometry = clampFloatingPanelGeometry({
			x: elementBounds.left - workspaceBounds.left, y: elementBounds.top - workspaceBounds.top,
			width: elementBounds.width, height: elementBounds.height,
		}, workspaceBounds, panelId);
		const root = workspace.closest<HTMLElement>('[data-audio-editor]');
		sessionRef.current = new FloatingWorkspacePanelMove({
			panelId, element, pointerId: event.pointerId,
			startClientX: event.clientX, startClientY: event.clientY, startGeometry, workspaceBounds,
			persist: (coordinates) => { input.run(() => input.controller.actions.preferences.setPanel(panelId, coordinates)); },
			docking: meterGrip && root ? {
				onDragStart: () => input.onPanelDragStart(panelId),
				onDragEnd: input.onPanelDragEnd,
				onDock: (placement) => {
					input.onPanelMove(panelId, placement);
					focusWorkspaceMeterSettings(root.ownerDocument, panelId, element.querySelector('.kw-audio-editor__audacity-level-button'));
				},
				getDropTargets: () => Array.from(root.querySelectorAll<HTMLElement>('[data-workspace-drop-target], [data-panel-dock]'))
					.map((candidate) => ({
						dock: candidate.dataset.workspaceDropTarget ?? candidate.dataset.panelDock ?? '',
						bounds: candidate.getBoundingClientRect(),
					})),
			} : undefined,
		});
		input.setActiveFloatingPanelId(panelId);
		event.currentTarget.setPointerCapture(event.pointerId);
		event.preventDefault();
	};
}
