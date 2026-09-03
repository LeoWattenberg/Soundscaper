/* SPDX-License-Identifier: AGPL-3.0-only */

export const WORKSPACE_PANEL_DOCKS = Object.freeze([
	'left',
	'right',
	'bottom',
	'floating',
] as const);

export type WorkspacePanelDock = typeof WORKSPACE_PANEL_DOCKS[number];

export interface WorkspacePanelPreference extends Record<string, unknown> {
	readonly visible: boolean;
	readonly dock: unknown;
	readonly order: number;
	readonly tabGroup?: string;
	readonly tabActive?: boolean;
}

export type WorkspacePanelPlacement =
	| Readonly<{ kind: 'dock'; dock: WorkspacePanelDock; groupIndex: number }>
	| Readonly<{ kind: 'before' | 'tab' | 'after'; targetPanelId: string }>;

export interface WorkspacePanelDockExtent {
	readonly size?: number;
	readonly width?: number;
}

export interface WorkspacePanelGroup<Panel extends WorkspacePanelPreference> {
	readonly id: string;
	readonly entries: readonly (readonly [string, Panel])[];
	readonly activePanelId: string;
}

interface IndexedPanel<Panel extends WorkspacePanelPreference> {
	readonly id: string;
	readonly panel: Panel;
	readonly index: number;
}

interface MutablePanelGroup {
	dock: unknown;
	groupId: string | null;
	memberIds: string[];
	activePanelId: string;
}

const DOCK_SET: ReadonlySet<unknown> = new Set(WORKSPACE_PANEL_DOCKS);

function finiteOrder(value: unknown): number {
	const order = Number(value);
	return Number.isFinite(order) ? order : Number.MAX_SAFE_INTEGER;
}

function groupIdOf(panel: WorkspacePanelPreference): string | null {
	return typeof panel.tabGroup === 'string' && panel.tabGroup.trim() ? panel.tabGroup : null;
}

function withoutGroup<Panel extends WorkspacePanelPreference>(panel: Panel): Panel {
	const next: Record<string, unknown> = { ...panel };
	delete next.tabGroup;
	delete next.tabActive;
	return next as Panel;
}

function withGroup<Panel extends WorkspacePanelPreference>(
	panel: Panel,
	groupId: string,
	active: boolean,
): Panel {
	return { ...panel, tabGroup: groupId, tabActive: active };
}

function withFrameGeometry<Panel extends WorkspacePanelPreference>(panel: Panel, anchor: Panel): Panel {
	const next: Record<string, unknown> = { ...panel };
	for (const field of ['size', 'width'] as const) {
		if (Object.hasOwn(anchor, field)) next[field] = anchor[field];
	}
	return next as Panel;
}

function withDockExtent<Panel extends WorkspacePanelPreference>(
	panel: Panel,
	anchor: Panel,
	dock: unknown,
): Panel {
	const field = dock === 'bottom' ? 'size' : dock === 'left' || dock === 'right' ? 'width' : null;
	return field !== null && Object.hasOwn(anchor, field)
		? { ...panel, [field]: anchor[field] } as Panel
		: panel;
}

function selectedMember<Panel extends WorkspacePanelPreference>(
	entries: readonly (readonly [string, Panel])[],
): string {
	return entries.find(([, panel]) => panel.visible && panel.tabActive === true)?.[0]
		?? entries.find(([, panel]) => panel.visible)?.[0]
		?? entries.find(([, panel]) => panel.tabActive === true)?.[0]
		?? entries[0]?.[0]
		?? '';
}

/**
 * Groups an already ordered and optionally filtered panel list for presentation.
 * A missing active member (for example, one filtered out at runtime) falls back
 * to the first member supplied by the caller.
 */
export function groupWorkspacePanelEntries<Panel extends WorkspacePanelPreference>(
	entries: readonly (readonly [string, Panel])[],
): readonly WorkspacePanelGroup<Panel>[] {
	const groups: Array<{
		id: string;
		entries: Array<readonly [string, Panel]>;
	}> = [];
	const byKey = new Map<string, number>();
	for (const [panelId, panel] of entries) {
		const groupId = groupIdOf(panel);
		const key = groupId === null ? `panel\u0000${panelId}` : `group\u0000${groupId}`;
		let groupIndex = byKey.get(key);
		if (groupIndex === undefined) {
			groupIndex = groups.length;
			byKey.set(key, groupIndex);
			groups.push({ id: groupId ?? panelId, entries: [] });
		}
		groups[groupIndex]?.entries.push([panelId, panel]);
	}
	return groups.map((group) => ({
		id: group.id,
		entries: group.entries,
		activePanelId: selectedMember(group.entries),
	}));
}

