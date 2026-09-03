/* SPDX-License-Identifier: AGPL-3.0-only */

import { addDeliveryReportItem, type createDeliveryReport } from './delivery-report.ts';
import { clamp, parameterToLinearGain, parameterToPan } from './dawproject-format.ts';
import type { DawprojectChannel, DawprojectDocument, DawprojectTrack } from './dawproject-import.ts';
import type { DawprojectAudioEvent, DawprojectAutomationEvent } from './dawproject-import-timeline.ts';

/**
 * The structural half of the DAWproject importer: tracks, folders, buses,
 * routing, and channel automation, accumulated into one build the assembler
 * turns into a document.
 *
 * A DAWproject `Track` is one of several things here. One with children is a
 * folder, and a top-level folder with a channel owns a group bus that shares
 * its id — the folder-bus identity rule of this project. A childless track's
 * channel role decides the rest: master, submix, effect, or an audio track.
 * Membership matters for routing: a folder bus takes only its own tracks, so a
 * track routed into a group it is not inside routes to the master and the
 * report says so, rather than the route silently vanishing on document load.
 */

export type Draft = ReturnType<typeof createDeliveryReport>;
export type DataRecord = Record<string, unknown>;

export interface EnvelopePoint {
	frame: number;
	value: number;
}

export interface TrackBuild {
	readonly id: string;
	readonly name: string;
	readonly gain: number;
	readonly pan: number;
	readonly mute: boolean;
	readonly solo: boolean;
	readonly clipIds: string[];
	envelope: EnvelopePoint[];
}

export interface StripBuild {
	readonly id: string;
	readonly name: string;
	readonly gain: number;
	readonly pan: number;
	readonly mute: boolean;
	readonly solo: boolean;
	envelope: EnvelopePoint[];
}

export interface ParameterTarget {
	readonly kind: 'track' | 'master' | 'group' | 'send';
	readonly id: string | null;
	readonly parameter: 'volume' | 'pan' | 'mute';
	readonly unit: string | null;
}

export interface Build {
	readonly draft: Draft;
	readonly sampleRate: number;
	readonly createStableId: (prefix: string) => string;
	readonly tracks: TrackBuild[];
	readonly trackByDawId: Map<string, TrackBuild>;
	readonly trackNodes: DataRecord[];
	readonly folders: DataRecord[];
	readonly groups: StripBuild[];
	readonly sends: StripBuild[];
	readonly stripByChannelId: Map<string, Readonly<{ kind: 'group' | 'send' | 'folder'; id: string }>>;
	readonly parameters: Map<string, ParameterTarget>;
	readonly routes: Map<string, { groupId: string | null; sends: Record<string, number> }>;
	/** Parent folder per built track and per folder, for bus membership. */
	readonly parentFolderIds: Map<string, string | null>;
	master: StripBuild;
	omittedTracks: number;
	omittedNodes: number;
	devices: number;
}

const MAXIMUM_ENVELOPE_VALUE = 16;

export function walkTrack(track: DawprojectTrack, parentFolderId: string | null, build: Build, document: DawprojectDocument): void {
	const channel = track.channel;
	const role = channel?.role ?? 'regular';
	build.devices += channel?.devices ?? 0;
	if (track.children.length > 0) {
		const id = build.createStableId('folder');
		build.folders.push({ id, name: track.name || 'Folder' });
		build.trackNodes.push({ kind: 'folder', id, parentFolderId });
		build.parentFolderIds.set(id, parentFolderId);
		if (channel) {
			// Only a top-level folder owns a bus here; a nested group's channel
			// merges into its top-level ancestor's bus, which the report says.
			if (parentFolderId === null) {
				build.groups.push(strip(id, track.name || 'Folder', channel));
				registerParameters(channel, { kind: 'group', id }, build);
			} else {
				addDeliveryReportItem(build.draft, {
					code: 'dawproject.nested-bus-converted', disposition: 'converted', severity: 'warning',
					scope: { kind: 'folder', id }, data: { name: track.name },
					message: 'A group inside a group has no bus of its own here; its tracks feed the top-level folder\'s bus and its fader is not imported.',
				});
			}
			if (channel.id) build.stripByChannelId.set(channel.id, { kind: 'folder', id: topLevelFolder(id, build) });
		}
		for (const child of track.children) walkTrack(child, id, build, document);
		return;
	}
	if (role === 'master') {
		build.master = strip('master', 'Master', channel!);
		registerParameters(channel!, { kind: 'master', id: null }, build);
		return;
	}
	if (role === 'submix' || role === 'effect') {
		const id = build.createStableId(role === 'submix' ? 'group-bus' : 'send-bus');
		(role === 'submix' ? build.groups : build.sends).push(strip(id, track.name || (role === 'submix' ? 'Group' : 'Send'), channel!));
		if (channel!.id) build.stripByChannelId.set(channel!.id, { kind: role === 'submix' ? 'group' : 'send', id });
		registerParameters(channel!, { kind: role === 'submix' ? 'group' : 'send', id }, build);
		return;
	}
	if (role === 'vca') {
		build.omittedNodes += 1;
		return;
	}
	if (track.contentTypes.length > 0 && !track.contentTypes.includes('audio')) {
		build.omittedTracks += 1;
		addDeliveryReportItem(build.draft, {
			code: 'dawproject.track-content-omitted', disposition: 'omitted', severity: 'warning',
			scope: { kind: 'track', id: track.id ?? track.name },
			data: { name: track.name, contentTypes: track.contentTypes },
			message: 'The track holds no audio; note, automation, and video tracks have no audio track to become.',
		});
		return;
	}
	const built = createAudioTrack(track.name, channel, build);
	if (track.id) build.trackByDawId.set(track.id, built);
	if (channel) registerParameters(channel, { kind: 'track', id: built.id }, build);
	build.trackNodes.push({ kind: 'track', id: built.id, parentFolderId });
	build.parentFolderIds.set(built.id, parentFolderId);
}

