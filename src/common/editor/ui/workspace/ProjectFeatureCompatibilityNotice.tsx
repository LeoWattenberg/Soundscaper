/* SPDX-License-Identifier: AGPL-3.0-only */

import { useId } from 'react';

import { audioEffectLabel } from '../../effects.js';
import type {
	ProjectFeatureAffectedObject,
	ProjectFeatureAffectedObjectIndex,
} from '../../project-feature-affected-objects.ts';
import type {
	ProjectFeatureAudioEffectBypassMetadata,
	ProjectFeatureAudioEffectPlaceholder,
} from '../../project-feature-audio-effect-bypass.ts';
import type { ProjectFeatureAudioRenderedFallbackMetadata } from '../../project-feature-audio-rendered-fallback.ts';
import { PROJECT_FEATURE_CAPABILITY_IDS } from '../../project-feature-capabilities.ts';
import type { ProjectFeatureRequirementsReport } from '../../project-feature-requirements.ts';
import type {
	ProjectFeatureVideoEffectBypassMetadata,
	ProjectFeatureVideoEffectPlaceholder,
} from '../../project-feature-video-effect-bypass.ts';
import type { ProjectFeatureVideoRenderedFallbackMetadata } from '../../project-feature-video-rendered-fallback.ts';
import { videoEffectDefinition } from '../../video-effects.js';
import {
	createProjectFeatureCompatibilityNotice,
	projectFeatureAvailabilityLabel,
	projectFeatureDispositionLabel,
} from './project-feature-compatibility-notice.ts';

interface ProjectFeatureCompatibilityNoticeCopy {
	readonly projectReadOnly: string;
	readonly scapeCompatibilityTitle: string;
	readonly scapeCompatibilityAffectedFeatures: string;
	readonly scapeCompatibilityAffectedAudioEffects: string;
	readonly scapeCompatibilityAffectedVideoEffects: string;
	readonly scapeCompatibilityAffectedObjects: string;
	readonly scapeCompatibilityAffectedObjectsUnattributable: string;
	readonly scapeCompatibilityAffectedObjectsOmitted: string;
	readonly scapeCompatibilityUnregisteredType: string;
	readonly scapeCompatibilityReplacedForPlayback: string;
	readonly scapeCompatibilityEditorPlaybackBypassed: string;
	readonly scapeCompatibilityEditorPlaybackFallback: string;
	readonly scapeCompatibilityUnavailable: string;
	readonly scapeCompatibilityUnknown: string;
	readonly scapeCompatibilityBypassed: string;
	readonly scapeCompatibilityRenderedFallback: string;
	readonly track: string;
	readonly groupBus: string;
	readonly sendBus: string;
	readonly master: string;
	readonly timeline: string;
	readonly panelProjectBin: string;
	readonly [key: string]: string;
}

const resolveAudioEffectLabel = audioEffectLabel as unknown as (
	type: string,
	copy: Readonly<Record<string, string>>,
) => string;

interface NamedEffectOwner {
	readonly id: string;
	readonly name?: string | null;
	readonly title?: string | null;
}

interface AudioEffectOwnerProject {
	readonly tracks?: readonly NamedEffectOwner[];
	readonly clips?: readonly NamedEffectOwner[];
	readonly projectBin?: Readonly<{ readonly clips?: readonly NamedEffectOwner[] }> | null;
	readonly mixer?: Readonly<{
		readonly groups?: readonly NamedEffectOwner[];
		readonly sends?: readonly NamedEffectOwner[];
	}> | null;
}

interface ProjectFeatureCompatibilityNoticeProps {
	readonly project?: AudioEffectOwnerProject | null;
	readonly report: ProjectFeatureRequirementsReport | null | undefined;
	readonly audioEffectPlaybackBypass?: ProjectFeatureAudioEffectBypassMetadata | null;
	readonly audioRenderedFallback?: ProjectFeatureAudioRenderedFallbackMetadata | null;
	readonly videoEffectPlaybackBypass?: ProjectFeatureVideoEffectBypassMetadata | null;
	readonly videoRenderedFallback?: ProjectFeatureVideoRenderedFallbackMetadata | null;
	readonly affectedObjects?: ProjectFeatureAffectedObjectIndex | null;
	readonly copy: ProjectFeatureCompatibilityNoticeCopy;
}

