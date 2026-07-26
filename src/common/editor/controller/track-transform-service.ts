/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createAddClipCommand,
	createAddSourceCommand,
	createAddTrackCommand,
	createReplaceClipSourceCommand,
} from '../commands/factories.ts';
import type { AudioEditorCommand } from '../commands/protocol.ts';
import type { DerivedSourceService } from './derived-source-service.ts';
import type {
	EditorControllerLifetime,
	EditorProjectToken,
	EditorTaskScope,
} from './lifecycle.ts';
import {
	findControllerClip,
	findControllerSource,
	findControllerTrack,
	type ControllerClip,
	type ControllerProject,
	type ControllerSource,
	type ControllerTrack,
	type DerivedSourceRecord,
} from './track-domain-types.ts';

const TRACK_TRANSFORM_TASK = 'track-transform';

interface TrackTransformCopy {
	readonly v2Required: string;
	readonly audioTrackRequired: string;
	readonly stereoTrackRequired: string;
	readonly monoTrackRequired: string;
	readonly compatibleMonoTrackRequired: string;
	readonly resamplingTrack: string;
	readonly audacityProcessing: string;
	readonly rewritingChannels: string;
	readonly done: string;
	readonly channelsSwapped: string;
	readonly leftChannel: string;
	readonly rightChannel: string;
	readonly stereo: string;
}

interface CommitSelection {
	readonly selectTrackId?: string | null;
	readonly selectClipId?: string | null;
}

export interface TrackTransformServiceDependencies {
	readonly lifetime: Pick<EditorControllerLifetime, 'assertActive' | 'startTask'>;
	readonly copy: TrackTransformCopy;
	readonly derivedSources: DerivedSourceService;
	getProject(): ControllerProject;
	getSelectedTrackId(): string | null;
	editingBlocked(): boolean;
	captureProject(): EditorProjectToken;
	assertProject(token: EditorProjectToken): void;
	createId(prefix: string): string;
	commit(command: AudioEditorCommand, selection?: CommitSelection): unknown;
	projectSampleRate(): number;
	normalizeProjectSampleRate(value: unknown): number;
	audioTrackChannelCount(project: ControllerProject, track: ControllerTrack): number;
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
	renderDryTrackRange(
		trackId: string,
		startFrame: number,
		endFrame: number,
		channelCount: number,
	): Promise<Float32Array[]>;
}

export interface TrackTransformService {
	resampleTrack(trackId?: string | null, requestedSampleRate?: unknown): Promise<string | null>;
	swapTrackChannels(trackId?: string | null): Promise<string | null>;
	splitStereoTrack(
		trackId?: string | null,
		panChannels?: boolean,
	): Promise<Readonly<{ leftTrackId: string; rightTrackId: string }> | null>;
	makeStereoTrack(trackId?: string | null, partnerTrackId?: string | null): Promise<unknown>;
}

interface TransformOwnership {
	readonly task: EditorTaskScope;
	readonly project: EditorProjectToken;
}

