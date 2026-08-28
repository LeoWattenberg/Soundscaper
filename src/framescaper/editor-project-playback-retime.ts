/* SPDX-License-Identifier: AGPL-3.0-only */

import { compareCodeUnits } from '../common/editor/code-unit-order.ts';
import type {
	PlaybackProjectProjection,
	PlaybackProjectService,
} from '../common/editor/controller/playback-project-service.ts';
import { projectFeatureAudioEffectPlaybackBypass } from '../common/editor/project-feature-audio-effect-bypass.ts';
import { projectFeatureAudioRenderedFallbackPlayback } from '../common/editor/project-feature-audio-rendered-fallback.ts';
import { projectFeatureVideoEffectPlaybackBypass } from '../common/editor/project-feature-video-effect-bypass.ts';
import { projectFeatureVideoRenderedFallbackPlayback } from '../common/editor/project-feature-video-rendered-fallback.ts';
import { registerVideoTimingIndex } from '../common/editor/video-source-time.ts';
import {
	loadVideoTimingAsset,
	type VideoTimingMediaStore,
} from '../common/editor/video-timing-storage.ts';
import {
	createFramescaperProjectFeatureCompatibilityServiceRetime,
} from './editor-project-feature-requirements-retime.ts';
import {
	assertFramescaperProjectRetimeProfile,
	type FramescaperProjectRetimeProfile,
} from './editor-domain-runtime-profile.ts';
import {
	framescaperProjectForPlaybackFoundationRetime,
} from './editor-project-retime-runtime.ts';
import { hasFramescaperProjectIdentity } from './editor-project-identity.ts';
import {
	type FramescaperProjectRetime,
} from './editor-project-retime.ts';
import { validateFramescaperProjectRetime } from './editor-project-retime-validation.ts';

const EMPTY_SOURCE_IDS = Object.freeze([]) as readonly string[];

export interface FramescaperPlaybackProjectServiceRetimeOptions {
	readonly timingStore?: Pick<VideoTimingMediaStore, 'loadMediaAsset'>;
}

/**
 * Run selected exact-retime playback while preserving authored keyframes on every
 * materialized occurrence.
 */
export function createFramescaperPlaybackProjectServiceRetime(
	profile: FramescaperProjectRetimeProfile | unknown,
	optionsValue: FramescaperPlaybackProjectServiceRetimeOptions | unknown = {},
): PlaybackProjectService {
	assertFramescaperProjectRetimeProfile(profile);
	const options = snapshotOptions(optionsValue);
	const compatibility = createFramescaperProjectFeatureCompatibilityServiceRetime(profile);
	return Object.freeze({
		...(options.timingStore ? { prepareProjectForActivation } : {}),
		projectForActivationAdmission,
		projectForPlayback,
		projectForAudioRenderedFallbackDelivery: projectForDelivery,
		projectForVideoRenderedFallbackDelivery: projectForDelivery,
	});

	async function prepareProjectForActivation<Project extends object>(
		project: Project,
		prepareOptions: Readonly<{ readonly signal?: AbortSignal }> = {},
	): Promise<void> {
		if (!hasFramescaperProjectIdentity(project)) return;
		validateFramescaperProjectRetime(profile, project);
		const canonical = project as unknown as FramescaperProjectRetime;
		const timingStore = options.timingStore!;
		const sourceById = new Map(canonical.sources.map((source) => [source.id, source]));
		for (const sourceId of multicameraMemberSourceIds(canonical)) {
			throwIfAborted(prepareOptions.signal);
			const source = sourceById.get(sourceId);
			if (!source || source.kind !== 'video') {
				throw new ReferenceError(`Multicamera source ${sourceId} is unavailable during activation.`);
			}
			const timingDecision = dataRecord(
				source.timingDecision,
				`Multicamera source ${sourceId} timing decision`,
			);
			if (timingDecision.mode !== 'exact') continue;
			const sourceSha256 = nonEmptyString(
				source.contentSha256,
				`Multicamera source ${sourceId} digest`,
			);
			const loaded = await loadVideoTimingAsset(timingStore, source.timingAsset, {
				signal: prepareOptions.signal,
				sourceSha256,
			});
			throwIfAborted(prepareOptions.signal);
			if (loaded.status !== 'available' || !loaded.index) {
				throw new Error(`Multicamera source ${sourceId} timing asset is ${loaded.status}.`);
			}
			registerVideoTimingIndex(source, loaded.index);
		}
	}

	function projectForActivationAdmission<Project extends object>(
		project: Project,
	): PlaybackProjectProjection<Project> {
		if (!hasFramescaperProjectIdentity(project)) {
			return opaqueProjection(project);
		}
		validateFramescaperProjectRetime(profile, project);
		const canonical = project as unknown as FramescaperProjectRetime;
		const projected = compatibilityProjection(canonical, compatibility.evaluate(canonical));
		return Object.freeze({
			project,
			featureRequirementsReport: projected.featureRequirementsReport,
			audioEffectPlaybackBypass: projected.audioEffectPlaybackBypass,
			audioRenderedFallback: projected.audioRenderedFallback,
			videoEffectPlaybackBypass: projected.videoEffectPlaybackBypass,
			videoRenderedFallback: projected.videoRenderedFallback,
			requiredAudioSourceIds: projected.requiredAudioSourceIds,
			requiredVideoSourceIds: frozenSourceIds(
				projected.requiredVideoSourceIds,
				multicameraMemberSourceIds(canonical),
			),
		});
	}

	function projectForPlayback<Project extends object>(
		project: Project,
	): PlaybackProjectProjection<Project> {
		if (!hasFramescaperProjectIdentity(project)) {
			return opaqueProjection(project);
		}
		const canonical = project as unknown as FramescaperProjectRetime;
		const featureRequirementsReport = compatibility.evaluate(canonical);
		const runtimeProject = framescaperProjectForPlaybackFoundationRetime(profile, canonical);
		const projected = compatibilityProjection(runtimeProject, featureRequirementsReport);
		return Object.freeze({
			project: projected.project as unknown as Project,
			featureRequirementsReport: projected.featureRequirementsReport,
			audioEffectPlaybackBypass: projected.audioEffectPlaybackBypass,
			audioRenderedFallback: projected.audioRenderedFallback,
			videoEffectPlaybackBypass: projected.videoEffectPlaybackBypass,
			videoRenderedFallback: projected.videoRenderedFallback,
			requiredAudioSourceIds: projected.requiredAudioSourceIds,
			requiredVideoSourceIds: projected.requiredVideoSourceIds,
		});
	}

	function projectForDelivery<Project extends object>(project: Project) {
		const projection = projectForPlayback(project);
		return Object.freeze({
			project: projection.project,
			featureRequirementsReport: projection.featureRequirementsReport,
			audioRenderedFallback: projection.audioRenderedFallback,
			videoRenderedFallback: projection.videoRenderedFallback,
			requiredAudioSourceIds: projection.requiredAudioSourceIds,
			requiredVideoSourceIds: projection.requiredVideoSourceIds,
		});
	}

	function compatibilityProjection<Project extends object>(
		project: Project,
		featureRequirementsReport: ReturnType<typeof compatibility.evaluate>,
	) {
		const renderedAudio = projectFeatureAudioRenderedFallbackPlayback(project, featureRequirementsReport);
		const renderedVideo = projectFeatureVideoRenderedFallbackPlayback(
			renderedAudio.project,
			featureRequirementsReport,
		);
		const bypassedAudio = projectFeatureAudioEffectPlaybackBypass(
			renderedVideo.project,
			featureRequirementsReport,
		);
		const bypassedVideo = projectFeatureVideoEffectPlaybackBypass(
			bypassedAudio.project,
			featureRequirementsReport,
		);
		return Object.freeze({
			project: bypassedVideo.project,
			featureRequirementsReport,
			audioEffectPlaybackBypass: bypassedAudio.metadata,
			audioRenderedFallback: renderedAudio.metadata,
			videoEffectPlaybackBypass: bypassedVideo.metadata,
			videoRenderedFallback: renderedVideo.metadata,
			requiredAudioSourceIds: Object.freeze(
				renderedAudio.metadata ? [renderedAudio.metadata.sourceId] : [],
			),
			requiredVideoSourceIds: Object.freeze(
				renderedVideo.metadata ? [renderedVideo.metadata.sourceId] : [],
			),
		});
	}
}

