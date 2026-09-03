/* SPDX-License-Identifier: AGPL-3.0-only */

import type { createDeliveryReport } from './delivery-report.ts';
import { DawprojectIdAllocator, mediaEntryName } from './dawproject-format.ts';
import type { HoldTempoMap } from './timeline-time.ts';

/**
 * State the two halves of the DAWproject writer share.
 *
 * `dawproject-export.ts` writes the Structure (tracks, channels, routing) and
 * `dawproject-export-lanes.ts` writes the Arrangement (clips, automation,
 * markers). Both address the same tracks, channels, and parameters, so the id
 * allocator, media registry, and report draft live here rather than in either.
 */

export type DataRecord = Readonly<Record<string, unknown>>;
export type DeliveryReportDraft = ReturnType<typeof createDeliveryReport>;

export interface DawprojectMediaEntry {
	readonly path: string;
	readonly sourceId: string;
	readonly kind: 'audio' | 'video';
}

export interface DawprojectStructureNode {
	readonly kind: 'folder' | 'track';
	readonly id: string;
	readonly folder: DataRecord | null;
	readonly track: DataRecord | null;
	readonly children: readonly DawprojectStructureNode[];
}

export interface DawprojectMixerStrip {
	readonly id: string;
	readonly name: string;
	readonly gain: number;
	readonly pan: number;
	readonly mute: boolean;
	readonly solo: boolean;
	readonly envelope: readonly DataRecord[];
	readonly effects: readonly unknown[];
}

export interface DawprojectTrackRoute {
	readonly groupId: string | null;
	readonly sends: ReadonlyMap<string, number>;
}

export interface DawprojectMixerRouting {
	readonly groups: readonly DawprojectMixerStrip[];
	readonly sends: readonly DawprojectMixerStrip[];
	readonly routes: ReadonlyMap<string, DawprojectTrackRoute>;
	/** Node kinds the profile has no channel role for, for the report. */
	readonly omittedNodes: number;
}

export interface DawprojectExportContext {
	readonly project: DataRecord;
	readonly sampleRate: number;
	readonly ids: DawprojectIdAllocator;
	readonly draft: DeliveryReportDraft;
	readonly sourceById: ReadonlyMap<string, DataRecord>;
	readonly clipById: ReadonlyMap<string, DataRecord>;
	readonly media: DawprojectMediaRegistry;
	readonly routing: DawprojectMixerRouting;
	readonly embeddableVideoSourceIds: ReadonlySet<string>;
	readonly tempoMap: HoldTempoMap | null;
	/** V21 lane ids the arrangement wrote, so the rest can be reported as omitted. */
	readonly consumedLaneIds: Set<string>;
}

/** One embedded file per source, however many clips play it. */
export class DawprojectMediaRegistry {
	readonly #entries = new Map<string, DawprojectMediaEntry>();