function topLevelFolder(folderId: string, build: Build): string {
	let current = folderId;
	for (;;) {
		const parent = build.parentFolderIds.get(current) ?? null;
		if (parent === null) return current;
		current = parent;
	}
}

function isInsideFolder(trackId: string, folderId: string, build: Build): boolean {
	let current = build.parentFolderIds.get(trackId) ?? null;
	while (current !== null) {
		if (current === folderId) return true;
		current = build.parentFolderIds.get(current) ?? null;
	}
	return false;
}

function createAudioTrack(name: string, channel: DawprojectChannel | null, build: Build): TrackBuild {
	const built: TrackBuild = {
		id: build.createStableId('track'),
		name: name || `Track ${String(build.tracks.length + 1)}`,
		gain: clamp(gainOf(channel?.volume), 0, 4),
		pan: panOf(channel?.pan),
		mute: channel?.mute?.value === true,
		solo: channel?.solo === true,
		clipIds: [],
		envelope: [],
	};
	build.tracks.push(built);
	return built;
}

function strip(id: string, name: string, channel: DawprojectChannel): StripBuild {
	return {
		id, name, gain: clamp(gainOf(channel.volume), 0, 4), pan: panOf(channel.pan),
		mute: channel.mute?.value === true, solo: channel.solo, envelope: [],
	};
}

function registerParameters(channel: DawprojectChannel, target: Readonly<{ kind: ParameterTarget['kind']; id: string | null }>, build: Build): void {
	if (channel.volume?.id) build.parameters.set(channel.volume.id, { ...target, parameter: 'volume', unit: channel.volume.unit });
	if (channel.pan?.id) build.parameters.set(channel.pan.id, { ...target, parameter: 'pan', unit: channel.pan.unit });
	if (channel.mute?.id) build.parameters.set(channel.mute.id, { ...target, parameter: 'mute', unit: null });
}

export function resolveRouting(document: DawprojectDocument, build: Build): void {
	const visit = (track: DawprojectTrack): void => {
		for (const child of track.children) visit(child);
		const built = track.id ? build.trackByDawId.get(track.id) : undefined;
		const channel = track.channel;
		if (!built || !channel) return;
		const route = { groupId: null as string | null, sends: {} as Record<string, number> };
		const destination = channel.destination ? build.stripByChannelId.get(channel.destination) : undefined;
		if (destination?.kind === 'group') route.groupId = destination.id;
		else if (destination?.kind === 'folder') {
			// A folder's bus is fed by its members and nothing else; a track that
			// routes into a group it is not inside has no route to keep.
			if (isInsideFolder(built.id, destination.id, build)) route.groupId = destination.id;
			else {
				addDeliveryReportItem(build.draft, {
					code: 'dawproject.routing-omitted', disposition: 'omitted', severity: 'warning',
					scope: { kind: 'track', id: built.id }, data: { name: track.name },
					message: 'The track feeds a group it is not inside; folder buses here take only their own tracks, so the track routes to the master.',
				});
			}
		}
		for (const send of channel.sends) {
			if (!send.enabled || !send.destination) continue;
			const target = build.stripByChannelId.get(send.destination);
			if (target?.kind !== 'send') continue;
			route.sends[target.id] = clamp(gainOf(send.volume), 0, 4);
		}
		if (route.groupId !== null || Object.keys(route.sends).length > 0) build.routes.set(built.id, route);
	};
	for (const track of document.tracks) visit(track);
}

