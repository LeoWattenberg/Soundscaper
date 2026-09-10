/* SPDX-License-Identifier: AGPL-3.0-only */

interface TakeCycleExistingGroup {
	readonly id?: unknown;
	readonly sequenceId?: unknown;
	readonly trackId?: unknown;
	readonly startSample?: unknown;
	readonly endSample?: unknown;
}

export interface TakeCycleGroupProject {
	readonly takeGroups?: readonly TakeCycleExistingGroup[];
	readonly loop: Readonly<{ readonly startFrame?: unknown; readonly endFrame?: unknown }>;
}

/** Reuse the one exact track/sequence/loop group; refuse ambiguous persisted ownership. */
export function resolveTakeCycleGroupId(
	project: TakeCycleGroupProject,
	sequenceId: string,
	trackId: string,
	createId: () => string,
): string {
	const matches = (Array.isArray(project.takeGroups) ? project.takeGroups : []).filter((group) => (
		group?.sequenceId === sequenceId
		&& group.trackId === trackId
		&& group.startSample === project.loop.startFrame
		&& group.endSample === project.loop.endFrame
	));
	const overlaps = (Array.isArray(project.takeGroups) ? project.takeGroups : []).filter((group) => (
		group?.sequenceId === sequenceId
		&& group.trackId === trackId
		&& Number(group.startSample) < Number(project.loop.endFrame)
		&& Number(group.endSample) > Number(project.loop.startFrame)
	));
	if (matches.length > 1) {
		throw new Error(`Take cycle group ownership is ambiguous for track ${trackId}.`);
	}
	if (matches.length === 1) return stableId(matches[0]?.id, 'existing take cycle group ID');
	if (overlaps.length) {
		throw new Error(`Take cycle loop overlaps an existing take group for track ${trackId}.`);
	}
	return stableId(createId(), 'new take cycle group ID');
}

function stableId(value: unknown, name: string): string {
	if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${name} is invalid.`);
	return value;
}
