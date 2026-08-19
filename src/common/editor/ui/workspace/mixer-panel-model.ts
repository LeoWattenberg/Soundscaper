/* SPDX-License-Identifier: AGPL-3.0-only */

import { deriveFolderBusOwnershipV13 } from '../../folder-bus-v13.ts';

/**
 * Which mixer strips a folder owns, and what that means for their controls.
 *
 * A folder that contains audio owns its group bus: the folder record holds that
 * bus's name, mute, solo, and existence, and the graph refuses to change any of
 * them on the bus itself. The mixer showed those strips exactly like a bus a user
 * made, so Mute, Solo, and Remove bus were rendered live and answered with the
 * invariant message the folder authority throws — permanently dead controls, on
 * a strip that otherwise works.
 *
 * The strip stays: it is where that folder's audio is mixed, and its gain, pan,
 * and effects are its own. Only the questions the folder answers are sent to the
 * folder, and a bus that exists because a folder does is not offered for removal
 * — removing it means removing the folder.
 */
export function folderOwnedMixerBusIds(project: unknown): ReadonlySet<string> {
	const record = (project && typeof project === 'object' ? project : {}) as Readonly<Record<string, unknown>>;
	const sequences = Array.isArray(record.sequences) ? record.sequences : [];
	const tracks = Array.isArray(record.tracks) ? record.tracks : [];
	return new Set(deriveFolderBusOwnershipV13(sequences as never, tracks as never).busFolderIds);
}

/** Where a strip's mute and solo are authored: on the folder, or on the strip. */
export function mixerAudibilityAuthority(
	type: string,
	busId: string,
	folderOwnedBusIds: ReadonlySet<string>,
): 'folder' | 'strip' {
	return type === 'group' && folderOwnedBusIds.has(busId) ? 'folder' : 'strip';
}

/** The buses a user may remove, which excludes the ones folders own. */
export function removableMixerBuses<Bus extends Readonly<{ id: string }>>(
	buses: readonly Readonly<{ type: string; bus: Bus }>[],
	folderOwnedBusIds: ReadonlySet<string>,
): readonly Readonly<{ type: string; bus: Bus }>[] {
	return buses.filter(({ type, bus }) => (
		mixerAudibilityAuthority(type, bus.id, folderOwnedBusIds) === 'strip'
	));
}
