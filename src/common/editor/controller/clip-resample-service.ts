/* SPDX-License-Identifier: AGPL-3.0-only */

import { hasCoreEditingProjectAuthority } from '../project-schema-version.ts';

import { createAddClipCommand, createAddSourceCommand } from '../commands/factories.ts';
import type { AudioEditorCommand } from '../commands/protocol.ts';
import { scaleSampleFrame } from '../timeline-time.ts';
import type { DerivedSourceService } from './derived-source-service.ts';
import type {
	EditorControllerLifetime,
	EditorProjectToken,
	EditorTaskScope,
} from './lifecycle.ts';
import {
	findControllerClip,
	findControllerClipTrack,
	findControllerSource,
	type ControllerClip,
	type ControllerProject,
	type ControllerSource,
	type ControllerTrack,
} from './track-domain-types.ts';

const CLIP_RESAMPLE_TASK = 'clip-resample';

export interface ClipResampleRequest {
	readonly sampleRate?: unknown;
}

interface ClipResampleCopy {
	readonly v2Required: string;
	readonly audioClipNotFound: string;
	readonly resamplingClip: string;
	readonly audacityProcessing: string;
	readonly done: string;
}

interface CommitSelection {
	readonly selectTrackId?: string | null;
	readonly selectClipId?: string | null;
}

export interface ClipResampleServiceDependencies {
	readonly lifetime: Pick<EditorControllerLifetime, 'assertActive' | 'startTask'>;
	readonly copy: ClipResampleCopy;
	readonly derivedSources: DerivedSourceService;
	getProject(): ControllerProject;
	getSelectedClipId(): string | null;
	editingBlocked(): boolean;
	captureProject(): EditorProjectToken;
	assertProject(token: EditorProjectToken): void;
	commit(command: AudioEditorCommand, selection?: CommitSelection): unknown;
	normalizeProjectSampleRate(value: unknown): number;
	preflightStorage(bytes: number, category: 'effect'): Promise<unknown>;
	setProcessing(processing: boolean): void;
	setStatus(message: string, state?: string): void;
	publish(): void;
	resampleChannels(
		channels: Float32Array[],
		inputSampleRate: number,
		outputSampleRate: number,
		outputFrames: number,
	): Float32Array[];
}

export interface ClipResampleService {
	resampleClip(clipId?: string | null, request?: ClipResampleRequest): Promise<string | null>;
}

/**
 * Rewrite one clip onto a resampled replacement of its source.
 *
 * Trims and source offsets are stored in source frames, so every one of them
 * has to be scaled by the rate ratio; leaving them alone would silently move
 * the clip's content when the frame grid underneath it changed. The clip is
 * removed and re-added rather than patched so the scaled fields land as one
 * validated clip record.
 */
export function resampledClipCommands(
	trackId: string,
	clip: ControllerClip,
	originalSource: ControllerSource,
	replacement: ControllerSource,
	sampleRate: number,
): AudioEditorCommand[] {
	const ratio = sampleRate / originalSource.sampleRate;
	const sourceStartFrame = Math.min(
		replacement.frameCount - 1,
		Math.max(0, Math.round(clip.sourceStartFrame * ratio)),
	);
	const requestedDuration = Math.max(1, Math.round((clip.sourceDurationFrames || clip.durationFrames) * ratio));
	const sourceDurationFrames = Math.min(requestedDuration, replacement.frameCount - sourceStartFrame);
	const trimStartFrames = Math.min(sourceStartFrame, Math.max(0, Math.round((clip.trimStartFrames || 0) * ratio)));
	const trimEndFrames = Math.min(
		replacement.frameCount - sourceStartFrame - sourceDurationFrames,
		Math.max(0, Math.round((clip.trimEndFrames || 0) * ratio)),
	);
	return [
		{ type: 'clip/remove', clipId: clip.id },
		createAddClipCommand(trackId, {
			...clip,
			sourceId: replacement.id,
			sourceStartFrame,
			sourceDurationFrames,
			trimStartFrames,
			trimEndFrames,
		}),
	];
}

