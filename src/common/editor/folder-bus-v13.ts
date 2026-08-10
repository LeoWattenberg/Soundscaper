/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * A top-level timeline folder that contains audio is a mix channel: it owns one
 * group bus carrying the same identity, and every audio track beneath it feeds
 * that bus. Deeper folders own no bus and their audio routes to the same
 * top-level ancestor, which keeps exactly one bus layer between a track and the
 * master — bus-to-bus routing does not exist and delay compensation is
 * single-stage, so a second layer would misalign silently.
 *
 * The link is identity, not a stored pointer: a group bus whose ID equals a
 * top-level folder ID *is* that folder's bus. Nothing new is persisted.
 */

const FOLDER_BUS_DEFAULT_COLOR = '#4f87c8';

export interface FolderBusOwnershipV13 {
	/** Bus-owning top-level folder ID per folder, in hierarchy preorder. */
	readonly busFolderIds: readonly string[];
	/** Owning folder ID per audio track ID; audio outside a folder is absent. */
	readonly busFolderIdByAudioTrackId: ReadonlyMap<string, string>;
	/** Every folder ID in the document, whether or not it owns a bus. */
	readonly folderIds: ReadonlySet<string>;
}

interface HierarchyNodeInput {
	readonly kind?: unknown;
	readonly id?: unknown;
	readonly parentFolderId?: unknown;
}

interface SequenceInput {
	readonly trackNodes?: unknown;
}

interface TrackInput {
	readonly id?: unknown;
	readonly type?: unknown;
}

/**
 * Derive which top-level folders own a bus and which audio tracks feed it.
 * A folder with no audio descendant owns nothing: mixer routes are keyed by
 * audio track ID, so a video- or label-only folder has nothing to route.
 */
export function deriveFolderBusOwnershipV13(
	sequences: readonly SequenceInput[],
	tracks: readonly TrackInput[],
): FolderBusOwnershipV13 {
	const audioTrackIds = new Set(
		tracks.filter((track) => track.type === 'audio').map((track) => String(track.id)),
	);
	const busFolderIdByAudioTrackId = new Map<string, string>();
	const folderIds = new Set<string>();
	const rootFolderIds: string[] = [];
	for (const sequence of sequences) {
		const nodes = Array.isArray(sequence.trackNodes) ? sequence.trackNodes as HierarchyNodeInput[] : [];
		// Nodes are a DFS preorder, so the most recent root-parented folder is
		// the open top-level ancestor of everything that follows it until the
		// next root-parented node closes it.
		let rootFolderId: string | null = null;
		for (const node of nodes) {
			const id = String(node.id);
			const isRoot = node.parentFolderId == null;
			if (isRoot) rootFolderId = null;
			if (node.kind === 'folder') {
				folderIds.add(id);
				if (isRoot) {
					rootFolderId = id;
					rootFolderIds.push(id);
				}
				continue;
			}
			if (rootFolderId === null || !audioTrackIds.has(id)) continue;
			busFolderIdByAudioTrackId.set(id, rootFolderId);
		}
	}
	const owning = new Set(busFolderIdByAudioTrackId.values());
	return Object.freeze({
		busFolderIds: Object.freeze(rootFolderIds.filter((id) => owning.has(id))),
		busFolderIdByAudioTrackId,
		folderIds,
	});
}

/**
 * Bring `project.mixer` into agreement with folder ownership: mint a group bus
 * for every newly bus-owning folder, drop the bus of a folder that no longer
 * owns one, mirror the folder name, and point every owned audio track's route
 * at its folder bus. Buses unrelated to folders and every send are untouched.
 */
export function reconcileFolderBusesV13(project: Record<string, unknown>): void {
	const sequences = Array.isArray(project.sequences) ? project.sequences as SequenceInput[] : [];
	const tracks = Array.isArray(project.tracks) ? project.tracks as TrackInput[] : [];
	const folders = Array.isArray(project.trackFolders)
		? project.trackFolders as { id?: unknown; name?: unknown }[]
		: [];
	const ownership = deriveFolderBusOwnershipV13(sequences, tracks);
	const mixer = mixerRecord(project);
	const groups = Array.isArray(mixer.groups) ? mixer.groups as Record<string, unknown>[] : [];
	const nameByFolderId = new Map(folders.map((folder) => [String(folder.id), String(folder.name)]));
	const busFolderIds = new Set(ownership.busFolderIds);

	const retained = groups.filter((bus) => {
		const id = String(bus.id);
		return !ownership.folderIds.has(id) || busFolderIds.has(id);
	});
	const byId = new Map(retained.map((bus) => [String(bus.id), bus]));
	const nextGroups: Record<string, unknown>[] = [];
	for (const folderId of ownership.busFolderIds) {
		const existing = byId.get(folderId);
		byId.delete(folderId);
		nextGroups.push(folderBusRecord(existing, folderId, nameByFolderId.get(folderId) ?? folderId));
	}
	for (const bus of retained) {
		if (byId.has(String(bus.id))) nextGroups.push(bus);
	}
	mixer.groups = nextGroups;

	const groupIds = new Set(nextGroups.map((bus) => String(bus.id)));
	const routes = routeRecord(mixer);
	for (const [trackId, value] of Object.entries(routes)) {
		const route = value as Record<string, unknown>;
		const owner = ownership.busFolderIdByAudioTrackId.get(trackId);
		if (owner !== undefined) {
			route.groupId = owner;
			continue;
		}
		if (route.groupId == null) continue;
		const groupId = String(route.groupId);
		// A track outside every folder may keep an ordinary bus, but never a
		// folder bus it does not belong to — leaving a folder detaches it.
		if (!groupIds.has(groupId) || busFolderIds.has(groupId)) route.groupId = null;
	}
	for (const [trackId, owner] of ownership.busFolderIdByAudioTrackId) {
		if (Object.hasOwn(routes, trackId)) continue;
		routes[trackId] = { groupId: owner, sends: {} };
	}
}

