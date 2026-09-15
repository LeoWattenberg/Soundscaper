/* SPDX-License-Identifier: AGPL-3.0-only */

interface ClipDragMenuItem {
	readonly label: string;
	readonly shortcut?: string;
	readonly disabled?: boolean;
	readonly items?: readonly ClipDragMenuItem[];
	onClick?(): unknown;
}

interface ClipDragMenuInput {
	readonly project: Readonly<{
		tracks: readonly Readonly<{ id: string; name: string; type: string; clipIds?: readonly string[] }>[];
		clips: readonly Readonly<{ id: string; kind: string }>[];
	}>;
	readonly clipId: string | null | undefined;
	readonly blocked: boolean;
	readonly copy: Readonly<{ selectTrackClips: string; moveClipPreserveTime: string }>;
	select(clipIds: readonly string[], trackId: string): unknown;
	move(clipId: string, trackId: string): unknown;
}

/** Menu equivalents for whole-track and time-preserving header drags. */
export function createClipDragMenuItems(input: ClipDragMenuInput): readonly ClipDragMenuItem[] {
	const clip = input.project.clips.find((item) => item.id === input.clipId);
	const source = input.project.tracks.find((track) => track.clipIds?.includes(clip?.id ?? ''));
	if (!clip || !source?.clipIds) return [];
	const destinations = input.project.tracks.filter((track) => (
		track.id !== source.id && track.type === clip.kind && Array.isArray(track.clipIds)
	));
	return [{
		label: input.copy.selectTrackClips,
		shortcut: 'Shift+drag',
		disabled: input.blocked,
		onClick: () => input.select(source.clipIds ?? [], source.id),
	}, {
		label: input.copy.moveClipPreserveTime,
		shortcut: 'Ctrl+drag',
		disabled: input.blocked || destinations.length === 0,
		items: destinations.map((track) => ({
			label: track.name,
			disabled: input.blocked,
			onClick: () => input.move(clip.id, track.id),
		})),
	}];
}
