/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	collectClipTransformIds as collectLegacyClipTransformIds,
} from '../commands/clip-basic-runtime.js';
import {
	prepareTransformClipsCommand as prepareLegacyTransformClipsCommand,
} from '../commands/clip-transform-runtime.js';
import type { AudioEditorCommand, CommandObject } from '../commands/protocol.ts';
import { scaleClipEnvelope } from './source-audio.ts';
import type { AudioBufferLike } from './source-audio.ts';
import type {
	ClipTransformClip,
	ClipTransformProject,
	ClipTransformTrack,
} from './clip-domain-types.ts';
import type {
	EditorControllerLifetime,
	EditorProjectToken,
	EditorTaskScope,
} from './lifecycle.ts';

export type ClipPropertyAction = 'reverse' | 'normalize-peak' | 'normalize-lufs';

export interface ClipAnalysisResult {
	readonly peakAmplitude: number;
	readonly integratedLufs: number;
}

export interface ClipTimePitchChanges extends Readonly<Record<string, unknown>> {
	readonly pitchCents?: unknown;
	readonly speedRatio?: unknown;
	readonly preserveFormants?: unknown;
}

export interface ClipStretchChanges extends Readonly<Record<string, unknown>> {
	readonly timelineStartFrame?: unknown;
	readonly durationFrames?: unknown;
}

interface ClipPropertyCopy {
	readonly audioClipNotFound: string;
	readonly clipPitchRange: string;
	readonly clipSpeedPositive: string;
	readonly timelineFramesFinite: string;
}

interface CommitSelection {
	readonly selectTrackId?: string | null;
	readonly selectClipId?: string | null;
}

interface TimePitchClip extends ClipTransformClip {
	readonly gain: number;
	readonly pitchCents: number;
	readonly speedRatio: number;
	readonly preserveFormants: boolean;
	readonly stretchToTempo: boolean;
	readonly renderCacheRevision: number;
}

interface PreparedTransform {
	readonly clipId: string;
	readonly trackId?: string;
	readonly changes: CommandObject;
}

interface ClipFingerprint {
	readonly projectId: string;
	readonly clipId: string;
	readonly sourceId: string;
	readonly sourceStartFrame: number;
	readonly sourceDurationFrames: number;
	readonly durationFrames: number;
	readonly renderCacheRevision: number;
}

export interface ClipPropertyServiceDependencies {
	readonly lifetime: Pick<EditorControllerLifetime, 'assertActive' | 'startTask'>;
	readonly copy: ClipPropertyCopy;
	readonly sourceBuffers: Pick<Map<string, AudioBufferLike>, 'get'>;
	getProject(): ClipTransformProject;
	getSelectedClipId(): string | null;
	editingBlocked(): boolean;
	captureProject(): EditorProjectToken;
	assertProject(token: EditorProjectToken): void;
	analyzeChannels(
		channels: readonly Float32Array[],
		sampleRate: number,
		signal: AbortSignal,
	): Promise<ClipAnalysisResult>;
	createId(prefix: string): string;
	commit(command: AudioEditorCommand, selection?: CommitSelection): unknown;
}

export interface ClipPropertyService {
	handleClipAction(action: ClipPropertyAction | string, clipId?: string | null): Promise<unknown>;
	setClipTimePitch(clipId?: string | null, changes?: ClipTimePitchChanges): unknown;
	stretchClip(clipId?: string | null, changes?: ClipStretchChanges): unknown;
	resetClipPitchSpeed(clipId?: string | null): unknown;
	toggleStretchToTempo(clipId?: string | null): unknown;
}

