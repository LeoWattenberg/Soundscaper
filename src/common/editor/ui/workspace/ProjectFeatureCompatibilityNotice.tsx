/* SPDX-License-Identifier: AGPL-3.0-only */

import { useId } from 'react';

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
	readonly scapeCompatibilityUnavailable: string;
	readonly scapeCompatibilityUnknown: string;
	readonly scapeCompatibilityBypassed: string;
	readonly scapeCompatibilityRenderedFallback: string;
}

interface ProjectFeatureCompatibilityNoticeProps {
	readonly report: ProjectFeatureRequirementsReport | null | undefined;
	readonly copy: ProjectFeatureCompatibilityNoticeCopy;
}

export default function ProjectFeatureCompatibilityNotice({
	report,
	copy,
}: ProjectFeatureCompatibilityNoticeProps) {
	const headingId = useId();
	const notice = createProjectFeatureCompatibilityNotice(report);
	if (!notice) return null;
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
				{notice.items.map((item) => <li
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
				</li>)}
			</ul>
		</section>
	</aside>;
}
