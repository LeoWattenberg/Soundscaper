/* SPDX-License-Identifier: AGPL-3.0-only */

type DataRecord = Readonly<Record<string, unknown>>;

export interface AudioWarpApplicationMenuInput {
	readonly productId: string;
	readonly capability: boolean;
	readonly project: unknown;
	readonly selectedClipId: string | null;
	readonly editingBlocked: boolean;
	readonly copy: Readonly<Record<string, string>>;
	open(): unknown;
}

/** Menu-only selected-audio entry point; Framescaper receives no item. */
export function createAudioWarpApplicationMenuItems(input: AudioWarpApplicationMenuInput) {
	if (input.productId !== 'soundscaper' || !input.capability) return Object.freeze([]);
	const project = dataRecord(input.project);
	const clips = dataRecords(project?.clips);
	const tracks = dataRecords(project?.tracks);
	const clip = clips.find(({ id }) => id === input.selectedClipId && id != null) ?? null;
	const owners = clip ? tracks.filter((track) => (
		Array.isArray(track.clipIds) && track.clipIds.includes(clip.id)
	)) : [];
	const selectedAudio = clip?.kind === 'audio' && clip.reversed !== true && owners.length === 1;
	return Object.freeze([Object.freeze({
		id: 'audio-warp-editor',
		label: input.copy.audioWarpMenu,
		disabled: project?.schemaVersion !== 17 || !selectedAudio
			|| input.editingBlocked || owners[0]?.locked === true,
		onClick: input.open,
	})]);
}

function dataRecord(value: unknown): DataRecord | null {
	return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as DataRecord : null;
}

function dataRecords(value: unknown): readonly DataRecord[] {
	return Array.isArray(value) ? value.map(dataRecord).filter((item): item is DataRecord => item !== null) : [];
}