export function createTrackTransformService(
	dependencies: TrackTransformServiceDependencies,
): Readonly<TrackTransformService> {
	return Object.freeze({ resampleTrack, swapTrackChannels, splitStereoTrack, makeStereoTrack });

	async function resampleTrack(
		trackId: string | null = dependencies.getSelectedTrackId(),
		requestedSampleRate: unknown = dependencies.projectSampleRate(),
	): Promise<string | null> {
		dependencies.lifetime.assertActive();
		if (dependencies.editingBlocked()) return null;
		const project = dependencies.getProject();
		const track = requireAudioTrack(project, trackId);
		const sampleRate = dependencies.normalizeProjectSampleRate(requestedSampleRate);
		const clips = trackClips(project, track);
		const sources = dependencies.derivedSources.uniqueClipSources(clips);
		const sourcesToResample = sources.filter((source) => source.sampleRate !== sampleRate);
		if (!sourcesToResample.length) return track.id;
		const estimatedBytes = sourcesToResample.reduce((sum, source) => (
			sum + Math.max(1, Math.round(source.frameCount * sampleRate / source.sampleRate))
				* source.channelCount * Float32Array.BYTES_PER_ELEMENT
		), 0);
		return runTransform(dependencies.copy.resamplingTrack || dependencies.copy.audacityProcessing, async (ownership) => {
			await dependencies.preflightStorage(estimatedBytes, 'effect');
			assertOwned(ownership);
			const derived: DerivedSourceRecord[] = [];
			try {
				const replacements = new Map<string, DerivedSourceRecord>();
				for (const source of sourcesToResample) {
					const input = await dependencies.derivedSources.sourceChannelsForEdit(source);
					assertOwned(ownership);
					const outputFrames = Math.max(1, Math.round(source.frameCount * sampleRate / source.sampleRate));
					const channels = dependencies.resampleChannels(input, source.sampleRate, sampleRate, outputFrames);
					const name = `${source.name || track.name} (${sampleRate} Hz)`;
					const record = await dependencies.derivedSources.persistDerivedSource({
						...source,
						sampleRate,
						originalSampleRate: source.originalSampleRate || source.sampleRate,
					}, channels, name, 'resampled-source');
					derived.push(record);
					assertOwned(ownership);
					replacements.set(source.id, record);
				}
				const commands: AudioEditorCommand[] = derived.map(({ source }) => createAddSourceCommand(source));
				for (const clip of clips) addResampledClipCommands(commands, track, clip, replacements, sampleRate);
				assertOwned(ownership);
				dependencies.commit({ type: 'batch', commands }, { selectTrackId: track.id });
				dependencies.setStatus(dependencies.copy.done, 'success');
				return track.id;
			} catch (error) {
				await dependencies.derivedSources.rollbackDerivedSources(derived);
				throw error;
			}
		});
	}

	async function swapTrackChannels(
		trackId: string | null = dependencies.getSelectedTrackId(),
	): Promise<string | null> {
		dependencies.lifetime.assertActive();
		if (dependencies.editingBlocked()) return null;
		const project = dependencies.getProject();
		const track = requireStereoTrack(project, trackId);
		const clips = trackClips(project, track);
		const sources = dependencies.derivedSources.uniqueClipSources(clips)
			.filter((source) => source.channelCount > 1);
		if (!sources.length) return track.id;
		const bytes = sources.reduce((sum, source) => sum
			+ source.frameCount * 2 * Float32Array.BYTES_PER_ELEMENT, 0);
		return runTransform(dependencies.copy.rewritingChannels || dependencies.copy.audacityProcessing, async (ownership) => {
			await dependencies.preflightStorage(bytes, 'effect');
			assertOwned(ownership);
			const derived: DerivedSourceRecord[] = [];
			try {
				const replacements = new Map<string, ControllerSource>();
				for (const source of sources) {
					const channels = await dependencies.derivedSources.sourceChannelsForEdit(source);
					assertOwned(ownership);
					const record = await dependencies.derivedSources.persistDerivedSource(
						source,
						[channels[1]!, channels[0]!],
						`${source.name} — ${dependencies.copy.channelsSwapped}`,
						'swapped-source',
					);
					derived.push(record);
					assertOwned(ownership);
					replacements.set(source.id, record.source);
				}
				const commands: AudioEditorCommand[] = derived.map(({ source }) => createAddSourceCommand(source));
				for (const clip of clips) {
					const source = replacements.get(clip.sourceId);
					if (source) commands.push(createReplaceClipSourceCommand(clip.id, source.id));
				}
				assertOwned(ownership);
				dependencies.commit({ type: 'batch', commands }, { selectTrackId: track.id });
				dependencies.setStatus(dependencies.copy.done, 'success');
				return track.id;
			} catch (error) {
				await dependencies.derivedSources.rollbackDerivedSources(derived);
				throw error;
			}
		});
	}

	async function splitStereoTrack(
		trackId: string | null = dependencies.getSelectedTrackId(),
		panChannels = true,
	): Promise<Readonly<{ leftTrackId: string; rightTrackId: string }> | null> {
		dependencies.lifetime.assertActive();
		if (dependencies.editingBlocked()) return null;
		const project = dependencies.getProject();
		const track = requireStereoTrack(project, trackId);
		const trackIndex = project.tracks.findIndex((candidate) => candidate.id === track.id);
		const clips = trackClips(project, track);
		const sources = dependencies.derivedSources.uniqueClipSources(clips);
		const bytes = sources.reduce((sum, source) => sum
			+ source.frameCount * 2 * Float32Array.BYTES_PER_ELEMENT, 0);
		return runTransform(dependencies.copy.rewritingChannels || dependencies.copy.audacityProcessing, async (ownership) => {
			await dependencies.preflightStorage(bytes, 'effect');
			assertOwned(ownership);
			const derived: DerivedSourceRecord[] = [];
			try {
				const sourcePairs = new Map<string, Readonly<{ left: ControllerSource; right: ControllerSource }>>();
				for (const source of sources) {
					const channels = await dependencies.derivedSources.sourceChannelsForEdit(source);
					assertOwned(ownership);
					const left = await dependencies.derivedSources.persistDerivedSource(
						source, [channels[0]!], `${source.name} — ${dependencies.copy.leftChannel}`, 'left-source',
					);
					derived.push(left);
					assertOwned(ownership);
					const right = await dependencies.derivedSources.persistDerivedSource(
						source, [channels[1] || channels[0]!], `${source.name} — ${dependencies.copy.rightChannel}`, 'right-source',
					);
					derived.push(right);
					assertOwned(ownership);
					sourcePairs.set(source.id, { left: left.source, right: right.source });
				}
				const rightTrackId = dependencies.createId('track');
				const leftTrack = { ...track, clipIds: [], name: `${track.name} — ${dependencies.copy.leftChannel}`, pan: panChannels ? -1 : 0 };
				const rightTrack = {
					...track,
					id: rightTrackId,
					clipIds: [],
					name: `${track.name} — ${dependencies.copy.rightChannel}`,
					pan: panChannels ? 1 : 0,
					armed: false,
					effects: (track.effects || []).map((effect) => ({ ...effect, id: dependencies.createId('effect') })),
				};
				const commands: AudioEditorCommand[] = [
					...derived.map(({ source }) => createAddSourceCommand(source)),
					{ type: 'track/remove', trackId: track.id },
					{ ...createAddTrackCommand(leftTrack), index: trackIndex },
					{ ...createAddTrackCommand(rightTrack), index: trackIndex + 1 },
				];
				for (const clip of clips) addSplitClipCommands(commands, track, rightTrackId, clip, sourcePairs);
				assertOwned(ownership);
				dependencies.commit({ type: 'batch', commands }, { selectTrackId: track.id });
				dependencies.setStatus(dependencies.copy.done, 'success');
				return Object.freeze({ leftTrackId: track.id, rightTrackId });
			} catch (error) {
				await dependencies.derivedSources.rollbackDerivedSources(derived);
				throw error;
			}
		});
	}

	async function makeStereoTrack(
		trackId: string | null = dependencies.getSelectedTrackId(),
		partnerTrackId: string | null = null,
	): Promise<unknown> {
		dependencies.lifetime.assertActive();
		if (dependencies.editingBlocked()) return null;
		const project = dependencies.getProject();
		const track = requireMonoTrack(project, trackId);
		const trackIndex = project.tracks.findIndex((candidate) => candidate.id === track.id);
		const partner = findMonoPartner(project, track, trackIndex, partnerTrackId);
		if (!partner) throw new Error(dependencies.copy.compatibleMonoTrackRequired
			|| dependencies.copy.monoTrackRequired || dependencies.copy.audioTrackRequired);
		const partnerIndex = project.tracks.findIndex((candidate) => candidate.id === partner.id);
		const clips = [...track.clipIds, ...partner.clipIds]
			.map((clipId) => findControllerClip(project, clipId))
			.filter((clip): clip is ControllerClip => Boolean(clip));
		const startFrame = clips.length ? Math.min(...clips.map((clip) => clip.timelineStartFrame)) : 0;
		const endFrame = clips.length ? Math.max(...clips.map((clip) => clip.timelineStartFrame + clip.durationFrames)) : 0;
		if (endFrame <= startFrame) return dependencies.commit({ type: 'batch', commands: [
			{ type: 'track/update', trackId: track.id, changes: { pan: 0 } },
			{ type: 'track/remove', trackId: partner.id },
		] }, { selectTrackId: track.id });
		const frameCount = endFrame - startFrame;
		return runTransform(dependencies.copy.rewritingChannels || dependencies.copy.audacityProcessing, async (ownership) => {
			await dependencies.preflightStorage(frameCount * 2 * Float32Array.BYTES_PER_ELEMENT, 'effect');
			assertOwned(ownership);
			const derived: DerivedSourceRecord[] = [];
			try {
				const [leftChannels, rightChannels] = await Promise.all([
					dependencies.renderDryTrackRange(track.id, startFrame, endFrame, 1),
					dependencies.renderDryTrackRange(partner.id, startFrame, endFrame, 1),
				]);
				assertOwned(ownership);
				const sourceRate = dependencies.projectSampleRate();
				const template = findControllerSource(project, clips[0]?.sourceId) || syntheticSource(track.name, frameCount, sourceRate);
				const stereo = await dependencies.derivedSources.persistDerivedSource({
					...template,
					sampleRate: sourceRate,
					originalSampleRate: template.originalSampleRate || template.sampleRate || sourceRate,
				}, [leftChannels[0]!, rightChannels[0]!], `${track.name} — ${dependencies.copy.stereo}`, 'stereo-source');
				derived.push(stereo);
				assertOwned(ownership);
				const clipId = dependencies.createId('clip');
				const insertIndex = Math.min(trackIndex, partnerIndex);
				const commands: AudioEditorCommand[] = [
					createAddSourceCommand(stereo.source),
					{ type: 'track/remove', trackId: track.id },
					{ type: 'track/remove', trackId: partner.id },
					{ ...createAddTrackCommand({ ...track, clipIds: [], pan: 0 }), index: insertIndex },
					createAddClipCommand(track.id, {
						id: clipId,
						sourceId: stereo.source.id,
						title: track.name,
						timelineStartFrame: startFrame,
						sourceStartFrame: 0,
						sourceDurationFrames: frameCount,
						durationFrames: frameCount,
					}),
				];
				dependencies.commit({ type: 'batch', commands }, { selectTrackId: track.id, selectClipId: clipId });
				dependencies.setStatus(dependencies.copy.done, 'success');
				return track.id;
			} catch (error) {
				await dependencies.derivedSources.rollbackDerivedSources(derived);
				throw error;
			}
		});
	}

	async function runTransform<Result>(
		status: string,
		operation: (ownership: TransformOwnership) => Promise<Result>,
	): Promise<Result> {
		const ownership = {
			project: dependencies.captureProject(),
			task: dependencies.lifetime.startTask(TRACK_TRANSFORM_TASK),
		};
		dependencies.setProcessing(true);
		dependencies.setStatus(status);
		dependencies.publish();
		try {
			return await operation(ownership);
		} finally {
			if (taskIsCurrent(ownership.task)) {
				dependencies.setProcessing(false);
				if (projectIsCurrent(ownership.project)) dependencies.publish();
				ownership.task.finish();
			}
		}
	}

	function requireAudioTrack(project: ControllerProject, trackId: string | null): ControllerTrack {
		if (project.schemaVersion < 2) throw new Error(dependencies.copy.v2Required);
		const track = findControllerTrack(project, trackId);
		if (!track || track.type !== 'audio') throw new Error(dependencies.copy.audioTrackRequired);
		return track;
	}

	function requireStereoTrack(project: ControllerProject, trackId: string | null): ControllerTrack {
		const track = requireAudioTrack(project, trackId);
		if (dependencies.audioTrackChannelCount(project, track) !== 2) {
			throw new Error(dependencies.copy.stereoTrackRequired || dependencies.copy.audioTrackRequired);
		}
		return track;
	}

	function requireMonoTrack(project: ControllerProject, trackId: string | null): ControllerTrack {
		const track = requireAudioTrack(project, trackId);
		if (dependencies.audioTrackChannelCount(project, track) !== 1) {
			throw new Error(dependencies.copy.monoTrackRequired || dependencies.copy.audioTrackRequired);
		}
		return track;
	}

	function assertOwned(ownership: TransformOwnership): void {
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

	function addResampledClipCommands(
		commands: AudioEditorCommand[],
		track: ControllerTrack,
		clip: ControllerClip,
		replacements: ReadonlyMap<string, DerivedSourceRecord>,
		sampleRate: number,
	): void {
		const originalSource = findControllerSource(dependencies.getProject(), clip.sourceId);
		const replacement = replacements.get(clip.sourceId);
		if (!originalSource || !replacement) return;
		const ratio = sampleRate / originalSource.sampleRate;
		const sourceStartFrame = Math.min(replacement.source.frameCount - 1, Math.max(0, Math.round(clip.sourceStartFrame * ratio)));
		const requestedDuration = Math.max(1, Math.round((clip.sourceDurationFrames || clip.durationFrames) * ratio));
		const sourceDurationFrames = Math.min(requestedDuration, replacement.source.frameCount - sourceStartFrame);
		const trimStartFrames = Math.min(sourceStartFrame, Math.max(0, Math.round((clip.trimStartFrames || 0) * ratio)));
		const trimEndFrames = Math.min(
			replacement.source.frameCount - sourceStartFrame - sourceDurationFrames,
			Math.max(0, Math.round((clip.trimEndFrames || 0) * ratio)),
		);
		commands.push(
			{ type: 'clip/remove', clipId: clip.id },
			createAddClipCommand(track.id, {
				...clip,
				sourceId: replacement.source.id,
				sourceStartFrame,
				sourceDurationFrames,
				trimStartFrames,
				trimEndFrames,
			}),
		);
	}

	function addSplitClipCommands(
		commands: AudioEditorCommand[],
		track: ControllerTrack,
		rightTrackId: string,
		clip: ControllerClip,
		pairs: ReadonlyMap<string, Readonly<{ left: ControllerSource; right: ControllerSource }>>,
	): void {
		const pair = pairs.get(clip.sourceId);
		if (!pair) return;
		commands.push(
			createAddClipCommand(track.id, { ...clip, sourceId: pair.left.id }),
			createAddClipCommand(rightTrackId, {
				...clip,
				id: dependencies.createId('clip'),
				sourceId: pair.right.id,
				title: `${clip.title} — ${dependencies.copy.rightChannel}`,
			}),
		);
	}

	function findMonoPartner(
		project: ControllerProject,
		track: ControllerTrack,
		trackIndex: number,
		partnerTrackId: string | null,
	): ControllerTrack | null {
		const requested = findControllerTrack(project, partnerTrackId);
		if (requested) return requested;
		return project.tracks.find((candidate, index) => candidate.id !== track.id
			&& candidate.type === 'audio'
			&& dependencies.audioTrackChannelCount(project, candidate) === 1
			&& index > trackIndex)
			|| project.tracks.find((candidate) => candidate.id !== track.id
				&& candidate.type === 'audio'
				&& dependencies.audioTrackChannelCount(project, candidate) === 1)
			|| null;
	}
}

function trackClips(project: ControllerProject, track: ControllerTrack): ControllerClip[] {
	return track.clipIds.map((clipId) => findControllerClip(project, clipId))
		.filter((clip): clip is ControllerClip => Boolean(clip));
}

function syntheticSource(name: string, frameCount: number, sampleRate: number): ControllerSource {
	return {
		id: 'stereo-template',
		storageKey: 'stereo-template',
		name,
		mimeType: 'audio/wav',
		frameCount,
		channelCount: 1,
		sampleRate,
		originalSampleRate: sampleRate,
		sampleFormat: 'float32',
	};
}
