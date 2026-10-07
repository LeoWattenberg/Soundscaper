/* SPDX-License-Identifier: AGPL-3.0-only */

import { sequenceForTrack } from './clipboard-time-runtime.js';
import { requireIndexedTrack } from './clip-edit-index.ts';

interface FeatureClip { readonly kind?: unknown }
interface ClipboardSequence extends Record<string, unknown> { readonly id: string; readonly trackIds?: readonly string[] }
interface SequenceProject extends Record<string, unknown> {
	readonly sequences?: readonly ClipboardSequence[];
	readonly primarySequenceId?: string;
	readonly sampleRate: number;
}

/** Reuse one detached sequence result per track during descriptor construction. */
export function createClipboardSequenceReader(projectValue: object, tracks: ReadonlyMap<string, unknown>): (id: string) => ClipboardSequence {
	const project = projectValue as SequenceProject;
	const owners = new Map<string, ClipboardSequence>();
	const resolved = new Map<string, ClipboardSequence>();
	let malformed = false;
	let primary: ClipboardSequence | undefined;
	for (const sequence of project.sequences ?? []) {
		if (!primary && sequence.id === project.primarySequenceId) primary = sequence;
		if (sequence.trackIds !== undefined && !Array.isArray(sequence.trackIds)) { malformed = true; continue; }
		for (const id of sequence.trackIds ?? []) if (!owners.has(id)) owners.set(id, sequence);
	}
	return id => {
		requireIndexedTrack(tracks, id);
		const cached = resolved.get(id);
		if (cached) return cached;
		const sequence = malformed ? sequenceForTrack(project, id) as ClipboardSequence : owners.get(id) ?? primary;
		if (!sequence) throw new ReferenceError(`Track ${id} does not belong to a sequence.`);
		const value = { ...sequence, sampleRate: project.sampleRate };
		resolved.set(id, value);
		return value;
	};
}

/** Inspect both descriptor capabilities without allocating a combined project/bin list. */
export function clipboardFeatureFlags(clips: readonly FeatureClip[], binClips: readonly FeatureClip[]): {
	keyframeClipboard: boolean;
	compositionClipboard: boolean;
} {
	let keyframeClipboard = false;
	let compositionClipboard = false;
	for (const collection of [clips, binClips]) for (const clip of collection) {
		if (clip.kind !== 'video') continue;
		keyframeClipboard ||= Object.hasOwn(clip, 'videoKeyframes');
		compositionClipboard ||= Object.hasOwn(clip, 'videoComposition');
		if (keyframeClipboard && compositionClipboard) return { keyframeClipboard, compositionClipboard };
	}
	return { keyframeClipboard, compositionClipboard };
}