export function createClipPropertyService(
	dependencies: ClipPropertyServiceDependencies,
): Readonly<ClipPropertyService> {
	return Object.freeze({
		handleClipAction,
		setClipTimePitch,
		stretchClip,
		resetClipPitchSpeed,
		toggleStretchToTempo,
	});

	async function handleClipAction(
		action: ClipPropertyAction | string,
		clipId: string | null = dependencies.getSelectedClipId(),
	): Promise<unknown> {
		dependencies.lifetime.assertActive();
		if (dependencies.editingBlocked()) return undefined;
		const project = dependencies.getProject();
		const clip = findTimePitchClip(project, clipId);
		if (!clip) return undefined;
		if (action === 'reverse') {
			return dependencies.commit({
				type: 'clip/update', clipId: clip.id, changes: { reversed: !clip.reversed },
			}, { selectClipId: clip.id });
		}
		const buffer = dependencies.sourceBuffers.get(clip.sourceId);
		if (!buffer) return undefined;
		const task = dependencies.lifetime.startTask(`clip-normalize:${clip.id}`);
		const projectToken = dependencies.captureProject();
		const fingerprint = fingerprintClip(project, clip);
		try {
			const channels = Array.from({ length: buffer.numberOfChannels }, (_, channel) => (
				buffer.getChannelData(channel).subarray(
					clip.sourceStartFrame,
					clip.sourceStartFrame + clip.sourceDurationFrames,
				)
			));
			const result = await dependencies.analyzeChannels(channels, buffer.sampleRate, task.signal);
			assertOwned(task, projectToken, fingerprint);
			let gain = clip.gain;
			if (action === 'normalize-peak' && result.peakAmplitude > 0) {
				gain = 10 ** (-1 / 20) / result.peakAmplitude;
			}
			if (action === 'normalize-lufs' && Number.isFinite(result.integratedLufs)) {
				gain = 10 ** ((-14 - result.integratedLufs) / 20);
			}
			return dependencies.commit({
				type: 'clip/update',
				clipId: clip.id,
				changes: { gain: Math.max(0, Math.min(16, gain)) },
			}, { selectClipId: clip.id });
		} finally {
			task.finish();
		}
	}

	function setClipTimePitch(
		clipId: string | null = dependencies.getSelectedClipId(),
		changes: ClipTimePitchChanges = {},
	): unknown {
		dependencies.lifetime.assertActive();
		if (dependencies.editingBlocked()) return null;
		const project = dependencies.getProject();
		const clip = findTimePitchClip(project, clipId);
		const track = clip ? findClipTrack(project, clip.id) : null;
		if (!clip || !track) throw new Error(dependencies.copy.audioClipNotFound);
		const pitchCents = changes.pitchCents == null ? clip.pitchCents : Number(changes.pitchCents);
		const speedRatio = changes.speedRatio == null ? clip.speedRatio : Number(changes.speedRatio);
		if (!Number.isFinite(pitchCents) || pitchCents < -1_200 || pitchCents > 1_200) {
			throw new RangeError(dependencies.copy.clipPitchRange);
		}
		if (!Number.isFinite(speedRatio) || speedRatio <= 0) {
			throw new RangeError(dependencies.copy.clipSpeedPositive);
		}
		const durationFrames = changes.speedRatio == null
			? clip.durationFrames
			: Math.max(1, Math.round(clip.sourceDurationFrames / speedRatio));
		const command = prepareTransformClipsCommand(project, [{
			clipId: clip.id,
			trackId: track.id,
			changes: {
				pitchCents,
				speedRatio,
				...(changes.preserveFormants == null ? {} : {
					preserveFormants: Boolean(changes.preserveFormants),
				}),
				durationFrames,
				fadeInFrames: Math.min(clip.fadeInFrames, durationFrames),
				fadeOutFrames: Math.min(clip.fadeOutFrames, durationFrames),
				envelope: scaleEnvelope(clip, durationFrames),
				renderCacheRevision: clip.renderCacheRevision + 1,
			},
		}], dependencies.createId);
		return dependencies.commit(command, { selectTrackId: track.id, selectClipId: clip.id });
	}

	function stretchClip(
		clipId: string | null = dependencies.getSelectedClipId(),
		changes: ClipStretchChanges = {},
	): unknown {
		dependencies.lifetime.assertActive();
		if (dependencies.editingBlocked()) return null;
		const project = dependencies.getProject();
		const clip = findTimePitchClip(project, clipId);
		const track = clip ? findClipTrack(project, clip.id) : null;
		if (!clip || !track) throw new Error(dependencies.copy.audioClipNotFound);
		const timelineStartFrame = changes.timelineStartFrame == null
			? clip.timelineStartFrame
			: Math.max(0, Math.round(Number(changes.timelineStartFrame)));
		const durationFrames = changes.durationFrames == null
			? clip.durationFrames
			: Math.max(1, Math.round(Number(changes.durationFrames)));
		if (!Number.isSafeInteger(timelineStartFrame) || !Number.isSafeInteger(durationFrames)) {
			throw new TypeError(dependencies.copy.timelineFramesFinite);
		}
		const clipIds = collectClipTransformIds(project, clip.id);
		if (clipIds.length > 1) {
			const clips = clipIds.map((id) => findTimePitchClip(project, id)).filter(isTimePitchClip);
			const stretchesLeft = changes.timelineStartFrame != null
				&& timelineStartFrame !== clip.timelineStartFrame;
			let stretchFactor = durationFrames / clip.durationFrames;
			if (stretchesLeft) {
				const maximumFactor = Math.min(...clips.map((item) => (
					(item.timelineStartFrame + item.durationFrames) / item.durationFrames
				)));
				stretchFactor = Math.min(stretchFactor, maximumFactor);
			}
			const transforms = clips.map((item): PreparedTransform => {
				const nextDurationFrames = Math.max(1, Math.round(item.durationFrames * stretchFactor));
				return {
					clipId: item.id,
					trackId: findClipTrack(project, item.id)?.id,
					changes: {
						...(stretchesLeft ? {
							timelineStartFrame: item.timelineStartFrame + item.durationFrames - nextDurationFrames,
						} : {}),
						durationFrames: nextDurationFrames,
						speedRatio: item.sourceDurationFrames / nextDurationFrames,
						fadeInFrames: Math.min(item.fadeInFrames, nextDurationFrames),
						fadeOutFrames: Math.min(item.fadeOutFrames, nextDurationFrames),
						envelope: scaleEnvelope(item, nextDurationFrames),
						renderCacheRevision: item.renderCacheRevision + 1,
					},
				};
			});
			return dependencies.commit(
				prepareTransformClipsCommand(project, transforms, dependencies.createId),
				{ selectTrackId: track.id, selectClipId: clip.id },
			);
		}
		return dependencies.commit(prepareTransformClipsCommand(project, [{
			clipId: clip.id,
			trackId: track.id,
			changes: {
				timelineStartFrame,
				durationFrames,
				speedRatio: clip.sourceDurationFrames / durationFrames,
				fadeInFrames: Math.min(clip.fadeInFrames, durationFrames),
				fadeOutFrames: Math.min(clip.fadeOutFrames, durationFrames),
				envelope: scaleEnvelope(clip, durationFrames),
				renderCacheRevision: clip.renderCacheRevision + 1,
			},
		}], dependencies.createId), { selectTrackId: track.id, selectClipId: clip.id });
	}

	function resetClipPitchSpeed(clipId: string | null = dependencies.getSelectedClipId()): unknown {
		return setClipTimePitch(clipId, { pitchCents: 0, speedRatio: 1, preserveFormants: false });
	}

	function toggleStretchToTempo(clipId: string | null = dependencies.getSelectedClipId()): unknown {
		dependencies.lifetime.assertActive();
		if (dependencies.editingBlocked()) return null;
		const clip = findTimePitchClip(dependencies.getProject(), clipId);
		if (!clip) throw new Error(dependencies.copy.audioClipNotFound);
		return dependencies.commit({
			type: 'clip/update',
			clipId: clip.id,
			changes: {
				stretchToTempo: !clip.stretchToTempo,
				renderCacheRevision: clip.renderCacheRevision + 1,
			},
		}, { selectClipId: clip.id });
	}

	function assertOwned(
		task: EditorTaskScope,
		projectToken: EditorProjectToken,
		fingerprint: ClipFingerprint,
	): void {
		task.assertCurrent();
		dependencies.assertProject(projectToken);
		const active = findTimePitchClip(dependencies.getProject(), fingerprint.clipId);
		if (!active || !matchesFingerprint(active, fingerprint)) {
			throw new DOMException('The clip changed before analysis completed.', 'AbortError');
		}
	}
}

