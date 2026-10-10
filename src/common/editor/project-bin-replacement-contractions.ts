/* SPDX-License-Identifier: AGPL-3.0-only */

interface Contraction {
	readonly endFrame: number;
	readonly frames: number;
}

/** Completed replaced tails occupy timeline intervals, even when several instances share them. */
export function createProjectBinContractionEvaluator(contractions: readonly Contraction[]): (frame: number) => number {
	const intervals = contractions.map(({ endFrame, frames }) => ({ startFrame: endFrame - frames, endFrame }))
		.sort((left, right) => left.startFrame - right.startFrame || left.endFrame - right.endFrame);
	return (frame) => {
		let removed = 0;
		let previousEnd = -1;
		for (const interval of intervals) {
			if (interval.endFrame > frame) continue;
			const added = interval.endFrame - Math.max(previousEnd, interval.startFrame);
			if (added > 0) {
				removed += added;
				previousEnd = interval.endFrame;
			}
		}
		return removed;
	};
}