export function createClipResampleService(
	dependencies: ClipResampleServiceDependencies,
): Readonly<ClipResampleService> {
	return Object.freeze({ resampleClip });

	/**
	 * Resample one clip, and only that clip, to a requested rate.
	 *
	 * The clip is repointed at a private derived source, so a source shared with
	 * other clips keeps its own rate for them. The replacement inherits whatever
	 * format the original declared: the store holds float32 PCM regardless, and
	 * the declaration exists only to carry an imported Audacity project's own
	 * back out again.
	 */
	async function resampleClip(
		clipId: string | null = dependencies.getSelectedClipId(),
		request: ClipResampleRequest = {},
	): Promise<string | null> {
		dependencies.lifetime.assertActive();
		if (dependencies.editingBlocked()) return null;
		const project = dependencies.getProject();
		if (!hasCoreEditingProjectAuthority(project)) throw new Error(dependencies.copy.v2Required);
		const clip = findControllerClip(project, clipId);
		if (!clip || clip.kind === 'video') throw new Error(dependencies.copy.audioClipNotFound);
		const track = findControllerClipTrack(project, clip.id);
		const source = findControllerSource(project, clip.sourceId);
		if (!track || !source) throw new Error(dependencies.copy.audioClipNotFound);
		const sampleRate = dependencies.normalizeProjectSampleRate(request.sampleRate ?? source.sampleRate);
		if (sampleRate === source.sampleRate) return clip.id;
		return runResample(track, clip, source, sampleRate);
	}

	async function runResample(
		track: ControllerTrack,
		clip: ControllerClip,
		source: ControllerSource,
		sampleRate: number,
	): Promise<string | null> {
		const outputFrames = Math.max(1, scaleSampleFrame(
			source.frameCount, source.sampleRate, sampleRate, 'point',
		));
		const estimatedBytes = outputFrames * source.channelCount * Float32Array.BYTES_PER_ELEMENT;
		const ownership = {
			project: dependencies.captureProject(),
			task: dependencies.lifetime.startTask(CLIP_RESAMPLE_TASK),
		};
		dependencies.setProcessing(true);
		dependencies.setStatus(dependencies.copy.resamplingClip || dependencies.copy.audacityProcessing);
		dependencies.publish();
		let record = null;
		try {
			await dependencies.preflightStorage(estimatedBytes, 'effect');
			assertOwned(ownership);
			const input = await dependencies.derivedSources.sourceChannelsForEdit(source);
			assertOwned(ownership);
			const channels = dependencies.resampleChannels(input, source.sampleRate, sampleRate, outputFrames);
			record = await dependencies.derivedSources.persistDerivedSource(
				{ ...source, sampleRate, originalSampleRate: source.originalSampleRate || source.sampleRate },
				channels,
				`${source.name || clip.title} (${sampleRate} Hz)`,
				'resampled-source',
			);
			assertOwned(ownership);
			dependencies.commit({
				type: 'batch',
				commands: [
					createAddSourceCommand(record.source),
					...resampledClipCommands(track.id, clip, source, record.source, sampleRate),
				],
			}, { selectTrackId: track.id, selectClipId: clip.id });
			dependencies.setStatus(dependencies.copy.done, 'success');
			return clip.id;
		} catch (error) {
			if (record) await dependencies.derivedSources.rollbackDerivedSources([record]);
			throw error;
		} finally {
			if (taskIsCurrent(ownership.task)) {
				dependencies.setProcessing(false);
				if (projectIsCurrent(ownership.project)) dependencies.publish();
				ownership.task.finish();
			}
		}
	}

	function assertOwned(ownership: Readonly<{ task: EditorTaskScope; project: EditorProjectToken }>): void {
		ownership.task.assertCurrent();
		dependencies.assertProject(ownership.project);
	}

	function projectIsCurrent(token: EditorProjectToken): boolean {
		try {
			dependencies.assertProject(token);
			return true;
		} catch {
			return false;
		}
	}

	function taskIsCurrent(task: EditorTaskScope): boolean {
		try {
			task.assertCurrent();
			return true;
		} catch {
			return false;
		}
	}
}
