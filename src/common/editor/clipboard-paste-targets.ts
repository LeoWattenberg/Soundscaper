/* SPDX-License-Identifier: AGPL-3.0-only */

export interface ClipboardPasteTrack {
	readonly sourceTrackId: string;
	readonly sourceTrackType?: unknown;
	readonly sourceLaneGroupId?: unknown;
	readonly clips: readonly Readonly<Record<string, unknown>>[];
}

export interface PasteTargetTrack {
	readonly id: string;
	readonly type?: unknown;
	readonly clipIds?: unknown;
	readonly laneGroupId?: unknown;
	readonly locked?: unknown;
}

export function clipboardPasteTrackType(track: ClipboardPasteTrack): 'audio' | 'video' {
	if (track.sourceTrackType === 'video') return 'video';
	if (track.sourceTrackType === 'audio') return 'audio';
	return track.clips[0]?.kind === 'video' ? 'video' : 'audio';
}

/** Resolve existing destinations without allocating the fresh tracks a paste needs. */
export function planClipboardPasteTargets<Track extends PasteTargetTrack, ClipboardTrack extends ClipboardPasteTrack>(
	tracks: readonly Track[], selectedTrackId: string | null, clipboardTracks: readonly ClipboardTrack[],
): readonly (readonly Readonly<{ clipboardTrack: ClipboardTrack; target: Track | null }>[])[] {
	const mediaTracks = tracks.filter(isMediaTrack);
	const findTrack = (id: string) => mediaTracks.find(track => track.id === id) ?? null;
	const selected = selectedTrackId === null ? null : findTrack(selectedTrackId);
	const used = new Set<string>();
	const handled = new Set<string>();
	const groups = new Map<string, ClipboardTrack[]>();
	for (const track of clipboardTracks) if (typeof track.sourceLaneGroupId === 'string' && track.sourceLaneGroupId) {
		const grouped = groups.get(track.sourceLaneGroupId) ?? [];
		grouped.push(track);
		groups.set(track.sourceLaneGroupId, grouped);
	}
	const matches = (target: Track | null, source: ClipboardTrack): target is Track => Boolean(
		target && target.type === clipboardPasteTrackType(source) && !used.has(target.id),
	);
	const plan: Array<readonly Readonly<{ clipboardTrack: ClipboardTrack; target: Track | null }>[]> = [];
	const append = (entries: readonly Readonly<{ clipboardTrack: ClipboardTrack; target: Track | null }>[]) => {
		plan.push(entries);
		for (const { clipboardTrack, target } of entries) {
			handled.add(clipboardTrack.sourceTrackId);
			if (target) used.add(target.id);
		}
	};
	for (const clipboardTrack of clipboardTracks) {
		if (handled.has(clipboardTrack.sourceTrackId)) continue;
		const grouped = typeof clipboardTrack.sourceLaneGroupId === 'string' ? groups.get(clipboardTrack.sourceLaneGroupId) : null;
		const video = grouped?.find(track => clipboardPasteTrackType(track) === 'video');
		const audio = grouped?.find(track => clipboardPasteTrackType(track) === 'audio');
		if (grouped?.length === 2 && video && audio) {
			const selectedPair = selected?.laneGroupId
				? mediaTracks.filter(track => track.laneGroupId === selected.laneGroupId) : [];
			let pair: readonly Track[] | null = selectedPair.length === 2 && selectedPair[0]?.type === 'video'
				&& selectedPair[1]?.type === 'audio' && selectedPair.every(track => !used.has(track.id)) ? selectedPair : null;
			const originalVideo = findTrack(video.sourceTrackId);
			const originalAudio = findTrack(audio.sourceTrackId);
			if (!pair && matches(originalVideo, video) && matches(originalAudio, audio)
				&& originalVideo.laneGroupId && originalVideo.laneGroupId === originalAudio.laneGroupId) {
				pair = [originalVideo, originalAudio];
			}
			append([{ clipboardTrack: video, target: pair?.[0] ?? null }, { clipboardTrack: audio, target: pair?.[1] ?? null }]);
			continue;
		}
		const anchor = selected ? tracks.indexOf(selected) : -1;
		let target = anchor < 0 ? null : tracks.slice(anchor).filter(isMediaTrack).find(track => matches(track, clipboardTrack)) ?? null;
		if (!target) target = findTrack(clipboardTrack.sourceTrackId);
		if (!matches(target, clipboardTrack)) target = null;
		append([{ clipboardTrack, target }]);
	}
	return plan;
}

/** The document owns a validated descriptor; publish only its destination lock state. */
export function hasLockedClipboardPasteTarget(
	project: Readonly<{ tracks?: readonly PasteTargetTrack[] }> | null, clipboard: unknown, selectedTrackId: string | null,
): boolean {
	if (!project || !isRecord(clipboard) || !Array.isArray(clipboard.tracks)) return false;
	const tracks = clipboard.tracks.filter((track: unknown): track is ClipboardPasteTrack =>
		isRecord(track) && typeof track.sourceTrackId === 'string' && Array.isArray(track.clips));
	return planClipboardPasteTargets(project.tracks ?? [], selectedTrackId, tracks)
		.some(group => group.some(({ target }) => target?.locked === true));
}

function isMediaTrack<Track extends PasteTargetTrack>(track: Track): boolean {
	return (track.type === 'audio' || track.type === 'video') && Array.isArray(track.clipIds);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}
