/* SPDX-License-Identifier: AGPL-3.0-only */

import { METER_PANEL_MIN_WIDTH, isMeterWorkspacePanel } from './workspace-layout-defaults.ts';
import type { WorkspacePanelGroup, WorkspacePanelPreference } from './workspace-panel-layout.ts';

export function isWorkspaceSideDock(dock: unknown): boolean {
	return dock === 'left' || dock === 'right';
}

export function workspaceSidePanelMinimumWidth(panelId: string): number {
	return isMeterWorkspacePanel(panelId) ? METER_PANEL_MIN_WIDTH : panelId === 'effects' ? 360 : 240;
}

export function workspacePanelColumn(panel: WorkspacePanelPreference): number {
	return isWorkspaceSideDock(panel.dock) ? panel.column ?? 0 : 0;
}

export function withWorkspacePanelColumn<Panel extends WorkspacePanelPreference>(panel: Panel, anchor: Panel, dock: unknown): Panel {
	const next: Record<string, unknown> = { ...panel };
	if (isWorkspaceSideDock(dock) && (anchor.column !== undefined || panel.column !== undefined)) next.column = anchor.column ?? 0;
	else delete next.column;
	return next as Panel;
}

export function normalizeWorkspacePanelColumn(value: unknown, fallback: unknown, dock: unknown, name: string): { column?: number } {
	const column = value ?? fallback;
	if (column === undefined) return {};
	if (typeof column !== 'number' || !Number.isSafeInteger(column) || column < 0) {
		throw new TypeError(`${name}.column must be a non-negative integer.`);
	}
	return isWorkspaceSideDock(dock) ? { column } : {};
}

export function groupWorkspacePanelColumns<Panel extends WorkspacePanelPreference>(
	groups: readonly WorkspacePanelGroup<Panel>[],
): readonly { readonly index: number; readonly groups: readonly WorkspacePanelGroup<Panel>[] }[] {
	const columns = new Map<number, WorkspacePanelGroup<Panel>[]>();
	for (const group of groups) {
		const panel = group.entries[0]?.[1];
		if (!panel) continue;
		const index = workspacePanelColumn(panel);
		const members = columns.get(index) ?? [];
		members.push(group);
		columns.set(index, members);
	}
	return [...columns].sort(([left], [right]) => left - right).map(([index, members]) => ({ index, groups: members }));
}

/** Inserts a column without moving the target's stacked or tabbed neighbors. */
export function insertWorkspacePanelColumn<Panel extends WorkspacePanelPreference>(
	panels: Readonly<Record<string, Panel>>, panelId: string, target: Panel, side: 'left' | 'right',
): Record<string, Panel> {
	if (!isWorkspaceSideDock(target.dock)) throw new RangeError('Panels can only be placed beside a panel in a side dock.');
	const column = workspacePanelColumn(target) + (side === 'right' ? 1 : 0);
	return Object.fromEntries(Object.entries(panels).map(([id, panel]) => [id,
		id === panelId ? { ...panel, column }
			: panel.dock === target.dock && workspacePanelColumn(panel) >= column
				? { ...panel, column: workspacePanelColumn(panel) + 1 }
				: panel,
	])) as Record<string, Panel>;
}

/** A side dock's width is the sum of its visible columns, each with its own extent. */
export function resizedWorkspacePanelColumnWidths<Panel extends WorkspacePanelPreference>(
	panels: Readonly<Record<string, Panel>>, dock: unknown, width: number,
): ReadonlyMap<number, number> | null {
	if (!isWorkspaceSideDock(dock)) return null;
	const columns = new Map<number, { width: number; minimum: number }>();
	const ordered = Object.entries(panels).filter(([, panel]) => panel.visible && panel.dock === dock)
		.sort((left, right) => left[1].order - right[1].order);
	for (const [id, panel] of ordered) {
		const index = workspacePanelColumn(panel);
		const minimum = workspaceSidePanelMinimumWidth(id);
		const current = columns.get(index);
		columns.set(index, { width: Math.max(minimum, current?.minimum ?? 0, current?.width ?? Number(panel.width ?? panel.size ?? 320)), minimum: Math.max(current?.minimum ?? 0, minimum) });
	}
	if (columns.size < 2) return null;
	const total = [...columns.values()].reduce((sum, column) => sum + column.width, 0);
	const minimum = [...columns.values()].reduce((sum, column) => sum + column.minimum, 0);
	const target = Math.max(width, minimum);
	const result = new Map<number, number>();
	let remaining = target;
	let remainingBasis = total;
	// Allocate constrained columns first so every column can retain its minimum.
	const pending = [...columns];
	while (pending.length) {
		const constrained = pending.findIndex(([, column]) => remaining * column.width / remainingBasis < column.minimum);
		const [index, column] = pending.splice(constrained < 0 ? 0 : constrained, 1)[0]!;
		const extent = constrained >= 0 ? column.minimum : pending.length ? Math.round(remaining * column.width / remainingBasis) : remaining;
		result.set(index, extent);
		remaining -= extent;
		remainingBasis -= column.width;
	}
	return result;
}