/** Repairs persisted grouping metadata without adding fields to singleton panels. */
export function canonicalizeWorkspacePanelGroups<Panel extends WorkspacePanelPreference>(
	panels: Readonly<Record<string, Panel>>,
): Record<string, Panel> {
	const indexed = Object.entries(panels).map(([id, panel], index) => ({ id, panel, index }));
	const ordered = [...indexed].sort((left, right) => (
		finiteOrder(left.panel.order) - finiteOrder(right.panel.order) || left.index - right.index
	));
	const ownerDockByGroup = new Map<string, unknown>();
	for (const { panel } of ordered) {
		const groupId = groupIdOf(panel);
		if (groupId !== null && panel.dock !== 'floating' && !ownerDockByGroup.has(groupId)) {
			ownerDockByGroup.set(groupId, panel.dock);
		}
	}

	const byDock = new Map<unknown, Array<{
		groupId: string | null;
		members: IndexedPanel<Panel>[];
		firstOrder: number;
		firstIndex: number;
	}>>();
	const grouped = new Map<string, IndexedPanel<Panel>[] >();
	for (const entry of indexed) {
		const candidate = groupIdOf(entry.panel);
		const groupId = candidate !== null
			&& entry.panel.dock !== 'floating'
			&& ownerDockByGroup.get(candidate) === entry.panel.dock
			? candidate
			: null;
		const key = groupId === null
			? `panel\u0000${entry.index}`
			: `group\u0000${String(entry.panel.dock)}\u0000${groupId}`;
		const members = grouped.get(key) ?? [];
		members.push(entry);
		grouped.set(key, members);
	}
	for (const members of grouped.values()) {
		members.sort((left, right) => finiteOrder(left.panel.order) - finiteOrder(right.panel.order) || left.index - right.index);
		const first = members[0];
		if (!first) continue;
		const groups = byDock.get(first.panel.dock) ?? [];
		groups.push({
			groupId: members.length > 1 ? groupIdOf(first.panel) : null,
			members,
			firstOrder: finiteOrder(first.panel.order),
			firstIndex: first.index,
		});
		byDock.set(first.panel.dock, groups);
	}
	const allPanelIds = new Set(indexed.map(({ id }) => id));
	const reservedGroupIds = new Set([...byDock.values()].flatMap((groups) => (
		groups.flatMap(({ groupId }) => groupId === null ? [] : [groupId])
	)));
	const assignedGroupIds = new Set<string>();
	const tabGroups = [...byDock.values()].flat()
		.filter((group) => group.groupId !== null)
		.sort((left, right) => left.firstIndex - right.firstIndex);
	for (const group of tabGroups) {
		const preferred = group.groupId;
		if (preferred === null) continue;
		const memberIds = new Set(group.members.map(({ id }) => id));
		if (!assignedGroupIds.has(preferred) && (!allPanelIds.has(preferred) || memberIds.has(preferred))) {
			assignedGroupIds.add(preferred);
			continue;
		}
		let suffix = 2;
		let candidate = `${preferred}-${suffix}`;
		while (allPanelIds.has(candidate) || reservedGroupIds.has(candidate) || assignedGroupIds.has(candidate)) {
			suffix += 1;
			candidate = `${preferred}-${suffix}`;
		}
		group.groupId = candidate;
		assignedGroupIds.add(candidate);
	}

	const next = Object.fromEntries(indexed.map(({ id, panel }) => [id, panel])) as Record<string, Panel>;
	for (const groups of byDock.values()) {
		groups.sort((left, right) => left.firstOrder - right.firstOrder || left.firstIndex - right.firstIndex);
		const hasTabGroup = groups.some((group) => group.groupId !== null);
		let order = 0;
		for (const group of groups) {
			const entries = group.members.map(({ id, panel }) => [id, panel] as const);
			const activePanelId = selectedMember(entries);
			const anchor = group.members[0]?.panel;
			for (const { id, panel } of group.members) {
				const framedPanel = group.groupId !== null && anchor ? withFrameGeometry(panel, anchor) : panel;
				const orderedPanel = { ...framedPanel, order: hasTabGroup ? order : panel.order } as Panel;
				next[id] = group.groupId === null
					? withoutGroup(orderedPanel)
					: withGroup(orderedPanel, group.groupId, id === activePanelId);
				order += 1;
			}
		}
	}
	return next;
}

