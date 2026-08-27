/* SPDX-License-Identifier: AGPL-3.0-only */

/** Admit one active video occurrence plus only the audio peer selected with its A/V link. */

type DataRecord = Readonly<Record<string, unknown>>;

export function assertLocalAssistanceSelectedVideoOccurrenceSelection(
	project: Readonly<{
		readonly selection?: DataRecord | null;
		readonly clips: readonly DataRecord[];
	}>,
	clip: DataRecord,
): void {
	const selection = project.selection;
	if (!selection || !Object.hasOwn(selection, 'clipIds')) return;
	if (!Array.isArray(selection.clipIds) || selection.clipIds.length < 1
		|| new Set(selection.clipIds).size !== selection.clipIds.length
		|| !selection.clipIds.includes(clip.id)) refuse();
	const peers = selection.clipIds.filter((candidate) => candidate !== clip.id);
	if (peers.length === 0) return;
	const linkId = clip.avLinkId;
	const linkedAudio = typeof linkId === 'string' && linkId.length > 0
		? project.clips.filter((candidate) => candidate.kind === 'audio'
			&& candidate.avLinkId === linkId)
		: [];
	if (peers.length !== 1 || linkedAudio.length !== 1 || peers[0] !== linkedAudio[0]!.id) refuse();
}

function refuse(): never {
	throw new Error('Local assistance requires one selected video occurrence.');
}
