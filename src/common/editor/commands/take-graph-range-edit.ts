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
	return planTakeGraphRangeShift(
		project,
		trackRanges,
		(range) => (ripple ? range.startFrame - range.endFrame : 0),
	);
}

/**
 * The same rule for a range whose material is replaced rather than removed.
 *
 * A length-changing replacement — every Audacity effect that hands back a
 * different number of frames — ripples the rest of the track by `delta`, so the
 * take graph after the edited span has to travel the same distance. A group the
 * replaced span runs through refuses for the delete's reason: trimming it would
 * mean minting split identities nothing supplies.
 */
export function planTakeGraphRangeRipple(
	project: DataRecord,
	trackRanges: ReadonlyMap<string, TakeGraphRange>,
	delta: number,
): (() => void) | null {
	return planTakeGraphRangeShift(project, trackRanges, () => delta);
}

/**
 * The same rule for a range whose material outside it is discarded.
 *
 * `range/keep` trims every clip to the kept range and leaves what survives
 * exactly where it was, so nothing travels. A take group outside that range
 * loses the audio it was recorded against and goes with it, the way the graph
 * of a removed track does. A group the kept range's boundary runs through
 * refuses for the delete's reason: trimming it would mean splitting takes and
 * comp regions and minting the identities for the halves.
 */
export function planTakeGraphRangeKeep(
	project: DataRecord,
	trackRanges: ReadonlyMap<string, TakeGraphRange>,
): (() => void) | null {
	const groups = Array.isArray(project.takeGroups) ? project.takeGroups as readonly DataRecord[] : null;
	if (!groups || groups.length === 0) return null;
	let dropped = false;
	const next = groups.filter((group) => {
		const range = trackRanges.get(String(group?.trackId));
		if (!range) return true;
		const startSample = Number(group.startSample);
		const endSample = Number(group.endSample);
		if (startSample >= range.startFrame && endSample <= range.endFrame) return true;
		if (endSample > range.startFrame && startSample < range.endFrame) {
			throw new RangeError(
				'A range edit cannot trim an existing take graph without explicit split identities.',
			);
		}
		dropped = true;
		return false;
	});
	if (!dropped) return null;
	return () => { project.takeGroups = next; };
}

function planTakeGraphRangeShift(
	project: DataRecord,
	trackRanges: ReadonlyMap<string, TakeGraphRange>,
	deltaOf: (range: TakeGraphRange) => number,
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
				'A range edit cannot trim an existing take graph without explicit split identities.',
			);
		}
		const delta = deltaOf(range);
		if (delta === 0) return group;
		moved = true;
		return shiftGroup(group, delta);
	});
	if (!moved) return null;
	return () => { project.takeGroups = next; };
}

/**
 * The same rule for a per-track clip ripple, which closes the gap a removed
 * clip leaves rather than a selected range.
 *
 * A clip ripple moves every later clip on the edited track, so the take graph
 * on that track has to travel the same distance for exactly the reason the
 * range ripple does. The removals arrive per track as the spans the clips
 * occupied, and a group is moved by the total length of the removals that ended
 * at or before it — the rule the clips themselves follow.
 */
export function planTakeGraphClipRipple(
	project: DataRecord,
	trackRemovals: ReadonlyMap<string, readonly TakeGraphRange[]>,
): (() => void) | null {
	const groups = Array.isArray(project.takeGroups) ? project.takeGroups as readonly DataRecord[] : null;
	if (!groups || groups.length === 0 || trackRemovals.size === 0) return null;
	let moved = false;
	const next = groups.map((group) => {
		const removals = trackRemovals.get(String(group?.trackId));
		if (!removals) return group;
		const startSample = Number(group.startSample);
		const endSample = Number(group.endSample);
		let delta = 0;
		for (const removal of removals) {
			if (endSample <= removal.startFrame) continue;
			if (startSample < removal.endFrame) {
				throw new RangeError(
					'A clip ripple cannot trim an existing take graph without explicit split identities.',
				);
			}
			delta -= removal.endFrame - removal.startFrame;
		}
		if (delta === 0) return group;
		moved = true;
		return shiftGroup(group, delta);
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