function mutableGroups<Panel extends WorkspacePanelPreference>(
	panels: Readonly<Record<string, Panel>>,
): MutablePanelGroup[] {
	const docks = new Map<unknown, IndexedPanel<Panel>[] >();
	Object.entries(panels).forEach(([id, panel], index) => {
		const entries = docks.get(panel.dock) ?? [];
		entries.push({ id, panel, index });
		docks.set(panel.dock, entries);
	});
	const result: MutablePanelGroup[] = [];
	for (const [dock, entries] of docks) {
		entries.sort((left, right) => finiteOrder(left.panel.order) - finiteOrder(right.panel.order) || left.index - right.index);
		for (const group of groupWorkspacePanelEntries(entries.map(({ id, panel }) => [id, panel] as const))) {
			result.push({
				dock,
				groupId: group.entries.length > 1 ? group.id : null,
				memberIds: group.entries.map(([id]) => id),
				activePanelId: group.activePanelId,
			});
		}
	}
	return result;
}

function nextVisibleMember<Panel extends WorkspacePanelPreference>(
	panels: Readonly<Record<string, Panel>>,
	memberIds: readonly string[],
	removedIndex: number,
): string | null {
	for (let offset = 0; offset < memberIds.length; offset += 1) {
		const id = memberIds[(removedIndex + offset) % memberIds.length];
		if (id && panels[id]?.visible) return id;
	}
	return null;
}

function detachPanel<Panel extends WorkspacePanelPreference>(
	panels: Readonly<Record<string, Panel>>,
	groups: MutablePanelGroup[],
	panelId: string,
): void {
	const groupIndex = groups.findIndex((group) => group.memberIds.includes(panelId));
	const group = groups[groupIndex];
	if (!group) return;
	const memberIndex = group.memberIds.indexOf(panelId);
	group.memberIds.splice(memberIndex, 1);
	if (!group.memberIds.length) {
		groups.splice(groupIndex, 1);
		return;
	}
	if (group.activePanelId === panelId) {
		group.activePanelId = nextVisibleMember(panels, group.memberIds, memberIndex)
			?? group.memberIds[Math.min(memberIndex, group.memberIds.length - 1)]
			?? group.memberIds[0]
			?? '';
	}
}

function unusedGroupId(groups: readonly MutablePanelGroup[], preferred: string): string {
	const used = new Set(groups.flatMap((group) => group.groupId === null || group.memberIds.length < 2 ? [] : [group.groupId]));
	if (!used.has(preferred)) return preferred;
	let suffix = 2;
	while (used.has(`${preferred}-${suffix}`)) suffix += 1;
	return `${preferred}-${suffix}`;
}

function writeGroups<Panel extends WorkspacePanelPreference>(
	panels: Readonly<Record<string, Panel>>,
	groups: readonly MutablePanelGroup[],
	changedDocks: ReadonlySet<unknown>,
): Record<string, Panel> {
	const next = { ...panels };
	const docks = new Map<unknown, MutablePanelGroup[]>();
	for (const group of groups) {
		const dockGroups = docks.get(group.dock) ?? [];
		dockGroups.push(group);
		docks.set(group.dock, dockGroups);
	}
	for (const [dock, dockGroups] of docks) {
		if (!changedDocks.has(dock)) continue;
		let order = 0;
		for (const group of dockGroups) {
			const anchor = next[group.memberIds[0] ?? ''];
			for (const panelId of group.memberIds) {
				const panel = next[panelId];
				if (!panel) continue;
				const framedPanel = group.memberIds.length > 1 && anchor ? withFrameGeometry(panel, anchor) : panel;
				const moved = { ...framedPanel, dock, order } as Panel;
				next[panelId] = group.memberIds.length > 1 && group.groupId !== null
					? withGroup(moved, group.groupId, panelId === group.activePanelId)
					: withoutGroup(moved);
				order += 1;
			}
		}
	}
	return canonicalizeWorkspacePanelGroups(next);
}

function requirePanel<Panel extends WorkspacePanelPreference>(
	panels: Readonly<Record<string, Panel>>,
	panelId: string,
): Panel {
	const panel = panels[panelId];
	if (!panel) throw new ReferenceError(`Panel ${panelId} does not exist.`);
	return panel;
}

