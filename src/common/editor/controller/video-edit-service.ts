/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	ThreePointEditError,
	resolveThreePointEdit,
	type ThreePointEdit,
} from '../three-point-edit.ts';
import {
	resolveVideoEditTargets,
	toggleVideoEditTarget,
	type VideoEditTargeting,
	type VideoEditTargets,
} from '../video-edit-targeting.ts';
import {
	SOURCE_MONITOR_NO_MARKS,
	resolveSourceMonitorPoints,
	type SourceMonitorPoints,
} from '../source-monitor-model.ts';
import {
	sampleFrameToVideoFrame,
	videoFrameToSampleFrame,
	type RationalRate,
} from '../timeline-time.ts';
import type { AudioEditorCommand } from '../commands/protocol.ts';
import type { EditorControllerLifetime } from './lifecycle.ts';

/**
 * Editing from the Project Bin into a targeted sequence.
 *
 * The service reads the points from the live document, resolves the fourth one
 * through the shared arithmetic, and commits one command. It holds exactly one
 * piece of state — which lanes are targeted — because that is a working choice
 * and not a fact the document owes anyone after a reload.
 */

type DataRecord = Readonly<Record<string, unknown>>;

export interface VideoEditServiceDependencies {
	readonly lifetime: Pick<EditorControllerLifetime, 'assertActive'>;
	/** The command projection: resolved samples for every clip. */
	getProject(): DataRecord;
	getSelectedTrackId(): string | null;
	editingBlocked(): boolean;
	commit(command: AudioEditorCommand): unknown;
	publishProjectState(): void;
	prepareThreePointEditCommand(project: DataRecord, options: DataRecord): AudioEditorCommand;
	/** The source monitor's marks, or null when it is holding another item. */
	sourceMonitorPoints(binItemId: string | null, sequencePointCount: number): SourceMonitorPoints | null;
}

export interface VideoEditRequest {
	readonly binItemId?: string | null;
	readonly sequenceInFrame?: number | null;
	readonly sequenceOutFrame?: number | null;
	readonly sequenceId?: string | null;
}

export interface VideoEditResult {
	readonly mode: 'insert' | 'overwrite';
	readonly edit: ThreePointEdit;
	readonly videoClipId: string | null;
	readonly audioClipId: string | null;
	/** True when the item carried audio no targeted lane could receive. */
	readonly audioDropped: boolean;
}

export interface VideoEditService {
	targets(sequenceId?: string | null): VideoEditTargets;
	toggleTarget(trackId: string, sequenceId?: string | null): VideoEditTargets;
	clearTargets(): VideoEditTargets;
	insert(request?: VideoEditRequest): VideoEditResult;
	overwrite(request?: VideoEditRequest): VideoEditResult;
}

export function createVideoEditService(
	dependencies: VideoEditServiceDependencies,
): Readonly<VideoEditService> {
	let targeting: VideoEditTargeting | null = null;

	function targets(sequenceId?: string | null): VideoEditTargets {
		dependencies.lifetime.assertActive();
		return resolveVideoEditTargets(dependencies.getProject(), {
			targeting,
			selectedTrackId: dependencies.getSelectedTrackId(),
			sequenceId,
		});
	}

	function edit(mode: 'insert' | 'overwrite', request: VideoEditRequest): VideoEditResult {
		dependencies.lifetime.assertActive();
		if (dependencies.editingBlocked()) throw new RangeError('Editing is blocked.');
		const project = dependencies.getProject();
		const resolvedTargets = targets(request.sequenceId);
		const sequence = requireSequence(project, resolvedTargets.sequenceId);
		const sampleRate = positiveSafeInteger(project.sampleRate, 'project.sampleRate');
		const sequenceRate = rationalRate(sequence.rate, 'sequence.rate');
		const item = requireBinItem(project, request.binItemId ?? null);
		if (!resolvedTargets.videoTrackId) {
			throw new ThreePointEditError('no-target', 'No video lane is targeted to receive this edit.');
		}
		const source = requireSource(project, item.video.sourceId);
		const sourceRate = rationalRate(source.frameRate, 'source.frameRate');
		const sourceFrameCount = positiveSafeInteger(source.sourceFrameCount, 'source.sourceFrameCount');
		const points = sequencePoints(project, request, sequenceRate, sampleRate);
		const sequencePointCount = points.sequenceOut == null ? 1 : 2;
		// The monitor's marks decide the source range. An unmarked monitor — or one
		// holding a different item — states nothing, and the media's own boundaries
		// fill in, which is the whole-source edit this service began with.
		const marked = dependencies.sourceMonitorPoints(item.id, sequencePointCount)
			?? resolveSourceMonitorPoints(SOURCE_MONITOR_NO_MARKS, sourceFrameCount, sequencePointCount);
		const resolved = resolveThreePointEdit({
			sourceIn: marked.sourceIn,
			sourceOut: marked.sourceOut,
			sequenceIn: points.sequenceIn,
			sequenceOut: points.sequenceOut,
		}, {
			sourceRate,
			sequenceRate,
			sampleRate,
			sourceFrameCount,
		});
		const placements = [{
			trackId: resolvedTargets.videoTrackId,
			sourceId: String(item.video.sourceId),
			sourceIn: resolved.sourceIn,
			sourceCount: resolved.sourceFrameCount,
			title: typeof item.video.title === 'string' ? item.video.title : undefined,
		}];
		const audioTargetId = resolvedTargets.audioTrackId;
		if (item.audio && audioTargetId) {
			// The audio program was fitted to the video at ingest, so the same media
			// span is the video source range mapped once into source samples.
			const audioIn = videoFrameToSampleFrame(resolved.sourceIn, sourceRate, sampleRate, 'point');
			const audioOut = videoFrameToSampleFrame(resolved.sourceOut, sourceRate, sampleRate, 'point');
			placements.push({
				trackId: audioTargetId,
				sourceId: String(item.audio.sourceId),
				sourceIn: audioIn,
				sourceCount: Math.max(1, audioOut - audioIn),
				title: typeof item.audio.title === 'string' ? item.audio.title : undefined,
			});
		}
		const command = dependencies.prepareThreePointEditCommand(project, {
			mode,
			startFrame: resolved.startFrame,
			endFrame: resolved.endFrame,
			placements,
		});
		dependencies.commit(command);
		dependencies.publishProjectState();
		const placed = (command as unknown as { placements: readonly { clipId: string }[] }).placements;
		return Object.freeze({
			mode,
			edit: resolved,
			videoClipId: placed[0]?.clipId ?? null,
			audioClipId: placements.length > 1 ? placed[1]?.clipId ?? null : null,
			audioDropped: Boolean(item.audio) && !audioTargetId,
		});
	}

	return Object.freeze({
		targets,
		toggleTarget(trackId: string, sequenceId?: string | null): VideoEditTargets {
			dependencies.lifetime.assertActive();
			const project = dependencies.getProject();
			const track = arrayOf(project.tracks).find((candidate) => candidate.id === trackId);
			if (!track) throw new ReferenceError(`Unknown track: ${trackId}.`);
			targeting = toggleVideoEditTarget(targets(sequenceId), trackId, String(track.type));
			dependencies.publishProjectState();
			return targets(sequenceId);
		},
		clearTargets(): VideoEditTargets {
			dependencies.lifetime.assertActive();
			targeting = null;
			dependencies.publishProjectState();
			return targets();
		},
		insert: (request: VideoEditRequest = {}) => edit('insert', request),
		overwrite: (request: VideoEditRequest = {}) => edit('overwrite', request),
	});
}

