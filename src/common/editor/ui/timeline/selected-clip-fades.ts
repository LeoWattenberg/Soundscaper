/* SPDX-License-Identifier: AGPL-3.0-only */

import type { BatchAudioEditorCommand } from '../../commands/protocol.ts';
import { shapesForNewClipFades } from '../../audio-clip-transition-gain.ts';
import { clipFadeLengthChange } from './clip-fade-edit.ts';
import { fadeField, fadeShapeField, type ClipFadeEdge, type FadeClip } from './clip-fade-geometry.ts';

export interface ClipFadeTarget extends FadeClip {
	readonly id: string;
	readonly kind?: string;
}

export interface SelectedClipFadeChanges {
	readonly fadeInFrames?: number;
	readonly fadeOutFrames?: number;
	readonly fadeInShape?: number | undefined;
	readonly fadeOutShape?: number | undefined;
}

export type SelectedClipFadeEdit =
	| Readonly<{ kind: 'length'; edge: ClipFadeEdge; frames: number }>
	| Readonly<{ kind: 'shape'; edge: ClipFadeEdge; shape: number | undefined }>
	| Readonly<{ kind: 'properties'; changes: SelectedClipFadeChanges }>;

export interface SelectedClipFadeRequest {
	readonly clips: readonly ClipFadeTarget[];
	readonly editedClipId: string;
	readonly selectedIds: ReadonlySet<string> | readonly string[];
	readonly sampleRate: number;
	readonly edit: SelectedClipFadeEdit;
}

export interface PlannedClipFadeEdit {
	readonly clipId: string;
	readonly changes: SelectedClipFadeChanges;
}

export interface PlannedClipFadePreview extends SelectedClipFadeChanges {
	readonly clipId: string;
	readonly trackId: string;
}

/** Audacity 20ce5547 fadeTargets: selected audio clips across tracks, or the touched clip alone. */
export function selectedClipFadeTargets<Clip extends ClipFadeTarget>(
	clips: readonly Clip[], editedClipId: string, selectedIds: ReadonlySet<string> | readonly string[],
): readonly Clip[] {
	const edited = clips.find(clip => clip.id === editedClipId && clip.kind === 'audio');
	if (!edited) return [];
	const selected = Array.isArray(selectedIds) ? new Set(selectedIds) : selectedIds as ReadonlySet<string>;
	return selected.has(editedClipId) ? clips.filter(clip => clip.kind === 'audio' && selected.has(clip.id)) : [edited];
}

/** Keep each clip's opposite fade and legacy shape independent; one shared length is an assignment. */
export function planSelectedClipFadeEdits(request: SelectedClipFadeRequest): readonly PlannedClipFadeEdit[] {
	return selectedClipFadeTargets(request.clips, request.editedClipId, request.selectedIds).flatMap(clip => {
		const changes = changesForClip(clip, request.edit, request.sampleRate);
		return changed(clip, changes) ? [{ clipId: clip.id, changes }] : [];
	});
}

/** Reuse the exact commit changes for drafts, including native S-curves on newly created fades. */
export function clipFadeEditsPreviews(
	edits: readonly PlannedClipFadeEdit[], trackIdsByClip: ReadonlyMap<string, string>,
): readonly PlannedClipFadePreview[] {
	return edits.map(({ clipId, changes }) => {
		const trackId = trackIdsByClip.get(clipId);
		if (!trackId) throw new RangeError(`Missing owning track for clip fade preview: ${clipId}.`);
		return { clipId, trackId, ...changes };
	});
}

/** Native batch admission retains all lock checks and publishes one undo step across tracks. */
export function clipFadeEditsCommand(edits: readonly PlannedClipFadeEdit[]): BatchAudioEditorCommand | null {
	return edits.length ? { type: 'batch', commands: edits.map(({ clipId, changes }) => ({
		type: 'clip/update', clipId, changes: { ...changes },
	})) } : null;
}

export function planSelectedClipFadeCommand(request: SelectedClipFadeRequest): BatchAudioEditorCommand | null {
	return clipFadeEditsCommand(planSelectedClipFadeEdits(request));
}

function changesForClip(clip: ClipFadeTarget, edit: SelectedClipFadeEdit, sampleRate: number): SelectedClipFadeChanges {
	if (edit.kind === 'shape') return { [fadeShapeField(edit.edge)]: edit.shape };
	let lengths: SelectedClipFadeChanges = {};
	if (edit.kind === 'length') lengths = clipFadeLengthChange(clip, edit.edge, edit.frames, sampleRate);
	else for (const edge of ['in', 'out'] as const) {
		const field = fadeField(edge);
		const frames = edit.changes[field];
		if (frames !== undefined) lengths = { ...lengths, ...clipFadeLengthChange({ ...clip, ...lengths }, edge, frames) };
	}
	const changes: SelectedClipFadeChanges = { ...lengths, ...shapesForNewClipFades(clip, lengths) };
	if (edit.kind !== 'properties') return changes;
	return {
		...changes,
		...(Object.hasOwn(edit.changes, 'fadeInShape') ? { fadeInShape: edit.changes.fadeInShape } : {}),
		...(Object.hasOwn(edit.changes, 'fadeOutShape') ? { fadeOutShape: edit.changes.fadeOutShape } : {}),
	};
}

function changed(clip: ClipFadeTarget, changes: SelectedClipFadeChanges): boolean {
	return (['fadeInFrames', 'fadeOutFrames', 'fadeInShape', 'fadeOutShape'] as const).some(field => (
		Object.hasOwn(changes, field) && changes[field] !== (field.endsWith('Frames') ? clip[field] ?? 0 : clip[field])
	));
}
