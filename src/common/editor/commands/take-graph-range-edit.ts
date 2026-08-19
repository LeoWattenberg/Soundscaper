/* SPDX-License-Identifier: AGPL-3.0-only */

type DataRecord = Record<string, unknown>;

interface TakeGraphRange {
	readonly startFrame: number;
	readonly endFrame: number;
}

/**
 * What a range delete does to the take graph on the tracks it edits.
 *
 * A take group states where on its track the recording sits, so an edit that
 * moves that track's material has to move the group with it — the same rule the
 * timeline annotations already follow through their own ripple. A ripple delete
 * that left the graph behind desynchronized every take and comp region from the
 * audio they were recorded against, silently and permanently.
 *
 * A group the deleted span runs through cannot be moved: it would have to be
 * trimmed, which means splitting takes and comp regions and minting the
 * identities for the halves. The clipboard already refuses the mirror image of
 * that ("Insert paste cannot move an existing take graph without explicit split
 * identities"), so this refuses in the same terms rather than inventing them.
 */
export function planTakeGraphRangeDelete(
	project: DataRecord,
	trackRanges: ReadonlyMap<string, TakeGraphRange>,
	ripple: boolean,
): (() => void) | null {
	const groups = Array.isArray(project.takeGroups) ? project.takeGroups as readonly DataRecord[] : null;
	if (!groups || groups.length === 0) return null;
	let moved = false;
	const next = groups.map((group) => {
		const range = trackRanges.get(String(group?.trackId));
		if (!range) return group;
		const startSample = Number(group.startSample);
		const endSample = Number(group.endSample);
		if (endSample <= range.startFrame) return group;
		if (startSample < range.endFrame) {
			throw new RangeError(
				'A range delete cannot trim an existing take graph without explicit split identities.',
			);
		}
		if (!ripple) return group;
		moved = true;
		return shiftGroup(group, range.startFrame - range.endFrame);
	});
	if (!moved) return null;
	return () => { project.takeGroups = next; };
}

function shiftGroup(group: DataRecord, delta: number): DataRecord {
	return {
		...group,
		startSample: Number(group.startSample) + delta,
		endSample: Number(group.endSample) + delta,
		takes: shiftEntries(group.takes, delta),
		compRegions: shiftEntries(group.compRegions, delta),
	};
}

function shiftEntries(value: unknown, delta: number): unknown {
	if (!Array.isArray(value)) return value;
	return value.map((entry) => {
		const record = entry as DataRecord;
		if (!record || typeof record !== 'object') return entry;
		return {
			...record,
			startSample: Number(record.startSample) + delta,
			endSample: Number(record.endSample) + delta,
		};
	});
}
