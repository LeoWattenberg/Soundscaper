/* SPDX-License-Identifier: AGPL-3.0-only */

import type { StripRef } from './parameter-address.ts';

interface TerminalWidthSource {
	readonly id?: unknown;
	readonly channelCount?: unknown;
}

interface TerminalWidthClip {
	readonly id?: unknown;
	readonly sourceId?: unknown;
}

interface TerminalWidthTrack {
	readonly id?: unknown;
	readonly type?: unknown;
	readonly clipIds?: readonly unknown[];
}

interface TerminalWidthBus {
	readonly id?: unknown;
	readonly channelCount?: unknown;
}

interface TerminalWidthRoute {
	readonly groupId?: unknown;
	readonly sends?: Readonly<Record<string, unknown>>;
}

export interface TerminalWidthProject {
	readonly sources?: readonly TerminalWidthSource[];
	readonly clips?: readonly TerminalWidthClip[];
	readonly tracks?: readonly TerminalWidthTrack[];
	readonly mixer?: Readonly<{
		groups?: readonly TerminalWidthBus[];
		sends?: readonly TerminalWidthBus[];
		routes?: Readonly<Record<string, TerminalWidthRoute>>;
	}>;
}

export interface TerminalChannelWidths {
	readonly tracks: ReadonlyMap<string, number>;
	readonly groups: ReadonlyMap<string, number>;
	readonly sends: ReadonlyMap<string, number>;
}

const MAX_WEB_AUDIO_CHANNELS = 32;

interface PanProject extends TerminalWidthProject {
	readonly masterChannels?: number;
	readonly metadata?: Readonly<{ adm?: Readonly<{ mode?: unknown }> }>;
	readonly mixer?: TerminalWidthProject['mixer'] & Readonly<{
		schemaVersion?: unknown;
		edges?: readonly unknown[];
		cues?: readonly TerminalWidthBus[];
	}>;
}

/** Preserve channel identity where the engine deliberately suspends stereo pan. */
export function stereoStripPanAvailable(channelCount: number, admMode: unknown): boolean {
	return channelCount <= 2 && admMode !== 'authored' && admMode !== 'passthrough';
}

/** The controls and automation selector must offer only an audible strip pan. */
export function projectStripPanAvailable(projectValue: unknown, strip: StripRef): boolean {
	const project = projectValue as PanProject | null | undefined;
	const mode = project?.metadata?.adm?.mode;
	if (!stereoStripPanAvailable(2, mode)) return false;
	const mixer = project?.mixer;
	if (mixer?.schemaVersion !== 1 || !Array.isArray(mixer.edges)) return true;
	const fallback = supportedChannelCount(project?.masterChannels) || 2;
	const widths = resolveTerminalChannelWidths(project, fallback);
	const width = strip.kind === 'master' ? fallback : strip.kind === 'track'
		? widths.tracks.get(strip.id) ?? 2
		: widths.groups.get(strip.id) ?? widths.sends.get(strip.id)
			?? (supportedChannelCount(mixer.cues?.find(cue => cue.id === strip.id)?.channelCount) || fallback);
	return stereoStripPanAvailable(width, mode);
}

/** Resolve the channel width that actually reaches every terminal mixer strip. */
export function resolveTerminalChannelWidths(
	project: TerminalWidthProject | null | undefined,
	fallbackChannelCount = 2,
): TerminalChannelWidths {
	const fallback = supportedChannelCount(fallbackChannelCount) || 2;
	const sourceWidths = new Map<string, number>();
	for (const source of project?.sources ?? []) {
		const id = normalizedId(source.id);
		if (id === null) continue;
		sourceWidths.set(id, supportedChannelCount(source.channelCount));
	}
	const clipSources = new Map<string, string>();
	for (const clip of project?.clips ?? []) {
		const id = normalizedId(clip.id);
		const sourceId = normalizedId(clip.sourceId);
		if (id !== null && sourceId !== null) clipSources.set(id, sourceId);
	}

	const tracks = new Map<string, number>();
	for (const [index, track] of (project?.tracks ?? []).entries()) {
		if (track.type === 'label' || track.type === 'video') continue;
		const id = normalizedId(track.id) ?? String(index);
		let width = 0;
		for (const clipIdValue of Array.isArray(track.clipIds) ? track.clipIds : []) {
			const clipId = normalizedId(clipIdValue);
			const sourceId = clipId === null ? null : clipSources.get(clipId);
			if (sourceId !== undefined && sourceId !== null) width = Math.max(width, sourceWidths.get(sourceId) ?? 0);
		}
		tracks.set(id, width || fallback);
	}

	const groups = initializeBusWidths(project?.mixer?.groups);
	const sends = initializeBusWidths(project?.mixer?.sends);
	for (const [trackId, trackWidth] of tracks) {
		const route = project?.mixer?.routes?.[trackId];
		const groupId = normalizedId(route?.groupId);
		if (groupId !== null && groups.has(groupId)) groups.set(groupId, Math.max(groups.get(groupId) ?? 0, trackWidth));
		for (const [sendId, gain] of Object.entries(route?.sends ?? {})) {
			if (Number(gain) > 0 && sends.has(sendId)) sends.set(sendId, Math.max(sends.get(sendId) ?? 0, trackWidth));
		}
	}
	applyUnfedBusFallback(groups, fallback);
	applyUnfedBusFallback(sends, fallback);

	return Object.freeze({ tracks, groups, sends });
}

/**
 * Bus widths, starting from whatever the bus declares about itself.
 *
 * A production mixer bus states its own channel count; the older graph inferred
 * one from the tracks routed into it. A declared width is the better answer and
 * the only one available on a graph whose routing lives in edges rather than in
 * a route map, so it wins and the inference fills the rest.
 */
function initializeBusWidths(buses: readonly TerminalWidthBus[] | undefined): Map<string, number> {
	const widths = new Map<string, number>();
	for (const bus of buses ?? []) {
		const id = normalizedId(bus.id);
		if (id !== null) widths.set(id, supportedChannelCount(bus.channelCount));
	}
	return widths;
}

function applyUnfedBusFallback(widths: Map<string, number>, fallback: number): void {
	for (const [id, width] of widths) if (width === 0) widths.set(id, fallback);
}

function supportedChannelCount(value: unknown): number {
	const channelCount = Number(value);
	if (!Number.isSafeInteger(channelCount) || channelCount <= 0) return 0;
	return Math.min(channelCount, MAX_WEB_AUDIO_CHANNELS);
}

function normalizedId(value: unknown): string | null {
	return value === null || value === undefined ? null : String(value);
}