export function placeWorkspacePanel<Panel extends WorkspacePanelPreference>(
	panels: Readonly<Record<string, Panel>>,
	panelId: string,
	placement: WorkspacePanelPlacement,
): Record<string, Panel> {
	const canonical = canonicalizeWorkspacePanelGroups(panels);
	const source = requirePanel(canonical, panelId);
	if (!placement || typeof placement !== 'object') throw new TypeError('Panel placement is required.');
	if (placement.kind !== 'dock' && placement.targetPanelId === panelId) {
		return placement.kind === 'tab' && source.visible
			? activateWorkspacePanelTab(canonical, panelId)
			: canonical;
	}
	const groups = mutableGroups(canonical);
	detachPanel(canonical, groups, panelId);

	if (placement.kind === 'dock') {
		if (!DOCK_SET.has(placement.dock)) throw new RangeError(`Panel placement has an unsupported dock: ${String(placement.dock)}.`);
		const destinationGroups = groups.filter((group) => group.dock === placement.dock);
		const visibleGroups = destinationGroups.filter((group) => group.memberIds.some((id) => canonical[id]?.visible));
		const requestedIndex = Math.round(Number(placement.groupIndex) || 0);
		const index = Math.max(0, Math.min(visibleGroups.length, requestedIndex));
		const nextVisible = visibleGroups[index];
		const previousVisible = visibleGroups[index - 1];
		const relativeIndex = nextVisible
			? destinationGroups.indexOf(nextVisible)
			: previousVisible
				? destinationGroups.indexOf(previousVisible) + 1
				: destinationGroups.length;
		const absoluteIndex = nextVisible
			? groups.indexOf(nextVisible)
			: previousVisible
				? groups.indexOf(previousVisible) + 1
				: groups.reduce((last, group, groupIndex) => group.dock === placement.dock ? groupIndex + 1 : last, groups.length);
		const sourceGroup: MutablePanelGroup = {
			dock: placement.dock,
			groupId: null,
			memberIds: [panelId],
			activePanelId: panelId,
		};
		if (destinationGroups.length && relativeIndex < destinationGroups.length) {
			groups.splice(groups.indexOf(destinationGroups[relativeIndex]!), 0, sourceGroup);
		} else {
			groups.splice(absoluteIndex, 0, sourceGroup);
		}
		const extentAnchor = canonical[visibleGroups[0]?.memberIds[0] ?? ''];
		const next = extentAnchor
			? { ...canonical, [panelId]: withDockExtent(source, extentAnchor, placement.dock) }
			: canonical;
		return writeGroups(next, groups, new Set([source.dock, placement.dock]));
	}

	if (placement.kind !== 'before' && placement.kind !== 'tab' && placement.kind !== 'after') {
		throw new RangeError(`Panel placement has an unsupported kind: ${String((placement as { kind?: unknown }).kind)}.`);
	}
	const target = requirePanel(canonical, placement.targetPanelId);
	const targetGroupIndex = groups.findIndex((group) => group.memberIds.includes(placement.targetPanelId));
	const targetGroup = groups[targetGroupIndex];
	if (!targetGroup) throw new ReferenceError(`Panel ${placement.targetPanelId} does not have a panel group.`);
	if (placement.kind === 'tab') {
		if (target.dock === 'floating') throw new RangeError('Floating panels cannot be tabbed.');
		targetGroup.groupId ??= unusedGroupId(groups, placement.targetPanelId);
		targetGroup.memberIds.push(panelId);
		if (source.visible) targetGroup.activePanelId = panelId;
		return writeGroups(canonical, groups, new Set([source.dock, target.dock]));
	}
	groups.splice(targetGroupIndex + (placement.kind === 'after' ? 1 : 0), 0, {
		dock: target.dock,
		groupId: null,
		memberIds: [panelId],
		activePanelId: panelId,
	});
	return writeGroups({
		...canonical,
		[panelId]: withDockExtent(source, target, target.dock),
	}, groups, new Set([source.dock, target.dock]));
}

export function activateWorkspacePanelTab<Panel extends WorkspacePanelPreference>(
	panels: Readonly<Record<string, Panel>>,
	panelId: string,
): Record<string, Panel> {
	const canonical = canonicalizeWorkspacePanelGroups(panels);
	const panel = requirePanel(canonical, panelId);
	if (!panel.visible) throw new RangeError(`Panel ${panelId} must be visible before it can be activated.`);
	const groupId = groupIdOf(panel);
	if (groupId === null) return canonical;
	const next = { ...canonical };
	for (const [candidateId, candidate] of Object.entries(canonical)) {
		if (candidate.dock === panel.dock && groupIdOf(candidate) === groupId) {
			next[candidateId] = withGroup(candidate, groupId, candidateId === panelId);
		}
	}
	return canonicalizeWorkspacePanelGroups(next);
}

