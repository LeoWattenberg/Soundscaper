/* SPDX-License-Identifier: AGPL-3.0-only */

import { clipsOverlap } from '../project.js';
import { hasSequenceGeometryProjectAuthority } from '../project-schema-version.ts';
import { scaleClipboardClip } from './clipboard-clip-scaling-runtime.js';
import { sequenceForTrack } from './clipboard-time-runtime.js';
import { assertClipSourceBounds, normalizeClipForProject, requireTrack } from './shared-runtime.js';
import { createClipEditIndex } from './clip-edit-index.ts';
import { firstById } from './editing-work-index.ts';
import type { AudioEditorClipboard } from './protocol.ts';

interface Clip extends Record<string, unknown> {
	id: string;
	sourceId: string;
	timelineStartFrame: number;
	durationFrames: number;
}
interface Track extends Record<string, unknown> { id: string; clipIds: string[] }
interface Project extends Record<string, unknown> {
	clips: Clip[];
	sources: (Record<string, unknown> & { id: string })[];
	projectBin?: { clips: Clip[] };
}
interface PasteCommand {
	readonly trackMap?: Readonly<Record<string, string>>;
	readonly clipIds?: Readonly<Record<string, string>>;
	readonly groupIds?: Readonly<Record<string, string>>;
	readonly avLinkIds?: Readonly<Record<string, string>>;
	readonly videoEffectIds?: Readonly<Record<string, readonly string[]>>;
}

// The existing JavaScript scaler's optional defaults otherwise infer only null
// and undefined at this strict-TypeScript call boundary.
const scaleClip = scaleClipboardClip as unknown as (
	descriptor: Readonly<Record<string, unknown>>, scale: number, atFrame: number, id: string,
	groupIds: Readonly<Record<string, string>>, avLinkIds: Readonly<Record<string, string>>,
	videoEffectIds: readonly string[] | undefined, targetSequence: unknown, conformedAnchor: unknown,
) => Record<string, unknown>;
const assertSourceBounds = assertClipSourceBounds as unknown as (project: object, clip: Clip, source: unknown) => void;

/** Stage every addition before publication; all indexes are rebuilt after collision edits. */
export function stageClipboardClipAdditions(
	projectValue: object, clipboard: AudioEditorClipboard, command: PasteCommand,
	scale: number, atFrame: number, mode: string, conformedAnchorBySequenceId: ReadonlyMap<string, unknown>,
): { track: Track; clip: Clip }[] {
	const project = projectValue as Project;
	const additions: { track: Track; clip: Clip }[] = [];
	const clipIds = new Set(project.clips.map(clip => clip.id));
	for (const clip of project.projectBin?.clips ?? []) clipIds.add(clip.id);
	const sources = firstById(project.sources);
	const clipIndex = mode === 'reject' ? createClipEditIndex(project.clips) : null;
	const existingByTrack = new Map<string, Clip[]>();
	const pendingByTrack = new Map<string, Clip[]>();
	for (const clipboardTrack of clipboard.tracks || []) {
		const targetTrack = requireTrack(project, command.trackMap?.[clipboardTrack.sourceTrackId] || clipboardTrack.sourceTrackId) as Track;
		const targetSequence = hasSequenceGeometryProjectAuthority(project)
			? sequenceForTrack(project, targetTrack.id) as Record<string, unknown> & { id: string }
			: null;
		const conformedAnchor = targetSequence ? conformedAnchorBySequenceId.get(targetSequence.id) : null;
		for (const descriptor of clipboardTrack.clips || []) {
			const key = descriptor.key as string;
			const id = command.clipIds?.[key];
			if (!id) throw new TypeError(`A stable pasted clip ID is required for ${key}.`);
			if (clipIds.has(id)) throw new RangeError(`Duplicate clip ID: ${id}.`);
			const clip = normalizeClipForProject(project, scaleClip(
				descriptor, scale, atFrame, id, command.groupIds || {}, command.avLinkIds || {},
				command.videoEffectIds?.[key], targetSequence, conformedAnchor,
			)) as Clip;
			assertSourceBounds(project, clip, sources.get(clip.sourceId));
			if (mode === 'reject' && clipIndex) {
				let existing = existingByTrack.get(targetTrack.id);
				if (!existing) {
					existing = targetTrack.clipIds.map(clipId => clipIndex.require(clipId));
					existingByTrack.set(targetTrack.id, existing);
				}
				const pending = pendingByTrack.get(targetTrack.id) ?? [];
				if (existing.some(candidate => clipsOverlap(candidate, clip)) || pending.some(candidate => clipsOverlap(candidate, clip))) {
					throw new RangeError(`Clip overlaps existing material on track ${targetTrack.id}.`);
				}
				pending.push(clip);
				pendingByTrack.set(targetTrack.id, pending);
			}
			// Pending IDs intentionally remain unreserved: persisted command admission
			// retains its authority over duplicate IDs within this staged command.
			additions.push({ track: targetTrack, clip });
		}
	}
	return additions;
}
