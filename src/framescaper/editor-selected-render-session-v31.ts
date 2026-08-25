/* SPDX-License-Identifier: AGPL-3.0-only */

import { FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE } from './editor-project-runtime-profile-v28.ts';
import { assertFramescaperProjectV31Profile } from './editor-project-runtime-profile-v31.ts';
import { framescaperProjectV28FoundationShapeV31 } from './editor-project-v31-foundation.ts';
import {
	bindFramescaperSelectedRenderSessionRuntimeV28Instance,
	createFramescaperSelectedRenderSessionV28,
} from './editor-selected-v28-render-session.ts';

/** Retain every V28 render-session consumer over F31's detached foundation. */
export function bindFramescaperSelectedRenderSessionRuntimeV31(
	profile: unknown,
	controller: Readonly<{ readonly project: unknown }>,
): void {
	assertFramescaperProjectV31Profile(profile);
	if (!controller || typeof controller !== 'object') {
		throw new TypeError('The selected F31 render-session owner must be a controller.');
	}
	bindFramescaperSelectedRenderSessionRuntimeV28Instance(controller, Object.freeze({
		create: (authority: unknown) => createFramescaperSelectedRenderSessionV28({
			profile: FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE,
			project: framescaperProjectV28FoundationShapeV31(structuredClone(controller.project)),
			authority,
		}),
	}));
}
