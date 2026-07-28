/* SPDX-License-Identifier: AGPL-3.0-only */

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

	const groups = initializeBusWidths(project?.mixer?.groups, fallback);
	const sends = initializeBusWidths(project?.mixer?.sends, fallback);
	for (const [trackId, trackWidth] of tracks) {
		const route = project?.mixer?.routes?.[trackId];
		const groupId = normalizedId(route?.groupId);
		if (groupId !== null && groups.has(groupId)) groups.set(groupId, Math.max(groups.get(groupId) ?? fallback, trackWidth));
		for (const [sendId, gain] of Object.entries(route?.sends ?? {})) {
			if (Number(gain) > 0 && sends.has(sendId)) sends.set(sendId, Math.max(sends.get(sendId) ?? fallback, trackWidth));
		}
	}

	return Object.freeze({ tracks, groups, sends });
}

function initializeBusWidths(buses: readonly TerminalWidthBus[] | undefined, fallback: number): Map<string, number> {
	const widths = new Map<string, number>();
	for (const bus of buses ?? []) {
		const id = normalizedId(bus.id);
		if (id !== null) widths.set(id, fallback);
	}
	return widths;
}

function supportedChannelCount(value: unknown): number {
	const channelCount = Number(value);
	if (!Number.isSafeInteger(channelCount) || channelCount <= 0) return 0;
	return Math.min(channelCount, MAX_WEB_AUDIO_CHANNELS);
}

function normalizedId(value: unknown): string | null {
	return value === null || value === undefined ? null : String(value);
}
