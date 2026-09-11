/* SPDX-License-Identifier: AGPL-3.0-only */

import { createEnvelopeValueEvaluator } from '../../automation.js';
import type {
	AudioEditorClipboardTrack,
	AudioEditorCommand,
	CommandObject,
} from '../../commands/protocol.ts';
import {
	findControllerSource,
	type ControllerClip,
	type ControllerProject,
	type ControllerSource,
	type ControllerSourceInventory,
	type DerivedSourceRecord,
} from '../track-audio/track-domain-types.ts';

type PasteCommand = Extract<AudioEditorCommand, { readonly type: 'clipboard/paste' }>;
type SourceAddCommand = Extract<AudioEditorCommand, { readonly type: 'source/add' }>;
type RenderReplaceCommand = Extract<AudioEditorCommand, { readonly type: 'clip/render-replace-many' }>;
type LiftDeleteCommand = Extract<AudioEditorCommand, { readonly type: 'range/lift-delete' }>;
type ExistingClipPasteProject = Pick<ControllerProject, 'sampleRate' | 'sources' | 'tracks' | 'clips'>;

export interface ExistingClipPasteDerivedSourcesPort {
	sourceChannelsForEdit(source: ControllerSource): Promise<Float32Array[]>;
	persistDerivedSource(
		template: ControllerSource,
		channels: Float32Array[],
		name: string,
		idPrefix?: string,
	): Promise<DerivedSourceRecord>;
	rollbackDerivedSources(records: readonly Pick<DerivedSourceRecord, 'source'>[]): Promise<void>;
}

export interface CommittedPasteIntoExistingClipRequest {
	readonly command: AudioEditorCommand;
	readonly project: ExistingClipPasteProject;
	readonly derivedSources: ExistingClipPasteDerivedSourcesPort;
	preflightStorage(bytes: number, category: 'effect'): Promise<unknown>;
	assertCurrent(): void;
	commit(command: AudioEditorCommand): PromiseLike<unknown> | unknown;
}

interface ExistingClipPasteTarget {
	readonly clipboardTrack: AudioEditorClipboardTrack;
	readonly descriptor: CommandObject;
	readonly targetTrackId: string;
	readonly existingClip: ControllerClip;
	readonly existingSource: ControllerSource;
	readonly pastedSource: ControllerSource;
	readonly insertionOffsetFrames: number;
	readonly pastedDurationFrames: number;
	readonly outputFrames: number;
	readonly channelCount: number;
}

interface ExistingClipPastePlan {
	readonly paste: PasteCommand;
	readonly targets: readonly ExistingClipPasteTarget[];
}

/**
 * Commit Audacity's per-track single-interval "paste into existing clip" behavior.
 *
 * Soundscaper sources are immutable and a clip cannot own several source
 * intervals. The joined clip is therefore staged as one derived PCM source and
 * published with a fixed-position `clip/render-replace-many`. The batch first
 * clears only material colliding with the joined clip's extended tail. No
 * eligible target keeps the historical synchronous paste path.
 */