/** The sequence points, taken from the time selection unless the caller names them. */
function sequencePoints(
	project: DataRecord,
	request: VideoEditRequest,
	sequenceRate: RationalRate,
	sampleRate: number,
): Readonly<{ sequenceIn: number; sequenceOut: number | null }> {
	const selection = isRecord(project.selection) ? project.selection : {};
	const startSample = request.sequenceInFrame ?? selection.startFrame ?? 0;
	const endSample = request.sequenceOutFrame ?? selection.endFrame ?? startSample;
	const sequenceIn = sampleFrameToVideoFrame(
		nonNegativeSafeInteger(startSample, 'edit.sequenceInFrame'),
		sequenceRate,
		sampleRate,
		'point',
	);
	const sequenceOut = sampleFrameToVideoFrame(
		nonNegativeSafeInteger(endSample, 'edit.sequenceOutFrame'),
		sequenceRate,
		sampleRate,
		'point',
	);
	// A selection with no width states one point; the source supplies the other.
	return Object.freeze({ sequenceIn, sequenceOut: sequenceOut > sequenceIn ? sequenceOut : null });
}

interface BinItem {
	readonly id: string;
	readonly video: DataRecord;
	readonly audio: DataRecord | null;
}

/** The bin item to edit from: the one named, or the selected one. */
function requireBinItem(project: DataRecord, binItemId: string | null): BinItem {
	const bin = isRecord(project.projectBin) ? arrayOf(project.projectBin.clips) : [];
	const selected = new Set(
		isRecord(project.selection) && Array.isArray(project.selection.clipIds)
			? project.selection.clipIds.map(String)
			: [],
	);
	const itemIdOf = (clip: DataRecord) => String(clip.binItemId ?? clip.id);
	const video = bin.find((clip) => clip.kind === 'video' && (binItemId
		? itemIdOf(clip) === binItemId
		: selected.has(String(clip.id))));
	if (!video) {
		throw new ThreePointEditError(
			'no-source',
			binItemId
				? `The Project Bin has no video item ${binItemId}.`
				: 'Select a Project Bin video item to edit from.',
		);
	}
	const itemId = itemIdOf(video);
	return {
		id: itemId,
		video,
		audio: bin.find((clip) => clip.kind !== 'video' && itemIdOf(clip) === itemId) ?? null,
	};
}

function requireSequence(project: DataRecord, sequenceId: string): DataRecord {
	const sequence = arrayOf(project.sequences).find((candidate) => String(candidate.id) === sequenceId);
	if (!sequence) throw new ReferenceError(`Unknown sequence: ${sequenceId}.`);
	return sequence;
}

function requireSource(project: DataRecord, sourceId: unknown): DataRecord {
	const source = arrayOf(project.sources).find((candidate) => candidate.id === sourceId);
	if (!source) throw new ReferenceError(`Unknown source: ${String(sourceId)}.`);
	return source;
}

function arrayOf(value: unknown): DataRecord[] {
	return Array.isArray(value) ? value.filter(isRecord) : [];
}

function isRecord(value: unknown): value is DataRecord {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function rationalRate(value: unknown, name: string): RationalRate {
	if (!isRecord(value)) throw new TypeError(`${name} must be an object.`);
	return Object.freeze({
		num: positiveSafeInteger(value.num, `${name}.num`),
		den: positiveSafeInteger(value.den, `${name}.den`),
	});
}

function nonNegativeSafeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) throw new RangeError(`${name} must be a non-negative safe integer.`);
	return Number(value);
}

function positiveSafeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) <= 0) throw new RangeError(`${name} must be a positive safe integer.`);
	return Number(value);
}
