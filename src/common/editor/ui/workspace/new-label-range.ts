/* SPDX-License-Identifier: AGPL-3.0-only */

interface LabelSelection {
	readonly startFrame: number;
	readonly endFrame: number;
}

/** Match Add label: use a selected range, otherwise the live playhead. */
export function newLabelRange(selection: LabelSelection | null | undefined, positionFrame = 0): LabelSelection {
	return selection && selection.endFrame > selection.startFrame
		? { startFrame: selection.startFrame, endFrame: selection.endFrame }
		: { startFrame: positionFrame, endFrame: positionFrame };
}