export function commitPasteIntoExistingClipCommand(
	request: CommittedPasteIntoExistingClipRequest,
): PromiseLike<unknown> | unknown {
	const plan = planPasteIntoExistingClip(request.command, request.project);
	if (!plan.targets.length) {
		request.assertCurrent();
		return request.commit(request.command);
	}
	return prepareAndCommit(plan.targets);

	async function prepareAndCommit(targets: readonly ExistingClipPasteTarget[]): Promise<unknown> {
		const records: DerivedSourceRecord[] = [];
		try {
			await request.preflightStorage(estimatedOutputBytes(targets), 'effect');
			request.assertCurrent();
			const joinedTargets = await Promise.all(targets.map(async (target) => {
				const [existingChannels, pastedChannels] = await Promise.all([
					request.derivedSources.sourceChannelsForEdit(target.existingSource),
					request.derivedSources.sourceChannelsForEdit(target.pastedSource),
				]);
				const existing = renderClipPcm(
					existingChannels,
					target.existingSource,
					target.existingClip,
					target.existingClip.durationFrames,
					target.channelCount,
				);
				const pasted = renderClipPcm(
					pastedChannels,
					target.pastedSource,
					target.descriptor,
					target.pastedDurationFrames,
					target.channelCount,
				);
				return { target, channels: insertChannels(existing, pasted, target.insertionOffsetFrames) };
			}));
			request.assertCurrent();
			const replacements: Array<Readonly<{
				target: ExistingClipPasteTarget;
				source: ControllerSource;
			}>> = [];
			for (const joined of joinedTargets) {
				const record = await request.derivedSources.persistDerivedSource(
					{
						...joined.target.existingSource,
						sampleRate: request.project.sampleRate,
					},
					joined.channels,
					joined.target.existingSource.name,
					'joined-paste-source',
				);
				records.push(record);
				replacements.push({ target: joined.target, source: record.source });
				request.assertCurrent();
			}
			const command = rewritePasteWithRenderedReplacements(
				request.command,
				plan.paste,
				replacements,
				request.project,
			);
			return await request.commit(command);
		} catch (error) {
			return rollbackAfterFailure(request.derivedSources, records, error);
		}
	}
}

function planPasteIntoExistingClip(
	command: AudioEditorCommand,
	project: ExistingClipPasteProject,
): ExistingClipPastePlan {
	const discovered = discoverCommands(command);
	if (discovered.pastes.length !== 1) {
		throw new RangeError('A paste-into-existing command tree must contain exactly one clipboard/paste command.');
	}
	const paste = discovered.pastes[0]!;
	if (!paste.pasteIntoExistingClip || paste.mode === 'insert-all') return { paste, targets: [] };
	// The descriptor does not persist Audacity's multi-selection-copy flag. More
	// than one interval on any source track is therefore the conservative refusal;
	// one interval on each of several tracks is an ordinary time-range copy.
	if (paste.clipboard.tracks.some((track) => track.clips.length > 1)
		|| paste.clipboard.takeGroups?.length) return { paste, targets: [] };
	const intervals = paste.clipboard.tracks.flatMap((clipboardTrack) => {
		const descriptor = clipboardTrack.clips[0];
		return descriptor ? [{ clipboardTrack, descriptor }] : [];
	});
	const mappedTrackIds = intervals.map(({ clipboardTrack }) => (
		paste.trackMap?.[clipboardTrack.sourceTrackId] ?? clipboardTrack.sourceTrackId
	));
	if (new Set(mappedTrackIds).size !== mappedTrackIds.length) return { paste, targets: [] };
	const additions = sourceAdditionsById(discovered.sourceAdds);
	const atFrame = safeFrame(paste.atFrame, 'paste.atFrame');
	const targets = intervals.flatMap(({ clipboardTrack, descriptor }) => {
		const target = planTrackPasteIntoExistingClip(
			paste,
			clipboardTrack,
			descriptor,
			project,
			additions,
			atFrame,
		);
		return target ? [target] : [];
	});
	return { paste, targets };
}