/**
 * Reject any document whose folder buses and routes disagree with its
 * hierarchy. Mismatches are never repaired here: a silent repair would hide
 * exactly the drift this invariant exists to catch.
 */
export function validateFolderBusesV13(project: Record<string, unknown>): void {
	const sequences = Array.isArray(project.sequences) ? project.sequences as SequenceInput[] : [];
	const tracks = Array.isArray(project.tracks) ? project.tracks as TrackInput[] : [];
	const folders = Array.isArray(project.trackFolders)
		? project.trackFolders as { id?: unknown; name?: unknown }[]
		: [];
	const ownership = deriveFolderBusOwnershipV13(sequences, tracks);
	const mixer = mixerRecord(project);
	const groups = Array.isArray(mixer.groups) ? mixer.groups as Record<string, unknown>[] : [];
	const sends = Array.isArray(mixer.sends) ? mixer.sends as Record<string, unknown>[] : [];
	const nameByFolderId = new Map(folders.map((folder) => [String(folder.id), String(folder.name)]));
	const groupById = new Map(groups.map((bus) => [String(bus.id), bus]));

	for (const bus of sends) {
		if (ownership.folderIds.has(String(bus.id))) {
			throw new RangeError(`Send bus ${String(bus.id)} cannot reuse a track folder ID.`);
		}
	}
	for (const bus of groups) {
		const id = String(bus.id);
		if (!ownership.folderIds.has(id) || ownership.busFolderIds.includes(id)) continue;
		throw new RangeError(`Group bus ${id} names a track folder that owns no bus.`);
	}
	for (const folderId of ownership.busFolderIds) {
		const bus = groupById.get(folderId);
		if (!bus) {
			throw new ReferenceError(`Track folder ${folderId} contains audio and must own a group bus.`);
		}
		if (String(bus.name) !== nameByFolderId.get(folderId)) {
			throw new RangeError(`Group bus ${folderId} must mirror its track folder name.`);
		}
		if (bus.mute !== false || bus.solo !== false) {
			throw new RangeError(`Group bus ${folderId} must leave mute and solo to its track folder.`);
		}
	}

	const routes = routeRecord(mixer);
	for (const [trackId, owner] of ownership.busFolderIdByAudioTrackId) {
		const route = routes[trackId] as Record<string, unknown> | undefined;
		if (!route || route.groupId !== owner) {
			throw new RangeError(`Audio track ${trackId} must route to its track folder bus ${owner}.`);
		}
	}
	for (const [trackId, value] of Object.entries(routes)) {
		const route = value as Record<string, unknown>;
		if (route.groupId == null) continue;
		const groupId = String(route.groupId);
		if (!ownership.folderIds.has(groupId)) continue;
		if (ownership.busFolderIdByAudioTrackId.get(trackId) === groupId) continue;
		throw new RangeError(`Audio track ${trackId} cannot route to track folder bus ${groupId} it does not belong to.`);
	}
}

/**
 * Build the folder's group bus without importing the V2 mixer factory. The
 * factory drags the whole legacy project graph — effects, PFFFT, the Audacity
 * effect bundle — into the desktop runtime closure, which the packaging guard
 * rejects. The bus record is eleven closed fields that `validateMixerBus`
 * checks anyway, so composing it here keeps the closure tight; a folder bus
 * always leaves mute and solo to its folder.
 */
function folderBusRecord(
	existing: Record<string, unknown> | undefined,
	id: string,
	name: string,
): Record<string, unknown> {
	const base = existing ?? {};
	return {
		id,
		name,
		color: typeof base.color === 'string' && base.color.length > 0 ? base.color : FOLDER_BUS_DEFAULT_COLOR,
		gain: boundedNumber(base.gain, 1, 0, 4),
		pan: boundedNumber(base.pan, 0, -1, 1),
		mute: false,
		solo: false,
		envelope: Array.isArray(base.envelope) ? base.envelope : [],
		collapsed: typeof base.collapsed === 'boolean' ? base.collapsed : true,
		effectsActive: base.effectsActive !== false,
		effects: Array.isArray(base.effects) ? base.effects : [],
	};
}

function boundedNumber(value: unknown, fallback: number, minimum: number, maximum: number): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
	if (value < minimum || value > maximum) return fallback;
	return value;
}

function mixerRecord(project: Record<string, unknown>): Record<string, unknown> {
	const mixer = project.mixer;
	if (!mixer || typeof mixer !== 'object' || Array.isArray(mixer)) {
		throw new TypeError('project.mixer must be an object.');
	}
	return mixer as Record<string, unknown>;
}

function routeRecord(mixer: Record<string, unknown>): Record<string, unknown> {
	if (!mixer.routes || typeof mixer.routes !== 'object' || Array.isArray(mixer.routes)) {
		mixer.routes = {};
	}
	return mixer.routes as Record<string, unknown>;
}
