/* SPDX-License-Identifier: AGPL-3.0-only */

/** Collapsed folder contents have project indices, but no focusable row. */
export function focusTrackRowNeighbor(
	trackIndex: number,
	trackCount: number,
	direction: 1 | -1,
	focus: (index: number) => boolean,
): boolean {
	for (let index = trackIndex + direction; index >= 0 && index < trackCount; index += direction) {
		if (focus(index)) return true;
	}
	return false;
}