function planTrackPasteIntoExistingClip(
	paste: PasteCommand,
	clipboardTrack: AudioEditorClipboardTrack,
	descriptor: CommandObject,
	project: ExistingClipPasteProject,
	additions: ReadonlyMap<string, CommandObject>,
	atFrame: number,
): ExistingClipPasteTarget | null {
	if (!isComposableAudioDescriptor(descriptor)) return null;
	const targetTrackId = paste.trackMap?.[clipboardTrack.sourceTrackId] ?? clipboardTrack.sourceTrackId;
	const targetTrack = project.tracks.find((track) => track.id === targetTrackId);
	if (targetTrack?.type !== 'audio' || !targetTrack.clipIds?.length) return null;
	const containingClips = targetTrack.clipIds
		.map((clipId) => project.clips.find((clip) => clip.id === clipId))
		.filter((clip): clip is ControllerClip => Boolean(
			clip
			&& clip.timelineStartFrame <= atFrame
			&& clip.timelineStartFrame + clip.durationFrames > atFrame,
		));
	if (containingClips.length !== 1) return null;
	const existingClip = containingClips[0]!;
	if (!isComposableExistingClip(existingClip) || clipsCollidingWithRange(
		project, targetTrackId, existingClip.id,
		existingClip.timelineStartFrame,
		existingClip.timelineStartFrame + existingClip.durationFrames,
	).length) return null;
	const existingSource = resolveSource(project, additions, existingClip.sourceId);
	const pastedSourceId = nonEmptyString(descriptor.sourceId, 'clipboard clip sourceId');
	const pastedSource = resolveSource(project, additions, pastedSourceId);
	if (!existingSource || !pastedSource) return null;
	const channelCount = existingSource.channelCount;
	if (channelCount < 1 || channelCount > 2
		|| (pastedSource.channelCount !== 1 && pastedSource.channelCount !== channelCount)) {
		return null;
	}
	const clipboardScale = project.sampleRate / paste.clipboard.sampleRate;
	if (!Number.isFinite(clipboardScale) || clipboardScale <= 0) return null;
	if (project.sampleRate !== paste.clipboard.sampleRate && (
		finiteDefault(descriptor.fadeInFrames, 0) !== 0
		|| finiteDefault(descriptor.fadeOutFrames, 0) !== 0
		|| (Array.isArray(descriptor.envelope) && descriptor.envelope.length > 0)
	)) return null;
	const pastedDuration = positiveFrame(descriptor.durationFrames, 'clipboard clip durationFrames');
	if (pastedDuration !== positiveFrame(paste.clipboard.durationFrames, 'clipboard durationFrames')) return null;
	const pastedDurationFrames = Math.max(1, Math.round(
		pastedDuration * clipboardScale,
	));
	const outputFrames = existingClip.durationFrames + pastedDurationFrames;
	if (!Number.isSafeInteger(outputFrames)) throw new RangeError('Joined paste duration exceeds the safe integer range.');
	if (!sourceRangeIsValid(existingClip, existingSource)
		|| !sourceRangeIsValid(descriptor, pastedSource)) return null;
	const extensionStartFrame = existingClip.timelineStartFrame + existingClip.durationFrames;
	const extensionEndFrame = extensionStartFrame + pastedDurationFrames;
	if (!Number.isSafeInteger(extensionEndFrame)) throw new RangeError('Joined paste end exceeds the safe integer range.');
	if (paste.mode === 'overlap' && clipsCollidingWithRange(
		project,
		targetTrackId,
		existingClip.id,
		extensionStartFrame,
		extensionEndFrame,
	).some((clip) => clip.groupId != null || clip.avLinkId != null)) return null;
	return {
		clipboardTrack,
		descriptor,
		targetTrackId,
		existingClip,
		existingSource,
		pastedSource,
		insertionOffsetFrames: atFrame - existingClip.timelineStartFrame,
		pastedDurationFrames,
		outputFrames,
		channelCount,
	};
}

function discoverCommands(command: AudioEditorCommand): Readonly<{
	readonly pastes: readonly PasteCommand[];
	readonly sourceAdds: readonly SourceAddCommand[];
}> {
	const pastes: PasteCommand[] = [];
	const sourceAdds: SourceAddCommand[] = [];
	visit(command);
	return { pastes, sourceAdds };

	function visit(candidate: AudioEditorCommand): void {
		if (candidate.type === 'clipboard/paste') pastes.push(candidate);
		if (candidate.type === 'source/add') sourceAdds.push(candidate);
		if (candidate.type === 'batch') candidate.commands.forEach(visit);
	}
}

