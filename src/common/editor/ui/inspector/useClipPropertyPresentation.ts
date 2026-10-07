/* SPDX-License-Identifier: AGPL-3.0-only */
import { useMemo } from 'react';
import { normalizeFramescaperImageClipV1 } from '../../timeline-image-model.ts';
import { normalizeSourceFrameRate } from '../../sequence-timecode.ts';
import { clipPropertiesSelection, type ClipPropertiesSelectionSnapshot } from './clip-properties-selection.ts';

export function useClipPropertiesSelection(snapshot: ClipPropertiesSelectionSnapshot, fallbackLabel: string) {
	const project = snapshot.project;
	return useMemo(() => clipPropertiesSelection(snapshot, fallbackLabel), [project?.id, project?.clips, project?.sources, project?.selection?.clipIds, snapshot.selectedClipIds, snapshot.selectedClipId, fallbackLabel]);
}

export function useImageClipPropertiesTarget(project: unknown, clipId: string) {
	const owner = record(project);
	const { clips, sources, sequences, tracks, sampleRate } = owner;
	return useMemo(() => {
		const clip = normalizeFramescaperImageClipV1(records(clips).find(item => item.id === clipId));
		const source = records(sources).find(item => item.id === clip.sourceId);
		const sequence = records(sequences).find(item => item.id === clip.sequenceId);
		const track = records(tracks).find(item => Array.isArray(item.clipIds) && item.clipIds.includes(clipId));
		if (!sequence || !track) throw new ReferenceError('An inspected image requires its timeline sequence and track.');
		return { clip, source, track, rate: normalizeSourceFrameRate(sequence.rate), sampleRate: Number(sampleRate) };
	}, [clips, sources, sequences, tracks, sampleRate, clipId]);
}

function record(value: unknown): Readonly<Record<string, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Image properties require a document record.');
	return value as Readonly<Record<string, unknown>>;
}
function records(value: unknown): readonly Readonly<Record<string, unknown>>[] {
	if (!Array.isArray(value)) throw new TypeError('Image properties require a document collection.');
	return value.map(record);
}