export default function ProjectFeatureCompatibilityNotice({
	project,
	report,
	audioEffectPlaybackBypass,
	audioRenderedFallback,
	videoEffectPlaybackBypass,
	videoRenderedFallback,
	affectedObjects,
	copy,
}: ProjectFeatureCompatibilityNoticeProps) {
	const headingId = useId();
	const notice = createProjectFeatureCompatibilityNotice(report);
	if (!notice) return null;
	const audioEffectPlaceholderRequirementId = notice.items.find((item) => (
		audioEffectPlaceholders(item, audioEffectPlaybackBypass).length > 0
	))?.requirementId ?? null;
	const videoEffectPlaceholderRequirementId = notice.items.find((item) => (
		videoEffectPlaceholders(item, videoEffectPlaybackBypass).length > 0
	))?.requirementId ?? null;
	return <aside
		className="kw-audio-editor__project-feature-compatibility"
		aria-labelledby={headingId}
		tabIndex={0}
		data-project-feature-compatibility
	>
		<header>
			<div role="status" aria-atomic="true">
				<h2 id={headingId}>{copy.scapeCompatibilityTitle}</h2>
				<p>{copy.projectReadOnly}</p>
			</div>
			<dl className="kw-audio-editor-compatibility-counts">
				<div>
					<dt>{copy.scapeCompatibilityUnavailable}</dt>
					<dd data-project-feature-unavailable-count>{notice.counts.unavailable}</dd>
				</div>
				<div>
					<dt>{copy.scapeCompatibilityUnknown}</dt>
					<dd data-project-feature-unknown-count>{notice.counts.unknown}</dd>
				</div>
			</dl>
		</header>
		<section aria-labelledby={`${headingId}-affected`}>
			<h3 id={`${headingId}-affected`}>{copy.scapeCompatibilityAffectedFeatures}</h3>
			<ul className="kw-audio-editor-compatibility-items" data-project-feature-requirements>
				{notice.items.map((item) => {
					const audioPlaceholders = item.requirementId === audioEffectPlaceholderRequirementId
						? audioEffectPlaceholders(item, audioEffectPlaybackBypass)
						: [];
					const videoPlaceholders = item.requirementId === videoEffectPlaceholderRequirementId
						? videoEffectPlaceholders(item, videoEffectPlaybackBypass)
						: [];
					return <li
						key={item.requirementId}
						data-severity="warning"
						data-project-feature-requirement={item.featureId}
						data-availability={item.availability}
						data-declared-disposition={item.declaredDisposition}
						data-effective-disposition={item.effectiveDisposition}
					>
						<strong>{item.displayName}</strong>
						<small>{item.featureId}</small>
						<small>
							{projectFeatureAvailabilityLabel(item, copy)} · {projectFeatureDispositionLabel(item, copy)}
						</small>
						{audioRenderedFallbackApplies(item, audioRenderedFallback) && <small
							data-project-feature-audio-rendered-fallback
						>
							{copy.scapeCompatibilityEditorPlaybackFallback}
						</small>}
						{videoRenderedFallbackApplies(item, videoRenderedFallback) && <small
							data-project-feature-video-rendered-fallback
						>
							{copy.scapeCompatibilityEditorPlaybackFallback}
						</small>}
						{audioPlaceholders.length > 0 && <div
							className="kw-audio-editor-compatibility-audio-effects"
							data-project-feature-audio-effect-placeholders
						>
							<h4>{copy.scapeCompatibilityAffectedAudioEffects}</h4>
							<ul aria-label={copy.scapeCompatibilityAffectedAudioEffects}>
								{audioPlaceholders.map((placeholder) => <li
									key={`${placeholder.scope}:${placeholder.ownerId ?? 'master'}:${placeholder.effectId}`}
									data-audio-effect-placeholder={placeholder.effectId}
									data-scope={placeholder.scope}
									data-owner-id={placeholder.ownerId ?? ''}
									data-effect-type={placeholder.effectType}
									data-effective-disposition="bypassed"
								>
									<strong>{resolveAudioEffectLabel(placeholder.effectType, copy)}</strong>
									<small>{audioEffectOwnerLabel(placeholder, project, copy)}</small>
									<small>{copy.scapeCompatibilityEditorPlaybackBypassed}</small>
								</li>)}
							</ul>
						</div>}
						{videoPlaceholders.length > 0 && <div
							className="kw-audio-editor-compatibility-video-effects"
							data-project-feature-video-effect-placeholders
						>
							<h4>{copy.scapeCompatibilityAffectedVideoEffects}</h4>
							<ul aria-label={copy.scapeCompatibilityAffectedVideoEffects}>
								{videoPlaceholders.map((placeholder) => <li
									key={`${placeholder.location}:${placeholder.clipId}:${placeholder.effectId}`}
									data-video-effect-placeholder={placeholder.effectId}
									data-location={placeholder.location}
									data-clip-id={placeholder.clipId}
									data-effect-type={placeholder.effectType}
									data-effective-disposition="bypassed"
								>
									<strong>{videoEffectLabel(placeholder.effectType, copy)}</strong>
									<small>{videoEffectOwnerLabel(placeholder, project, copy)}</small>
									<small>{copy.scapeCompatibilityEditorPlaybackBypassed}</small>
								</li>)}
							</ul>
						</div>}
						{genericAffectedSection(item.requirementId, affectedObjects, copy)}
					</li>;
				})}
			</ul>
		</section>
	</aside>;
}