function sourceAdditionsById(commands: readonly SourceAddCommand[]): ReadonlyMap<string, CommandObject> {
	return new Map(commands.map((command) => [String(command.source.id), command.source]));
}

function resolveSource(
	project: ExistingClipPasteProject,
	additions: ReadonlyMap<string, CommandObject>,
	sourceId: string,
): ControllerSource | null {
	const added = additions.get(sourceId);
	const inventory: readonly ControllerSourceInventory[] = added
		? [{ ...added, id: sourceId }]
		: project.sources;
	return findControllerSource({ sources: inventory }, sourceId);
}

function isComposableExistingClip(clip: ControllerClip): boolean {
	return clip.avLinkId == null
		&& clip.groupId == null
		&& finiteDefault(clip.trimStartFrames, 0) === 0
		&& finiteDefault(clip.trimEndFrames, 0) === 0
		&& hasSupportedClipProcessing(clip);
}

function isComposableAudioDescriptor(descriptor: CommandObject): boolean {
	return (descriptor.kind === undefined || descriptor.kind === 'audio')
		&& descriptor.avLinkId == null
		&& descriptor.groupId == null
		&& safeFrame(descriptor.offsetFrame, 'clipboard clip offsetFrame') === 0
		&& hasSupportedClipProcessing(descriptor);
}

/** Preserve complex time/pitch and warp edits as separate clips until their render owner is available here. */
function hasSupportedClipProcessing(clip: Readonly<Record<string, unknown>>): boolean {
	return clip.warpMap == null
		&& finiteDefault(clip.pitchCents, 0) === 0
		&& clip.preserveFormants !== true
		&& clip.stretchToTempo !== true;
}

function sourceRangeIsValid(clip: Readonly<Record<string, unknown>>, source: ControllerSource): boolean {
	const start = safeFrame(clip.sourceStartFrame, 'clip sourceStartFrame');
	const duration = positiveFrame(
		clip.sourceDurationFrames ?? clip.durationFrames,
		'clip sourceDurationFrames',
	);
	return start + duration <= source.frameCount;
}

function renderClipPcm(
	channels: readonly Float32Array[],
	source: ControllerSource,
	clip: Readonly<Record<string, unknown>>,
	outputFrames: number,
	outputChannels: number,
): Float32Array[] {
	if (channels.length !== source.channelCount
		|| channels.some((channel) => channel.length < source.frameCount)) {
		throw new RangeError(`Editable PCM for source ${source.id} does not match its metadata.`);
	}
	const sourceStart = safeFrame(clip.sourceStartFrame, 'clip sourceStartFrame');
	const sourceDuration = positiveFrame(
		clip.sourceDurationFrames ?? clip.durationFrames,
		'clip sourceDurationFrames',
	);
	const reversed = clip.reversed === true;
	const gain = Math.max(0, finiteDefault(clip.gain, 1)) * (clip.inverted === true ? -1 : 1);
	const fadeIn = boundedFrame(clip.fadeInFrames, outputFrames);
	const fadeOut = boundedFrame(clip.fadeOutFrames, outputFrames);
	const envelope = createEnvelopeValueEvaluator(
		Array.isArray(clip.envelope) ? clip.envelope : [],
		outputFrames,
	);
	return Array.from({ length: outputChannels }, (_, channelIndex) => {
		const input = channels[Math.min(channelIndex, channels.length - 1)]!;
		const output = new Float32Array(outputFrames);
		for (let frame = 0; frame < outputFrames; frame += 1) {
			const sourceOffset = Math.min(sourceDuration - 1, Math.floor(frame * sourceDuration / outputFrames));
			const sourceFrame = reversed
				? sourceStart + sourceDuration - 1 - sourceOffset
				: sourceStart + sourceOffset;
			const fadeInGain = fadeIn > 0 && frame < fadeIn ? frame / fadeIn : 1;
			const fadeOutGain = fadeOut > 0 && frame > outputFrames - fadeOut
				? (outputFrames - frame) / fadeOut
				: 1;
			output[frame] = input[sourceFrame]! * gain * envelope(frame) * fadeInGain * fadeOutGain;
		}
		return output;
	});
}

