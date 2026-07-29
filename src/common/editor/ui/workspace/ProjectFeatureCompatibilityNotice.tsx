/* SPDX-License-Identifier: AGPL-3.0-only */

import { useId } from 'react';

import { audioEffectLabel } from '../../effects.js';
import type {
	ProjectFeatureAudioEffectBypassMetadata,
	ProjectFeatureAudioEffectPlaceholder,
} from '../../project-feature-audio-effect-bypass.ts';
import { PROJECT_FEATURE_CAPABILITY_IDS } from '../../project-feature-capabilities.ts';
import type { ProjectFeatureRequirementsReport } from '../../project-feature-requirements.ts';
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
	readonly scapeCompatibilityEditorPlaybackBypassed: string;
	readonly scapeCompatibilityUnavailable: string;
	readonly scapeCompatibilityUnknown: string;
	readonly scapeCompatibilityBypassed: string;
	readonly scapeCompatibilityRenderedFallback: string;
	readonly track: string;
	readonly groupBus: string;
	readonly sendBus: string;
	readonly master: string;
	readonly [key: string]: string;
}

const resolveAudioEffectLabel = audioEffectLabel as unknown as (
	type: string,
	copy: Readonly<Record<string, string>>,
) => string;

interface NamedEffectOwner {
	readonly id: string;
	readonly name?: string | null;
}

interface AudioEffectOwnerProject {
	readonly tracks?: readonly NamedEffectOwner[];
	readonly mixer?: Readonly<{
		readonly groups?: readonly NamedEffectOwner[];
		readonly sends?: readonly NamedEffectOwner[];
	}> | null;
}

interface ProjectFeatureCompatibilityNoticeProps {
	readonly project?: AudioEffectOwnerProject | null;
	readonly report: ProjectFeatureRequirementsReport | null | undefined;
	readonly audioEffectPlaybackBypass?: ProjectFeatureAudioEffectBypassMetadata | null;
	readonly copy: ProjectFeatureCompatibilityNoticeCopy;
}

export default function ProjectFeatureCompatibilityNotice({
	project,
	report,
	audioEffectPlaybackBypass,
	copy,
}: ProjectFeatureCompatibilityNoticeProps) {
	const headingId = useId();
	const notice = createProjectFeatureCompatibilityNotice(report);
	if (!notice) return null;
	const audioEffectPlaceholderRequirementId = notice.items.find((item) => (
		audioEffectPlaceholders(item, audioEffectPlaybackBypass).length > 0
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
					const placeholders = item.requirementId === audioEffectPlaceholderRequirementId
						? audioEffectPlaceholders(item, audioEffectPlaybackBypass)
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
						{placeholders.length > 0 && <div
							className="kw-audio-editor-compatibility-audio-effects"
							data-project-feature-audio-effect-placeholders
						>
							<h4>{copy.scapeCompatibilityAffectedAudioEffects}</h4>
							<ul aria-label={copy.scapeCompatibilityAffectedAudioEffects}>
								{placeholders.map((placeholder) => <li
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
					</li>;
				})}
			</ul>
		</section>
	</aside>;
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