export function setWorkspacePanelVisibility<Panel extends WorkspacePanelPreference>(
	panels: Readonly<Record<string, Panel>>,
	panelId: string,
	visible: boolean,
): Record<string, Panel> {
	if (typeof visible !== 'boolean') throw new TypeError('Panel visibility must be boolean.');
	const canonical = canonicalizeWorkspacePanelGroups(panels);
	const panel = requirePanel(canonical, panelId);
	const groupId = groupIdOf(panel);
	const next = { ...canonical, [panelId]: { ...panel, visible } as Panel };
	if (groupId === null) return canonicalizeWorkspacePanelGroups(next);
	const members = Object.entries(canonical)
		.filter(([, candidate]) => candidate.dock === panel.dock && groupIdOf(candidate) === groupId)
		.sort((left, right) => finiteOrder(left[1].order) - finiteOrder(right[1].order));
	let activePanelId = members.find(([id, candidate]) => id !== panelId && candidate.tabActive === true)?.[0]
		?? members.find(([id, candidate]) => id !== panelId && candidate.visible)?.[0]
		?? panelId;
	if (visible) activePanelId = panelId;
	else if (panel.tabActive === true) {
		const panelIndex = members.findIndex(([id]) => id === panelId);
		const remainingIds = members.map(([id]) => id).filter((id) => id !== panelId);
		activePanelId = nextVisibleMember(next, remainingIds, panelIndex) ?? panelId;
	}
	for (const [candidateId, candidate] of members) {
		next[candidateId] = withGroup(next[candidateId] ?? candidate, groupId, candidateId === activePanelId);
	}
	return canonicalizeWorkspacePanelGroups(next);
}

function normalizedPanelExtent(value: unknown, name: string): number {
	const extent = Number(value);
	if (!Number.isFinite(extent) || extent < 80 || extent > 4_096) {
		throw new RangeError(`${name} must be between 80 and 4096.`);
	}
	return extent;
}

export function setWorkspacePanelFrameSize<Panel extends WorkspacePanelPreference>(
	panels: Readonly<Record<string, Panel>>,
	panelId: string,
	size: number,
): Record<string, Panel> {
	const canonical = canonicalizeWorkspacePanelGroups(panels);
	const panel = requirePanel(canonical, panelId);
	const nextSize = normalizedPanelExtent(size, 'Panel frame size');
	const groupId = groupIdOf(panel);
	const next = { ...canonical };
	for (const [candidateId, candidate] of Object.entries(canonical)) {
		if (candidateId === panelId || (groupId !== null
			&& candidate.dock === panel.dock
			&& groupIdOf(candidate) === groupId)) {
			next[candidateId] = { ...candidate, size: nextSize } as Panel;
		}
	}
	return canonicalizeWorkspacePanelGroups(next);
}

export function setWorkspacePanelDockExtent<Panel extends WorkspacePanelPreference>(
	panels: Readonly<Record<string, Panel>>,
	dock: WorkspacePanelDock,
	changes: WorkspacePanelDockExtent,
): Record<string, Panel> {
	if (!DOCK_SET.has(dock)) throw new RangeError(`Panel extent has an unsupported dock: ${String(dock)}.`);
	if (dock === 'floating') throw new RangeError('Floating panels do not share a dock extent.');
	if (!changes || typeof changes !== 'object') throw new TypeError('Panel dock extent changes are required.');
	const patch: Record<string, number> = {};
	if (changes.size !== undefined) patch.size = normalizedPanelExtent(changes.size, 'Panel dock size');
	if (changes.width !== undefined) patch.width = normalizedPanelExtent(changes.width, 'Panel dock width');
	if (!Object.keys(patch).length) throw new TypeError('Panel dock extent requires a size or width.');
	const canonical = canonicalizeWorkspacePanelGroups(panels);
	const next = { ...canonical };
	for (const [panelId, panel] of Object.entries(canonical)) {
		if (panel.dock === dock) next[panelId] = { ...panel, ...patch } as Panel;
	}
	return canonicalizeWorkspacePanelGroups(next);
}

export function normalizeWorkspacePanelGroupFields(
	value: Readonly<Record<string, unknown>>,
	name: string,
): Readonly<{ tabGroup?: string; tabActive?: boolean }> {
	if (value.tabActive !== undefined && typeof value.tabActive !== 'boolean') {
		throw new TypeError(`${name}.tabActive must be boolean.`);
	}
	if (value.tabGroup === undefined) return {};
	if (typeof value.tabGroup !== 'string' || !value.tabGroup.trim()) {
		throw new TypeError(`${name}.tabGroup must be a non-empty string.`);
	}
	return { tabGroup: value.tabGroup, tabActive: value.tabActive === true };
}