export function trackForEvent(event: DawprojectAudioEvent, build: Build, document: DawprojectDocument): TrackBuild {
	if (event.trackId) {
		const existing = build.trackByDawId.get(event.trackId);
		if (existing) return existing;
		const declared = findTrack(document.tracks, event.trackId);
		const built = createAudioTrack(declared?.name ?? event.trackId, declared?.channel ?? null, build);
		build.trackByDawId.set(event.trackId, built);
		build.trackNodes.push({ kind: 'track', id: built.id, parentFolderId: null });
		return built;
	}
	const fallback = build.trackByDawId.get('');
	if (fallback) return fallback;
	const built = createAudioTrack('Imported audio', null, build);
	build.trackByDawId.set('', built);
	build.trackNodes.push({ kind: 'track', id: built.id, parentFolderId: null });
	return built;
}

function findTrack(tracks: readonly DawprojectTrack[], id: string): DawprojectTrack | null {
	for (const track of tracks) {
		if (track.id === id) return track;
		const nested = findTrack(track.children, id);
		if (nested) return nested;
	}
	return null;
}

export function applyAutomation(events: readonly DawprojectAutomationEvent[], build: Build): void {
	for (const event of events) {
		const target = event.parameterId ? build.parameters.get(event.parameterId) : undefined;
		if (!target) {
			addDeliveryReportItem(build.draft, {
				code: 'dawproject.automation-omitted', disposition: 'omitted', severity: 'warning',
				scope: { kind: 'automation', id: event.parameterId ?? '' }, data: { points: event.points.length },
				message: 'The automation targets a parameter that is not a written channel\'s volume, pan, or mute — a plug-in or an unknown id — and is not imported.',
			});
			continue;
		}
		if (target.parameter !== 'volume') {
			addDeliveryReportItem(build.draft, {
				code: 'dawproject.automation-omitted', disposition: 'omitted', severity: 'warning',
				scope: { kind: 'automation', id: event.parameterId ?? '' }, data: { parameter: target.parameter, points: event.points.length },
				message: 'Only volume automation has a track envelope to become; pan and mute automation are not imported.',
			});
			continue;
		}
		const envelope: EnvelopePoint[] = [];
		let held = 0;
		for (const point of event.points) {
			const value = parameterToLinearGain(point.value, event.unit ?? target.unit);
			if (value === null) continue;
			const frame = Math.max(0, point.frame);
			if (point.interpolation === 'hold') held += 1;
			const last = envelope.at(-1);
			if (last && last.frame >= frame) last.value = clamp(value, 0, MAXIMUM_ENVELOPE_VALUE);
			else envelope.push({ frame, value: clamp(value, 0, MAXIMUM_ENVELOPE_VALUE) });
		}
		if (envelope.length === 0) continue;
		const owner = target.kind === 'master'
			? build.master
			: target.kind === 'track'
				? build.tracks.find((track) => track.id === target.id)
				: [...build.groups, ...build.sends].find((candidate) => candidate.id === target.id);
		if (!owner) continue;
		owner.envelope = envelope;
		if (held > 0) {
			addDeliveryReportItem(build.draft, {
				code: 'dawproject.automation-hold-converted', disposition: 'converted', severity: 'info',
				scope: { kind: target.kind, id: target.id ?? 'master' }, data: { points: held },
				message: 'Volume envelopes interpolate linearly here; a held automation point becomes a line to the next.',
			});
		}
		addDeliveryReportItem(build.draft, {
			code: 'dawproject.automation-preserved', disposition: 'preserved', severity: 'info',
			scope: { kind: target.kind, id: target.id ?? 'master' }, data: { points: envelope.length },
			message: 'Volume automation becomes the strip\'s envelope.',
		});
	}
}

export function stripRecord(value: StripBuild): DataRecord {
	return { id: value.id, name: value.name, gain: value.gain, pan: value.pan, mute: value.mute, solo: value.solo, envelope: value.envelope };
}

function gainOf(parameter: Readonly<{ value: number | null; unit: string | null }> | null | undefined): number {
	if (!parameter || parameter.value === null) return 1;
	return parameterToLinearGain(parameter.value, parameter.unit) ?? 1;
}

function panOf(parameter: Readonly<{ value: number | null; unit: string | null }> | null | undefined): number {
	if (!parameter || parameter.value === null) return 0;
	return parameterToPan(parameter.value, parameter.unit) ?? 0;
}
