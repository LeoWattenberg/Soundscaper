/* SPDX-License-Identifier: AGPL-3.0-only */

import type { WorkspacePanelDock, WorkspacePanelPlacement } from '../../workspace-panel-layout.ts';
import { clampFloatingPanelGeometry, type FloatingPanelGeometry } from './workspace-panel-model.ts';
import type { WorkspacePanelDropBounds, WorkspacePanelDropPoint } from './workspace-panel-drop-model.ts';

export interface FloatingPanelPointerDropTarget {
	readonly dock: string;
	readonly bounds: WorkspacePanelDropBounds;
}

function isDock(dock: string): dock is Exclude<WorkspacePanelDock, 'floating'> {
	return dock === 'left' || dock === 'right' || dock === 'top' || dock === 'bottom';
}

/** Empty drop zones and occupied docks share the same append operation. */
export function resolveFloatingPanelPointerDrop(
	point: WorkspacePanelDropPoint,
	targets: readonly FloatingPanelPointerDropTarget[],
): WorkspacePanelPlacement | null {
	if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
	for (const { dock, bounds } of targets) {
		if (!isDock(dock) || bounds.width <= 0 || bounds.height <= 0) continue;
		if (point.x >= bounds.left && point.x <= bounds.left + bounds.width
			&& point.y >= bounds.top && point.y <= bounds.top + bounds.height) {
			return { kind: 'dock', dock, groupIndex: Number.MAX_SAFE_INTEGER };
		}
	}
	return null;
}

export type FloatingPanelMovePointer = Pick<PointerEvent, 'pointerId' | 'clientX' | 'clientY' | 'preventDefault'>;

interface FloatingPanelPointerDocking {
	onDragStart(): void;
	onDragEnd(): void;
	onDock(placement: WorkspacePanelPlacement): void;
	getDropTargets(): readonly FloatingPanelPointerDropTarget[];
}

interface FloatingPanelMoveInput {
	readonly panelId: string;
	readonly element: HTMLElement;
	readonly pointerId: number;
	readonly startClientX: number;
	readonly startClientY: number;
	readonly startGeometry: FloatingPanelGeometry;
	readonly workspaceBounds: Readonly<{ width: number; height: number }>;
	readonly persist: (coordinates: Readonly<{ x: number; y: number }>) => void;
	readonly docking?: FloatingPanelPointerDocking;
}

/** A pointer session captures its callbacks so React rerenders cannot cancel it. */
export class FloatingWorkspacePanelMove {
	private geometry: FloatingPanelGeometry;
	private moved = false;
	private settled = false;
	private readonly docking: FloatingPanelPointerDocking | undefined;

	constructor(private readonly input: FloatingPanelMoveInput) {
		this.geometry = { ...input.startGeometry };
		this.docking = input.docking ? { ...input.docking } : undefined;
		input.element.classList.add('kw-audio-editor__workspace-panel--moving');
		this.docking?.onDragStart();
	}

	move(event: FloatingPanelMovePointer): void {
		if (this.settled || event.pointerId !== this.input.pointerId) return;
		event.preventDefault();
		const deltaX = event.clientX - this.input.startClientX;
		const deltaY = event.clientY - this.input.startClientY;
		this.geometry = clampFloatingPanelGeometry({
			...this.input.startGeometry,
			x: this.input.startGeometry.x + deltaX,
			y: this.input.startGeometry.y + deltaY,
		}, this.input.workspaceBounds, this.input.panelId);
		this.moved ||= Math.abs(deltaX) >= 1 || Math.abs(deltaY) >= 1;
		Object.assign(this.input.element.style, { left: `${this.geometry.x}px`, top: `${this.geometry.y}px` });
	}

	finish(event: FloatingPanelMovePointer): boolean {
		if (this.settled || event.pointerId !== this.input.pointerId) return false;
		this.settled = true;
		this.input.element.classList.remove('kw-audio-editor__workspace-panel--moving');
		try {
			if (!this.moved) return true;
			const drop = this.docking && resolveFloatingPanelPointerDrop(
				{ x: event.clientX, y: event.clientY }, this.docking.getDropTargets(),
			);
			if (drop) this.docking?.onDock(drop);
			else this.input.persist({ x: Math.round(this.geometry.x), y: Math.round(this.geometry.y) });
			return true;
		} finally {
			this.docking?.onDragEnd();
		}
	}

	cancel(event?: Pick<PointerEvent, 'pointerId'>): boolean {
		if (this.settled || (event && event.pointerId !== this.input.pointerId)) return false;
		this.settled = true;
		this.input.element.classList.remove('kw-audio-editor__workspace-panel--moving');
		Object.assign(this.input.element.style, {
			left: `${this.input.startGeometry.x}px`, top: `${this.input.startGeometry.y}px`,
		});
		this.docking?.onDragEnd();
		return true;
	}
}