function fingerprintClip(project: ClipTransformProject, clip: TimePitchClip): ClipFingerprint {
	return Object.freeze({
		projectId: project.id,
		clipId: clip.id,
		sourceId: clip.sourceId,
		sourceStartFrame: clip.sourceStartFrame,
		sourceDurationFrames: clip.sourceDurationFrames,
		durationFrames: clip.durationFrames,
		renderCacheRevision: clip.renderCacheRevision,
	});
}

function matchesFingerprint(clip: TimePitchClip, fingerprint: ClipFingerprint): boolean {
	return clip.id === fingerprint.clipId
		&& clip.sourceId === fingerprint.sourceId
		&& clip.sourceStartFrame === fingerprint.sourceStartFrame
		&& clip.sourceDurationFrames === fingerprint.sourceDurationFrames
		&& clip.durationFrames === fingerprint.durationFrames
		&& clip.renderCacheRevision === fingerprint.renderCacheRevision;
}

function findTimePitchClip(
	project: ClipTransformProject,
	clipId: string | null | undefined,
): TimePitchClip | null {
	return (project.clips.find((clip) => clip.id === clipId) as TimePitchClip | undefined) ?? null;
}

function findClipTrack(project: ClipTransformProject, clipId: string): ClipTransformTrack | null {
	return project.tracks.find((track) => track.clipIds.includes(clipId)) ?? null;
}

function isTimePitchClip(value: TimePitchClip | null): value is TimePitchClip {
	return value !== null;
}

function scaleEnvelope(clip: TimePitchClip, durationFrames: number): CommandObject[] {
	return scaleClipEnvelope({
		durationFrames: clip.durationFrames,
		envelope: [...(clip.envelope ?? [])],
	}, durationFrames);
}

function collectClipTransformIds(project: ClipTransformProject, activeClipId: string): string[] {
	return (collectLegacyClipTransformIds as (
		project: ClipTransformProject,
		activeClipId: string,
	) => string[])(project, activeClipId);
}

function prepareTransformClipsCommand(
	project: ClipTransformProject,
	transforms: readonly PreparedTransform[],
	idFactory: (prefix: string) => string,
): Extract<AudioEditorCommand, { readonly type: 'clip/transform-many' }> {
	return (prepareLegacyTransformClipsCommand as unknown as (
		project: ClipTransformProject,
		transforms: readonly PreparedTransform[],
		options: Readonly<Record<string, unknown>>,
		idFactory: (prefix: string) => string,
	) => Extract<AudioEditorCommand, { readonly type: 'clip/transform-many' }>)(
		project, transforms, {}, idFactory,
	);
}
