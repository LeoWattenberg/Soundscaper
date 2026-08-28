/* SPDX-License-Identifier: AGPL-3.0-only */

import type { OfxEffectStateV26 } from '../common/editor/native-ofx-state-v26.ts';
import {
	reconcileFramescaperProjectFeatureRequirementsOpenFx,
} from './editor-project-feature-requirements-openfx.ts';
import { FRAMESCAPER_PROFESSIONAL_MEDIA_PROJECT_RUNTIME_PROFILE } from './editor-domain-runtime-profile.ts';
import { assertFramescaperProjectOpenFxCandidateProfile } from './editor-domain-runtime-profile.ts';
import {
	createFramescaperProjectProfessionalMedia,
	type FramescaperProjectProfessionalMediaOptions,
} from './editor-project-professional-media.ts';
import {
	FRAMESCAPER_PROJECT_OPENFX_SCHEMA_VERSION,
	validateFramescaperProjectOpenFx,
	type FramescaperProjectOpenFx,
} from './editor-project-openfx-validation.ts';

export {
	FRAMESCAPER_PROJECT_OPENFX_SCHEMA_VERSION,
	validateFramescaperProjectOpenFx,
	type FramescaperProjectOpenFx,
} from './editor-project-openfx-validation.ts';

export type FramescaperProjectOpenFxOptions = FramescaperProjectProfessionalMediaOptions & Readonly<{
	readonly ofxEffects?: readonly OfxEffectStateV26[];
}>;

export function createFramescaperProjectOpenFx(
	profile: unknown,
	options: FramescaperProjectOpenFxOptions = {},
): FramescaperProjectOpenFx {
	assertFramescaperProjectOpenFxCandidateProfile(profile);
	const { ofxEffects = [], ...v25Options } = options;
	const project = createFramescaperProjectProfessionalMedia(
		FRAMESCAPER_PROFESSIONAL_MEDIA_PROJECT_RUNTIME_PROFILE,
		v25Options,
	) as unknown as Record<string, unknown>;
	project.schemaVersion = FRAMESCAPER_PROJECT_OPENFX_SCHEMA_VERSION;
	project.ofxEffects = structuredClone(ofxEffects);
	project.featureRequirements = reconcileFramescaperProjectFeatureRequirementsOpenFx(profile, project);
	validateFramescaperProjectOpenFx(profile, project);
	return project as FramescaperProjectOpenFx;
}

export function cloneFramescaperProjectOpenFx(
	profile: unknown,
	project: unknown,
): FramescaperProjectOpenFx {
	assertFramescaperProjectOpenFxCandidateProfile(profile);
	validateFramescaperProjectOpenFx(profile, project);
	const clone = structuredClone(project) as FramescaperProjectOpenFx;
	validateFramescaperProjectOpenFx(profile, clone);
	return clone;
}
