/* SPDX-License-Identifier: AGPL-3.0-only */

import { hasCoreEditingProjectAuthority, isSoundscaperProductionProject } from '../../../project-schema-version.ts'; import { publishedCopyFor } from '../../shared/presentation-localization.ts'; import { createLocalizedError, setLocalizedStatus } from '../../../../i18n/presentation-message.ts';

import {
	createAddClipCommand,
	createAddSourceCommand,
	createAddTrackCommand,
	createReplaceClipSourceCommand,
} from '../../../commands/factories.ts';
import type { AudioEditorCommand } from '../../../commands/protocol.ts';
import { scaleSampleFrame } from '../../../timeline-time.ts';
import { deriveSourceProvenance } from '../../../source-provenance-derivation.ts';
import { resampledClipCommands } from './clip-resample-service.ts';
import type { DerivedSourceService } from './derived-audio/derived-source-service.ts';
import { v21StripLaneRemovalCommands } from '../mix-render-model.ts';
import {
	isCurrentAssertion,
	type EditorControllerLifetime,
	type EditorProjectToken,
	type EditorTaskScope,
} from '../../shared/lifecycle.ts';
import {
	findControllerClip,
	findControllerSource,
	findControllerTrack,
	type ControllerClip,
	type ControllerProject,
	type ControllerSource,
	type ControllerTrack,
	type DerivedSourceRecord,
} from '../track-domain-types.ts';

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
	setStatus(message: string, state?: string, localization?: import('../../../../i18n/presentation-message.ts').LocalizedPresentationMessage): void;
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
		requestedClipIds?: readonly string[] | null,
		signal?: AbortSignal | null,
		processing?: 'dry' | 'authored',
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
				sum + Math.max(1, scaleSampleFrame(source.frameCount, source.sampleRate, sampleRate, 'point'))
				* source.channelCount * Float32Array.BYTES_PER_ELEMENT
		), 0);
		return runTransform(dependencies.copy.resamplingTrack ? 'resamplingTrack' : 'audacityProcessing', async (ownership) => {
			await dependencies.preflightStorage(estimatedBytes, 'effect');
			assertOwned(ownership);
			const derived: DerivedSourceRecord[] = [];
			try {
				const replacements = new Map<string, DerivedSourceRecord>();
				for (const source of sourcesToResample) {
					const input = await dependencies.derivedSources.sourceChannelsForEdit(source);
					assertOwned(ownership);
					const outputFrames = Math.max(1, scaleSampleFrame(
						source.frameCount, source.sampleRate, sampleRate, 'point',
					));
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
				setLocalizedStatus(dependencies.setStatus, dependencies.copy, "done", undefined, 'success');
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
		return runTransform(dependencies.copy.rewritingChannels ? 'rewritingChannels' : 'audacityProcessing', async (ownership) => {
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
						`${source.name} — ${publishedCopyFor(dependencies.copy).channelsSwapped}`,
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
				setLocalizedStatus(dependencies.setStatus, dependencies.copy, "done", undefined, 'success');
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
		return runTransform(dependencies.copy.rewritingChannels ? 'rewritingChannels' : 'audacityProcessing', async (ownership) => {
			await dependencies.preflightStorage(bytes, 'effect');
			assertOwned(ownership);
			const derived: DerivedSourceRecord[] = [];
			try {
				const sourcePairs = new Map<string, Readonly<{ left: ControllerSource; right: ControllerSource }>>();
				for (const source of sources) {
					const channels = await dependencies.derivedSources.sourceChannelsForEdit(source);
					assertOwned(ownership);
					const left = await dependencies.derivedSources.persistDerivedSource(
						source, [channels[0]!], `${source.name} — ${publishedCopyFor(dependencies.copy).leftChannel}`, 'left-source',
					);
					derived.push(left);
					assertOwned(ownership);
					const right = await dependencies.derivedSources.persistDerivedSource(
						source, [channels[1] || channels[0]!], `${source.name} — ${publishedCopyFor(dependencies.copy).rightChannel}`, 'right-source',
					);
					derived.push(right);
					assertOwned(ownership);
					sourcePairs.set(source.id, { left: left.source, right: right.source });
				}
				const rightTrackId = dependencies.createId('track');
				const leftTrack = { ...track, clipIds: [], name: `${track.name} — ${publishedCopyFor(dependencies.copy).leftChannel}`, pan: panChannels ? -1 : 0 };
				const rightTrack = {
					...track,
					id: rightTrackId,
					clipIds: [],
					laneGroupId: null,
					name: `${track.name} — ${publishedCopyFor(dependencies.copy).rightChannel}`,
					pan: panChannels ? 1 : 0,
					armed: false,
					effects: (track.effects || []).map((effect) => ({ ...effect, id: dependencies.createId('effect') })),
				};
				const laneTracks = track.laneGroupId == null ? [] : project.tracks
					.filter((candidate) => candidate.laneGroupId === track.laneGroupId);
				const avLinkClipIds = new Map(clips.flatMap((clip) => (
					typeof clip.avLinkId === 'string' && clip.avLinkId
						? [[clip.avLinkId, clip.id] as const]
						: []
				)));
				const commands: AudioEditorCommand[] = [
					...derived.map(({ source }) => createAddSourceCommand(source)),
					...laneTracks.map((candidate): AudioEditorCommand => ({
						type: 'track/update', trackId: candidate.id, changes: { laneGroupId: null },
					})),
					...[...avLinkClipIds.values()].map((linkedClipId): AudioEditorCommand => ({
						type: 'clip/unlink-av', clipId: linkedClipId,
					})),
					{ type: 'track/remove', trackId: track.id },
					{ ...createAddTrackCommand({ ...leftTrack, laneGroupId: null }), index: trackIndex },
					{ ...createAddTrackCommand(rightTrack), index: trackIndex + 1 },
				];
				for (const clip of clips) addSplitClipCommands(commands, track, rightTrackId, clip, sourcePairs);
				assertOwned(ownership);
				dependencies.commit({ type: 'batch', commands }, { selectTrackId: track.id });
				setLocalizedStatus(dependencies.setStatus, dependencies.copy, "done", undefined, 'success');
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
		if (track.laneGroupId != null) throw createLocalizedError(Error, dependencies.copy, dependencies.copy.compatibleMonoTrackRequired ? 'compatibleMonoTrackRequired' : dependencies.copy.monoTrackRequired ? 'monoTrackRequired' : 'audioTrackRequired');
		const trackIndex = project.tracks.findIndex((candidate) => candidate.id === track.id);
		const partner = findMonoPartner(project, track, trackIndex, partnerTrackId);
		if (!partner) throw createLocalizedError(Error, dependencies.copy, dependencies.copy.compatibleMonoTrackRequired ? 'compatibleMonoTrackRequired' : dependencies.copy.monoTrackRequired ? 'monoTrackRequired' : 'audioTrackRequired');
		const partnerIndex = project.tracks.findIndex((candidate) => candidate.id === partner.id);
		const clips = [...(track.clipIds ?? []), ...(partner.clipIds ?? [])]
			.map((clipId) => findControllerClip(project, clipId))
			.filter((clip): clip is ControllerClip => Boolean(clip));
		const startFrame = clips.length ? Math.min(...clips.map((clip) => clip.timelineStartFrame)) : 0;
		const endFrame = clips.length ? Math.max(...clips.map((clip) => clip.timelineStartFrame + clip.durationFrames)) : 0;
		if (endFrame <= startFrame) return dependencies.commit({ type: 'batch', commands: [
			{ type: 'track/update', trackId: track.id, changes: { pan: 0 } },
			{ type: 'track/remove', trackId: partner.id },
		] }, { selectTrackId: track.id });
		const frameCount = endFrame - startFrame;
		return runTransform(dependencies.copy.rewritingChannels ? 'rewritingChannels' : 'audacityProcessing', async (ownership) => {
			await dependencies.preflightStorage(frameCount * 2 * Float32Array.BYTES_PER_ELEMENT, 'effect');
			assertOwned(ownership);
			const derived: DerivedSourceRecord[] = [];
			try {
				const [leftChannels, rightChannels] = await Promise.all([
					dependencies.renderDryTrackRange(track.id, startFrame, endFrame, 1, null, null, 'authored'),
					dependencies.renderDryTrackRange(partner.id, startFrame, endFrame, 1, null, null, 'authored'),
				]);
				assertOwned(ownership);
				const sourceRate = dependencies.projectSampleRate();
				const inputSources = [...new Map(clips.flatMap((clip) => {
					const source = findControllerSource(project, clip.sourceId);
					return source ? [[source.id, source] as const] : [];
				})).values()];
				const template = inputSources[0] || syntheticSource(track.name, frameCount, sourceRate);
				const provenance = deriveSourceProvenance(inputSources);
				const stereo = await dependencies.derivedSources.persistDerivedSource({
					...template,
					sampleRate: sourceRate,
					originalSampleRate: template.originalSampleRate || template.sampleRate || sourceRate,
					...(provenance ? { provenance } : {}),
				}, [leftChannels[0]!, rightChannels[0]!], `${track.name} — ${publishedCopyFor(dependencies.copy).stereo}`, 'stereo-source');
				derived.push(stereo);
				assertOwned(ownership);
				const clipId = dependencies.createId('clip');
				const insertIndex = Math.min(trackIndex, partnerIndex);
				const mergedTrack: Record<string, unknown> = {
					...track,
					clipIds: [],
					gain: 1,
					pan: 0,
					mute: false,
					solo: false,
					effectsActive: true,
					effects: [],
				};
				if (isSoundscaperProductionProject(project)) delete mergedTrack.envelope;
				else mergedTrack.envelope = [];
				const commands: AudioEditorCommand[] = [
					createAddSourceCommand(stereo.source),
					...v21StripLaneRemovalCommands(project, track.id),
					...v21StripLaneRemovalCommands(project, partner.id),
					{ type: 'track/remove', trackId: track.id },
					{ type: 'track/remove', trackId: partner.id },
					{ ...createAddTrackCommand(mergedTrack), index: insertIndex },
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
				setLocalizedStatus(dependencies.setStatus, dependencies.copy, "done", undefined, 'success');
				return track.id;
			} catch (error) {
				await dependencies.derivedSources.rollbackDerivedSources(derived);
				throw error;
			}
		});
	}

	async function runTransform<Result>(
		status: keyof TrackTransformCopy,
		operation: (ownership: TransformOwnership) => Promise<Result>,
	): Promise<Result> {
		const ownership = {
			project: dependencies.captureProject(),
			task: dependencies.lifetime.startTask(TRACK_TRANSFORM_TASK),
		};
		dependencies.setProcessing(true);
		setLocalizedStatus(dependencies.setStatus, dependencies.copy, status);
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
		if (!hasCoreEditingProjectAuthority(project)) throw createLocalizedError(Error, dependencies.copy, 'v2Required');
		const track = findControllerTrack(project, trackId);
		if (!track || track.type !== 'audio') throw createLocalizedError(Error, dependencies.copy, 'audioTrackRequired');
		return track;
	}

	function requireStereoTrack(project: ControllerProject, trackId: string | null): ControllerTrack {
		const track = requireAudioTrack(project, trackId);
		if (dependencies.audioTrackChannelCount(project, track) !== 2) {
			throw createLocalizedError(Error, dependencies.copy, dependencies.copy.stereoTrackRequired ? 'stereoTrackRequired' : 'audioTrackRequired');
		}
		return track;
	}

	function requireMonoTrack(project: ControllerProject, trackId: string | null): ControllerTrack {
		const track = requireAudioTrack(project, trackId);
		if (dependencies.audioTrackChannelCount(project, track) !== 1) {
			throw createLocalizedError(Error, dependencies.copy, dependencies.copy.monoTrackRequired ? 'monoTrackRequired' : 'audioTrackRequired');
		}
		return track;
	}

	function assertOwned(ownership: TransformOwnership): void {
		ownership.task.assertCurrent();
		dependencies.assertProject(ownership.project);
	}

	function projectIsCurrent(token: EditorProjectToken): boolean {
		return isCurrentAssertion(() => dependencies.assertProject(token));
	}

	function taskIsCurrent(task: EditorTaskScope): boolean {
		return isCurrentAssertion(() => task.assertCurrent());
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
		commands.push(...resampledClipCommands(
			track.id, clip, originalSource, replacement.source, sampleRate,
		));
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
			createAddClipCommand(track.id, { ...clip, sourceId: pair.left.id, avLinkId: null }),
			createAddClipCommand(rightTrackId, {
				...clip,
				id: dependencies.createId('clip'),
				sourceId: pair.right.id,
				title: `${clip.title} — ${publishedCopyFor(dependencies.copy).rightChannel}`,
				avLinkId: null,
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
		if (partnerTrackId !== null) return compatibleMonoPartner(project, track, requested)
			? requested : null;
		return project.tracks.find((candidate, index) => compatibleMonoPartner(project, track, candidate)
			&& index > trackIndex)
			|| project.tracks.find((candidate) => compatibleMonoPartner(project, track, candidate))
			|| null;
	}

	function compatibleMonoPartner(
		project: ControllerProject,
		track: ControllerTrack,
		candidate: ControllerTrack | null,
	): candidate is ControllerTrack {
		return candidate !== null
			&& candidate.id !== track.id
			&& candidate.type === 'audio'
			&& candidate.laneGroupId == null
			&& dependencies.audioTrackChannelCount(project, candidate) === 1;
	}
}

function trackClips(project: ControllerProject, track: ControllerTrack): ControllerClip[] {
	return (track.clipIds ?? []).map((clipId) => findControllerClip(project, clipId))
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