function insertChannels(
	existing: readonly Float32Array[],
	pasted: readonly Float32Array[],
	atFrame: number,
): Float32Array[] {
	if (existing.length !== pasted.length) throw new RangeError('Joined paste channel widths do not match.');
	return existing.map((channel, index) => {
		const inserted = pasted[index]!;
		const output = new Float32Array(channel.length + inserted.length);
		output.set(channel.subarray(0, atFrame), 0);
		output.set(inserted, atFrame);
		output.set(channel.subarray(atFrame), atFrame + inserted.length);
		return output;
	});
}

function rewritePasteWithRenderedReplacements(
	command: AudioEditorCommand,
	paste: PasteCommand,
	replacements: readonly Readonly<{
		readonly target: ExistingClipPasteTarget;
		readonly source: ControllerSource;
	}>[],
	project: ExistingClipPasteProject,
): AudioEditorCommand {
	const targetTrackIds = new Set(replacements.map(({ target }) => target.targetTrackId));
	const clipboardTracks = new Set(replacements.map(({ target }) => target.clipboardTrack));
	const remainingTracks = paste.clipboard.tracks.filter((track) => !clipboardTracks.has(track));
	const remainingSequenceIds = new Set([
		...remainingTracks.flatMap(({ sourceSequenceId }) => sourceSequenceId ? [sourceSequenceId] : []),
		...(paste.clipboard.annotations ?? []).map(({ sourceSequenceId }) => sourceSequenceId),
	]);
	const targetClipIds = new Set(project.tracks
		.filter(({ id }) => targetTrackIds.has(id))
		.flatMap(({ clipIds }) => clipIds ?? []));
	const rewrittenPaste: PasteCommand = Object.freeze({
		...paste,
		clipboard: Object.freeze({
			...paste.clipboard,
			tracks: Object.freeze(remainingTracks),
		}),
		...(paste.sequenceMap === undefined ? {} : { sequenceMap: Object.freeze(Object.fromEntries(
			Object.entries(paste.sequenceMap).filter(([sourceId]) => remainingSequenceIds.has(sourceId)),
		)) }),
		collisionClipIds: Object.freeze((paste.collisionClipIds ?? []).filter((clipId) => !targetClipIds.has(clipId))),
		collisionTrackIds: Object.freeze((paste.collisionTrackIds ?? []).filter((trackId) => !targetTrackIds.has(trackId))),
		splitClipIds: Object.freeze(Object.fromEntries(
			Object.entries(paste.splitClipIds ?? {}).filter(([clipId]) => !targetClipIds.has(clipId)),
		)),
	});
	const rewritten = rewriteCommandTree(command, paste, rewrittenPaste);
	const collisionDeletes = paste.mode === 'overlap' ? replacements.flatMap(({ target }) => {
		const deletion = extensionCollisionDelete(target, project);
		return deletion ? [deletion] : [];
	}) : [];
	const replacement: RenderReplaceCommand = Object.freeze({
		type: 'clip/render-replace-many',
		entries: Object.freeze(replacements.map(({ target, source }) => Object.freeze({
			clipId: target.existingClip.id,
			source,
		}))),
		rippleMode: paste.mode === 'overlap' ? 'none' : 'track',
	});
	return Object.freeze({
		type: 'batch',
		commands: Object.freeze([
			...(rewritten.type === 'batch' ? rewritten.commands : [rewritten]),
			...collisionDeletes,
			replacement,
		]),
	});
}