	register(source: DataRecord, kind: 'audio' | 'video'): DawprojectMediaEntry {
		const sourceId = String(source.id);
		const existing = this.#entries.get(sourceId);
		if (existing) return existing;
		const extension = kind === 'audio' ? '.wav' : videoExtension(source);
		const entry: DawprojectMediaEntry = Object.freeze({
			path: mediaEntryName(kind, this.#entries.size, String(source.name ?? sourceId), extension),
			sourceId,
			kind,
		});
		this.#entries.set(sourceId, entry);
		return entry;
	}

	entries(): readonly DawprojectMediaEntry[] {
		return Object.freeze([...this.#entries.values()]);
	}
}

/** The stable allocator key for a strip, shared by structure, automation, and routing. */
export function stripKey(strip: DataRecord | null | undefined): string | null {
	if (!strip) return null;
	if (strip.kind === 'master') return 'master';
	if ((strip.kind === 'track' || strip.kind === 'mixer-node') && typeof strip.id === 'string') {
		return `${strip.kind}:${strip.id}`;
	}
	return null;
}

export function channelIdFor(context: DawprojectExportContext, key: string): string {
	return context.ids.id(`channel:${key}`);
}

export function parameterIdFor(context: DawprojectExportContext, key: string, parameter: 'volume' | 'pan' | 'mute'): string {
	return context.ids.id(`${key}:${parameter}`);
}

/**
 * The track hierarchy as the sequence states it, in document order.
 *
 * `trackNodes` is a DFS preorder with parent pointers; folders become nested
 * Track elements so the receiving DAW sees the same grouping. Tracks the
 * sequence does not list (a document that predates hierarchy, or a fixture)
 * fall back to flat project order rather than vanishing.
 */
export function dawprojectStructureTree(project: DataRecord, sequenceId?: string): readonly DawprojectStructureNode[] {
	const tracks = records(project.tracks);
	const trackById = new Map(tracks.map((track) => [String(track.id), track]));
	const folders = new Map(records(project.trackFolders).map((folder) => [String(folder.id), folder]));
	const sequences = records(project.sequences);
	const sequence = sequences.find((candidate) => String(candidate.id) === String(sequenceId ?? project.primarySequenceId ?? ''))
		?? sequences[0];
	const nodes = records(sequence?.trackNodes);
	const roots: DawprojectStructureNode[] = [];
	const childrenByFolder = new Map<string, DawprojectStructureNode[]>();
	const seenTracks = new Set<string>();
	for (const node of nodes) {
		const id = String(node.id);
		const parentId = node.parentFolderId == null ? null : String(node.parentFolderId);
		const siblings = parentId === null ? roots : (childrenByFolder.get(parentId) ?? roots);
		if (node.kind === 'folder') {
			const children: DawprojectStructureNode[] = [];
			childrenByFolder.set(id, children);
			siblings.push({ kind: 'folder', id, folder: folders.get(id) ?? { id, name: id }, track: null, children });
			continue;
		}
		const track = trackById.get(id);
		if (!track || seenTracks.has(id)) continue;
		seenTracks.add(id);
		siblings.push({ kind: 'track', id, folder: null, track, children: [] });
	}
	for (const track of tracks) {
		const id = String(track.id);
		if (seenTracks.has(id)) continue;
		seenTracks.add(id);
		roots.push({ kind: 'track', id, folder: null, track, children: [] });
	}
	return freezeTree(roots);
}

function freezeTree(nodes: DawprojectStructureNode[]): readonly DawprojectStructureNode[] {
	return Object.freeze(nodes.map((node) => Object.freeze({
		...node,
		children: freezeTree([...node.children]),
	})));
}

/**
 * Read the project's mixer routing in the compact shape current documents
 * persist (`groups`, `sends`, `routes`), or a V21 graph when one is present.
 * Folder-owned group buses carry their folder's id, which is how the structure
 * writer knows a folder Track owns a Channel.
 */
export function readDawprojectMixerRouting(project: DataRecord): DawprojectMixerRouting {
	const mixer = record(project.mixer);
	if (mixer.schemaVersion === 1 && Array.isArray(mixer.edges)) return readGraphRouting(mixer);
	const routes = new Map<string, DawprojectTrackRoute>();
	for (const [trackId, value] of Object.entries(record(mixer.routes))) {
		const route = record(value);
		const sends = new Map<string, number>();
		for (const [sendId, level] of Object.entries(record(route.sends))) {
			if (Number.isFinite(Number(level))) sends.set(sendId, Number(level));
		}
		routes.set(trackId, Object.freeze({ groupId: route.groupId == null ? null : String(route.groupId), sends }));
	}
	return Object.freeze({
		groups: records(mixer.groups).map(strip),
		sends: records(mixer.sends).map(strip),
		routes,
		omittedNodes: 0,
	});
}

function readGraphRouting(graph: DataRecord): DawprojectMixerRouting {
	const routes = new Map<string, { groupId: string | null; sends: Map<string, number> }>();
	const route = (trackId: string) => {
		let entry = routes.get(trackId);
		if (!entry) {
			entry = { groupId: null, sends: new Map() };
			routes.set(trackId, entry);
		}
		return entry;
	};
	for (const edge of records(graph.edges)) {
		if (edge.enabled === false) continue;
		const source = record(edge.source);
		const destination = record(edge.destination);
		if (source.kind !== 'track' || destination.kind !== 'mixer-node') continue;
		if (edge.kind === 'assignment') route(String(source.id)).groupId = String(destination.id);
		else if (edge.kind === 'send') route(String(source.id)).sends.set(String(destination.id), Number(edge.level ?? 1));
	}
	return Object.freeze({
		groups: records(graph.groups).map(strip),
		sends: records(graph.sends).map(strip),
		routes: new Map([...routes].map(([id, entry]) => [id, Object.freeze({ groupId: entry.groupId, sends: entry.sends })])),
		omittedNodes: records(graph.cues).length + records(graph.vcas).length,
	});
}

function strip(value: DataRecord): DawprojectMixerStrip {
	return Object.freeze({
		id: String(value.id),
		name: String(value.name ?? value.id),
		gain: finite(value.gain, 1),
		pan: finite(value.pan, 0),
		mute: value.mute === true,
		solo: value.solo === true,
		envelope: records(value.envelope),
		effects: Array.isArray(value.effects) ? value.effects : [],
	});
}

export function records(value: unknown): readonly DataRecord[] {
	return (Array.isArray(value) ? value : [])
		.filter((entry): entry is DataRecord => Boolean(entry) && typeof entry === 'object');
}

export function record(value: unknown): DataRecord {
	return value && typeof value === 'object' && !Array.isArray(value) ? value as DataRecord : {};
}

export function finite(value: unknown, fallback: number): number {
	const number = Number(value);
	return Number.isFinite(number) ? number : fallback;
}

function videoExtension(source: DataRecord): string {
	const name = String(source.name ?? '');
	const match = /\.([a-z0-9]{2,5})$/iu.exec(name);
	if (match) return `.${match[1]!.toLowerCase()}`;
	const mimeType = String(source.mimeType ?? '');
	if (mimeType === 'video/webm') return '.webm';
	if (mimeType === 'video/quicktime') return '.mov';
	return '.mp4';
}
