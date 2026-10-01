/* SPDX-License-Identifier: AGPL-3.0-only */

/** Keep selection changes on other rows out of this row's visual models. */
export function createAudioTrackClipSelectionReader(): (
	clips: readonly Readonly<{ id: string }>[],
	selectedClipIds: ReadonlySet<string>,
	selectedClipId: string | null | undefined,
) => ReadonlySet<string> {
	let previous: ReadonlySet<string> = new Set();
	return (clips, selectedClipIds, selectedClipId) => {
		const selected = new Set(clips
			.filter((clip) => selectedClipIds.size > 0
				? selectedClipIds.has(clip.id)
				: clip.id === selectedClipId)
			.map((clip) => clip.id));
		if (selected.size === previous.size
			&& [...selected].every((clipId) => previous.has(clipId))) return previous;
		previous = selected;
		return previous;
	};
}