function extensionCollisionDelete(
	target: ExistingClipPasteTarget,
	project: ExistingClipPasteProject,
): LiftDeleteCommand | null {
	const startFrame = target.existingClip.timelineStartFrame + target.existingClip.durationFrames;
	const endFrame = startFrame + target.pastedDurationFrames;
	if (!Number.isSafeInteger(endFrame)) throw new RangeError('Joined paste end exceeds the safe integer range.');
	const clipIds = clipsCollidingWithRange(
		project,
		target.targetTrackId,
		target.existingClip.id,
		startFrame,
		endFrame,
	).map(({ id }) => id);
	if (!clipIds.length) return null;
	return Object.freeze({
		type: 'range/lift-delete',
		startFrame,
		endFrame,
		trackIds: Object.freeze([target.targetTrackId]),
		clipIds: Object.freeze(clipIds),
		splitClipIds: Object.freeze({}),
		splitAvLinkIds: Object.freeze({}),
		videoEffectIds: Object.freeze({}),
	});
}

function clipsCollidingWithRange(
	project: ExistingClipPasteProject,
	trackId: string,
	excludedClipId: string,
	startFrame: number,
	endFrame: number,
): readonly ControllerClip[] {
	const track = project.tracks.find(({ id }) => id === trackId);
	return (track?.clipIds ?? []).flatMap((clipId) => {
		if (clipId === excludedClipId) return [];
		const clip = project.clips.find(({ id }) => id === clipId);
		return clip
			&& clip.timelineStartFrame < endFrame
			&& clip.timelineStartFrame + clip.durationFrames > startFrame
			? [clip]
			: [];
	});
}

function rewriteCommandTree(
	command: AudioEditorCommand,
	paste: PasteCommand,
	rewrittenPaste: PasteCommand,
): AudioEditorCommand {
	if (command === paste) return rewrittenPaste;
	if (command.type !== 'batch') return command;
	return Object.freeze({
		type: 'batch',
		commands: Object.freeze(command.commands.map((child) => (
			rewriteCommandTree(child, paste, rewrittenPaste)
		))),
	});
}

function estimatedOutputBytes(targets: readonly ExistingClipPasteTarget[]): number {
	const bytes = targets.reduce((sum, target) => (
		sum + target.outputFrames * target.channelCount * Float32Array.BYTES_PER_ELEMENT
	), 0);
	if (!Number.isSafeInteger(bytes)) throw new RangeError('Joined paste storage estimate exceeds the safe integer range.');
	return bytes;
}

async function rollbackAfterFailure(
	derivedSources: ExistingClipPasteDerivedSourcesPort,
	records: readonly DerivedSourceRecord[],
	error: unknown,
): Promise<never> {
	if (!records.length) throw error;
	try {
		await derivedSources.rollbackDerivedSources(records);
	} catch (rollbackError) {
		throw new AggregateError(
			[error, rollbackError],
			'Paste joining and derived-source rollback both failed.',
			{ cause: rollbackError },
		);
	}
	throw error;
}

function boundedFrame(value: unknown, maximum: number): number {
	if (value === undefined) return 0;
	return Math.min(maximum, safeFrame(value, 'clip fade frame'));
}

function finiteDefault(value: unknown, fallback: number): number {
	if (value === undefined) return fallback;
	const number = Number(value);
	if (!Number.isFinite(number)) throw new RangeError('Clip processing values must be finite.');
	return number;
}

function positiveFrame(value: unknown, name: string): number {
	const frame = safeFrame(value, name);
	if (frame <= 0) throw new RangeError(`${name} must be positive.`);
	return frame;
}

function safeFrame(value: unknown, name: string): number {
	const frame = Number(value);
	if (!Number.isSafeInteger(frame) || frame < 0) throw new RangeError(`${name} must be a non-negative safe integer.`);
	return frame;
}

function nonEmptyString(value: unknown, name: string): string {
	if (typeof value !== 'string' || !value) throw new TypeError(`${name} must be a non-empty string.`);
	return value;
}