function audioRenderedFallbackApplies(
	item: Readonly<{
		requirementId: string;
		featureId: string;
		availability: string;
		declaredDisposition: string;
		effectiveDisposition: string;
	}>,
	metadata: ProjectFeatureAudioRenderedFallbackMetadata | null | undefined,
): boolean {
	return metadata?.schemaVersion === 1
		&& item.featureId === metadata.featureId
		&& item.requirementId === metadata.requirementId
		&& (
			(metadata.role === 'project-audio-mix-v1'
				&& (item.availability === 'unavailable' || item.availability === 'unknown'))
			|| (metadata.role === 'audio-track-render-v1'
				&& metadata.featureId === PROJECT_FEATURE_CAPABILITY_IDS.audioEffects
				&& item.availability === 'unavailable')
		)
		&& item.declaredDisposition === 'rendered-fallback'
		&& item.effectiveDisposition === 'rendered-fallback';
}

function videoRenderedFallbackApplies(
	item: Readonly<{
		requirementId: string;
		featureId: string;
		availability: string;
		declaredDisposition: string;
		effectiveDisposition: string;
	}>,
	metadata: ProjectFeatureVideoRenderedFallbackMetadata | null | undefined,
): boolean {
	return metadata?.schemaVersion === 1
		&& item.featureId === metadata.featureId
		&& item.requirementId === metadata.requirementId
		&& (
			(metadata.role === 'project-video-render-v1'
				&& (item.availability === 'unavailable' || item.availability === 'unknown'))
			|| (metadata.role === 'video-clip-render-v1'
				&& metadata.featureId === PROJECT_FEATURE_CAPABILITY_IDS.videoEffects
				&& item.availability === 'unavailable')
		)
		&& item.declaredDisposition === 'rendered-fallback'
		&& item.effectiveDisposition === 'rendered-fallback';
}

function audioEffectPlaceholders(
	item: Readonly<{ requirementId: string; featureId: string; effectiveDisposition: string }>,
	metadata: ProjectFeatureAudioEffectBypassMetadata | null | undefined,
): readonly ProjectFeatureAudioEffectPlaceholder[] {
	if (
		metadata?.featureId !== PROJECT_FEATURE_CAPABILITY_IDS.audioEffects
		|| item.featureId !== metadata.featureId
		|| item.effectiveDisposition !== 'bypassed'
		|| !metadata.requirementIds.includes(item.requirementId)
	) return [];
	return metadata.placeholders;
}

function audioEffectOwnerLabel(
	placeholder: ProjectFeatureAudioEffectPlaceholder,
	project: AudioEffectOwnerProject | null | undefined,
	copy: ProjectFeatureCompatibilityNoticeCopy,
): string {
	if (placeholder.scope === 'master') return copy.master;
	const collection = placeholder.scope === 'track'
		? project?.tracks
		: placeholder.scope === 'group'
			? project?.mixer?.groups
			: project?.mixer?.sends;
	const ownerName = collection?.find((owner) => owner.id === placeholder.ownerId)?.name?.trim();
	const scopeLabel = placeholder.scope === 'track'
		? copy.track
		: placeholder.scope === 'group'
			? copy.groupBus
			: copy.sendBus;
	return ownerName ? `${scopeLabel} · ${ownerName}` : scopeLabel;
}

