/* SPDX-License-Identifier: AGPL-3.0-only */

import { FRAMESCAPER_NATIVE_MEDIA_PROJECT_RUNTIME_PROFILE } from './editor-domain-runtime-profile.ts';
import { assertFramescaperProjectAssistanceProfile } from './editor-domain-runtime-profile.ts';
import { framescaperProjectNativeMediaFoundationShapeAssistance } from './editor-project-assistance-foundation.ts';
import {
	bindFramescaperSelectedRenderSessionRuntimeNativeMediaInstance,
	createFramescaperSelectedRenderSessionNativeMedia,
} from './editor-selected-native-media-render-session.ts';

/** Retain every nativeMedia render-session consumer over assistance's detached foundation. */
export function bindFramescaperSelectedRenderSessionRuntimeAssistance(
	profile: unknown,
	controller: Readonly<{ readonly project: unknown }>,
): void {
	assertFramescaperProjectAssistanceProfile(profile);
	if (!controller || typeof controller !== 'object') {
		throw new TypeError('The selected assistance render-session owner must be a controller.');
	}
	bindFramescaperSelectedRenderSessionRuntimeNativeMediaInstance(controller, Object.freeze({
		create: (authority: unknown) => createFramescaperSelectedRenderSessionNativeMedia({
			profile: FRAMESCAPER_NATIVE_MEDIA_PROJECT_RUNTIME_PROFILE,
			project: framescaperProjectNativeMediaFoundationShapeAssistance(foundationInput(controller.project)),
			authority,
		}),
	}));
}

function foundationInput(value: unknown): unknown {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
	const family = Object.getOwnPropertyDescriptor(value, 'schemaFamily');
	return family?.enumerable && Object.hasOwn(family, 'value') && family.value === 'framescaper'
		? value
		: structuredClone(value);
}
