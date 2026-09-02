/* SPDX-License-Identifier: AGPL-3.0-only */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

interface AutomationLaneIntervalBoundaryEditV21 {
	readonly startFrame: number;
	readonly endFrame: number;
	readonly insertedDurationFrames: number;
}

const ID_ENCODER = new TextEncoder();

/** Mint deterministic, collision-free point IDs for an interval edit. */
export function createAutomationLaneBoundaryIdMinterV21(
	laneId: string,
	edit: AutomationLaneIntervalBoundaryEditV21,
	pointIds: readonly string[],
): (tag: string) => string {
	const taken = new Set(pointIds);
	return (tag: string): string => {
		const base = boundaryId(laneId, edit, tag);
		let candidate = base;
		for (let index = 1; taken.has(candidate); index += 1) {
			if (index > taken.size + 1) {
				throw new RangeError('An automation interval edit could not mint a unique boundary ID.');
			}
			candidate = `${base}-${String(index)}`;
		}
		taken.add(candidate);
		return candidate;
	};
}

function boundaryId(
	laneId: string,
	edit: AutomationLaneIntervalBoundaryEditV21,
	tag: string,
): string {
	return `automation-edit-${bytesToHex(sha256(ID_ENCODER.encode(JSON.stringify([
		'automation-lane-interval-edit-v21', laneId, edit.startFrame,
		edit.endFrame, edit.insertedDurationFrames, tag,
	]))))}`;
}