function videoEffectPlaceholders(
	item: Readonly<{ requirementId: string; featureId: string; effectiveDisposition: string }>,
	metadata: ProjectFeatureVideoEffectBypassMetadata | null | undefined,
): readonly ProjectFeatureVideoEffectPlaceholder[] {
	if (
		metadata?.featureId !== PROJECT_FEATURE_CAPABILITY_IDS.videoEffects
		|| item.featureId !== metadata.featureId
		|| item.effectiveDisposition !== 'bypassed'
		|| !metadata.requirementIds.includes(item.requirementId)
	) return [];
	return metadata.placeholders;
}

function videoEffectLabel(
	effectType: string,
	copy: ProjectFeatureCompatibilityNoticeCopy,
): string {
	try {
		const definition = videoEffectDefinition(effectType);
		return copy[definition.labelKey] || definition.label;
	} catch {
		return effectType;
	}
}

function videoEffectOwnerLabel(
	placeholder: ProjectFeatureVideoEffectPlaceholder,
	project: AudioEffectOwnerProject | null | undefined,
	copy: ProjectFeatureCompatibilityNoticeCopy,
): string {
	const collection = placeholder.location === 'timeline'
		? project?.clips
		: project?.projectBin?.clips;
	const clip = collection?.find((candidate) => candidate.id === placeholder.clipId);
	const clipName = (clip?.title || clip?.name)?.trim();
	const locationLabel = placeholder.location === 'timeline' ? copy.timeline : copy.panelProjectBin;
	return clipName ? `${locationLabel} · ${clipName}` : locationLabel;
}

/**
 * Objects the dedicated first-party sections already list are omitted here, so
 * this section carries only newly visible state: canonical objects a rendered
 * fallback replaces, and effects whose type is outside the maintained registry.
 */
function newlyVisibleObjects(
	objects: readonly ProjectFeatureAffectedObject[],
): readonly ProjectFeatureAffectedObject[] {
	return objects.filter((object) => (
		object.channel === 'rendered-fallback-replaced' || !object.registered
	));
}

function genericAffectedSection(
	requirementId: string,
	index: ProjectFeatureAffectedObjectIndex | null | undefined,
	copy: ProjectFeatureCompatibilityNoticeCopy,
) {
	const requirement = index?.requirements.find(
		(candidate) => candidate.requirementId === requirementId,
	);
	if (!requirement) return null;
	if (!requirement.attributable) {
		return <small data-project-feature-affected-objects-unattributable>
			{copy.scapeCompatibilityAffectedObjectsUnattributable}
		</small>;
	}
	const objects = newlyVisibleObjects(requirement.objects);
	if (objects.length === 0 && requirement.omittedObjectCount === 0) return null;
	return <div
		className="kw-audio-editor-compatibility-affected-objects"
		data-project-feature-affected-objects
	>
		<h4>{copy.scapeCompatibilityAffectedObjects}</h4>
		<ul aria-label={copy.scapeCompatibilityAffectedObjects}>
			{objects.map((object) => <li
				key={`${object.channel}:${object.location}:${object.scope}:${object.ownerId ?? ''}:${object.objectId}`}
				data-affected-object={object.objectId}
				data-channel={object.channel}
				data-location={object.location}
				data-scope={object.scope}
				data-owner-id={object.ownerId ?? ''}
				data-object-type={object.objectType}
				data-registered={object.registered ? 'true' : 'false'}
			>
				<strong>{object.objectId}</strong>
				<small>{object.objectType}</small>
				<small>{object.channel === 'rendered-fallback-replaced'
					? copy.scapeCompatibilityReplacedForPlayback
					: copy.scapeCompatibilityUnregisteredType}</small>
			</li>)}
		</ul>
		{requirement.omittedObjectCount > 0 && <small data-project-feature-affected-objects-omitted>
			{copy.scapeCompatibilityAffectedObjectsOmitted}
		</small>}
	</div>;
}
