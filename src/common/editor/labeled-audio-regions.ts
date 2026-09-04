/*
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * Region derivation for Audacity 3's Labeled Audio submenu.
 *
 * Upstream lives in au3/src/menus/LabelMenus.cpp: GetRegionsByLabel collects
 * every label of a selected label track that lies wholly inside the time
 * selection, sorts them and merges the overlapping ones, and
 * GetTracksToEditByLabel picks the playable tracks to act on — the selected
 * ones when any is selected, otherwise all of them.
 *
 * One rule is widened here. Upstream reads labels only from *selected* label
 * tracks, which in Audacity is the natural result of dragging a selection
 * across a label track and the audio below it. Soundscaper's timeline
 * selection does not always carry the label track along, so when no label
 * track is selected every label track contributes — the same fallback
 * upstream already applies one function later to the tracks being edited.
 */

export interface LabeledAudioRegion {
	readonly startFrame: number;
	readonly endFrame: number;
}

export interface LabeledAudioSelection {
	readonly startFrame: number;
	readonly endFrame: number;
}

export interface LabeledAudioTargets {
	readonly regions: readonly LabeledAudioRegion[];
	readonly trackIds: readonly string[];
}

interface LabeledAudioLabel {
	readonly startFrame?: unknown;
	readonly endFrame?: unknown;
}

interface LabeledAudioTrack {
	readonly id: unknown;
	readonly type?: unknown;
	readonly clipIds?: unknown;
	readonly labels?: unknown;
}

interface LabeledAudioProject {
	readonly tracks?: readonly LabeledAudioTrack[];
}

/**
 * Collect the labelled regions of a project that lie inside the time
 * selection. Point labels survive as zero-length regions; only the operations
 * that need a span discard them.
 */
export function selectLabeledAudioRegions(
	project: LabeledAudioProject | null | undefined,
	selection: LabeledAudioSelection | null | undefined,
	selectedTrackIds: readonly string[] = [],
): readonly LabeledAudioRegion[] {
	if (!project || !selection) return Object.freeze([]);
	if (!Number.isSafeInteger(selection.startFrame) || !Number.isSafeInteger(selection.endFrame)) return Object.freeze([]);
	if (selection.endFrame <= selection.startFrame) return Object.freeze([]);
	const labelTracks = (project.tracks || []).filter((track) => track.type === 'label');
	const selectedIds = new Set(selectedTrackIds);
	const chosen = labelTracks.filter((track) => selectedIds.has(String(track.id)));
	const sources = chosen.length > 0 ? chosen : labelTracks;
	const regions: LabeledAudioRegion[] = [];
	for (const track of sources) {
		for (const label of Array.isArray(track.labels) ? (track.labels as readonly LabeledAudioLabel[]) : []) {
			const startFrame = Number(label.startFrame);
			const endFrame = Number(label.endFrame);
			if (!Number.isSafeInteger(startFrame) || !Number.isSafeInteger(endFrame)) continue;
			if (endFrame < startFrame) continue;
			if (startFrame < selection.startFrame || endFrame > selection.endFrame) continue;
			regions.push({ startFrame, endFrame });
		}
	}
	return Object.freeze(mergeLabeledAudioRegions(regions));
}

/**
 * Merge overlapping regions the way upstream does: a region that starts before
 * its predecessor ends is absorbed, while regions that merely touch stay apart
 * so adjacent labels keep producing separate edits.
 */
export function mergeLabeledAudioRegions(
	regions: readonly LabeledAudioRegion[],
): readonly LabeledAudioRegion[] {
	const sorted = [...regions].sort((left, right) => (
		left.startFrame - right.startFrame || left.endFrame - right.endFrame
	));
	const merged: LabeledAudioRegion[] = [];
	for (const region of sorted) {
		const previous = merged.at(-1);
		if (previous && region.startFrame < previous.endFrame) {
			if (region.endFrame > previous.endFrame) {
				merged[merged.length - 1] = { startFrame: previous.startFrame, endFrame: region.endFrame };
			}
			continue;
		}
		merged.push({ startFrame: region.startFrame, endFrame: region.endFrame });
	}
	return Object.freeze(merged.map((region) => Object.freeze(region)));
}

/**
 * Resolve the media tracks a labelled edit acts on: the selected ones when the
 * user selected any, and otherwise every track that carries clips.
 */
export function selectLabeledAudioEditTrackIds(
	project: LabeledAudioProject | null | undefined,
	selectedTrackIds: readonly string[] = [],
): readonly string[] {
	const mediaTracks = (project?.tracks || []).filter((track) => Array.isArray(track.clipIds));
	const selectedIds = new Set(selectedTrackIds);
	const chosen = mediaTracks.filter((track) => selectedIds.has(String(track.id)));
	const resolved = chosen.length > 0 ? chosen : mediaTracks;
	return Object.freeze(resolved.map((track) => String(track.id)));
}

/** Resolve both halves of a labelled edit, or null when there is nothing to act on. */
export function selectLabeledAudioTargets(
	project: LabeledAudioProject | null | undefined,
	selection: LabeledAudioSelection | null | undefined,
	selectedTrackIds: readonly string[] = [],
): LabeledAudioTargets | null {
	const regions = selectLabeledAudioRegions(project, selection, selectedTrackIds);
	if (regions.length === 0) return null;
	const trackIds = selectLabeledAudioEditTrackIds(project, selectedTrackIds);
	if (trackIds.length === 0) return null;
	return Object.freeze({ regions, trackIds });
}

/** Regions that cover audio, which is every operation except Split and Join. */
export function labeledAudioSpanRegions(
	regions: readonly LabeledAudioRegion[],
): readonly LabeledAudioRegion[] {
	return Object.freeze(regions.filter((region) => region.endFrame > region.startFrame));
}