function frozenSourceIds(...groups: readonly (readonly string[])[]): readonly string[] {
	return Object.freeze([...new Set(groups.flat())].sort(compareCodeUnits));
}

function multicameraMemberSourceIds(project: FramescaperProjectRetime): readonly string[] {
	const groups = project.multicameraGroups as unknown as readonly Readonly<{
		readonly members: readonly Readonly<{ readonly sourceId: string }>[];
	}>[];
	return Object.freeze([...new Set(groups.flatMap((group) => (
		group.members.map(({ sourceId }) => sourceId)
	)))].sort(compareCodeUnits));
}

function snapshotOptions(value: unknown): Readonly<FramescaperPlaybackProjectServiceRetimeOptions> {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('Framescaper retime playback options must be a plain record.');
	}
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) {
		throw new TypeError('Framescaper retime playback options must be a plain record.');
	}
	const keys = Reflect.ownKeys(value);
	if (keys.some((key) => key !== 'timingStore')) {
		throw new TypeError('Framescaper retime playback options contain an unsupported authority field.');
	}
	const descriptor = Object.getOwnPropertyDescriptor(value, 'timingStore');
	if (!descriptor) return Object.freeze({});
	if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError('The Framescaper retime timing store must be an own enumerable data property.');
	}
	const store = descriptor.value as Partial<VideoTimingMediaStore> | null;
	if (!store || typeof store.loadMediaAsset !== 'function') {
		throw new TypeError('The Framescaper retime playback timing store is invalid.');
	}
	return Object.freeze({
		timingStore: store as Pick<VideoTimingMediaStore, 'loadMediaAsset'>,
	});
}

function throwIfAborted(signal?: AbortSignal): void {
	if (!signal?.aborted) return;
	if (signal.reason !== undefined) throw signal.reason;
	throw new DOMException('Framescaper playback activation was cancelled.', 'AbortError');
}

function dataRecord(value: unknown, name: string): Readonly<Record<string, unknown>> {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`${name} must be a record.`);
	}
	return value as Readonly<Record<string, unknown>>;
}

function nonEmptyString(value: unknown, name: string): string {
	if (typeof value !== 'string' || value.length === 0) {
		throw new TypeError(`${name} must be a non-empty string.`);
	}
	return value;
}

function opaqueProjection<Project extends object>(project: Project): PlaybackProjectProjection<Project> {
	return Object.freeze({
		project,
		featureRequirementsReport: null,
		audioEffectPlaybackBypass: null,
		audioRenderedFallback: null,
		videoEffectPlaybackBypass: null,
		videoRenderedFallback: null,
		requiredAudioSourceIds: EMPTY_SOURCE_IDS,
		requiredVideoSourceIds: EMPTY_SOURCE_IDS,
	});
}
