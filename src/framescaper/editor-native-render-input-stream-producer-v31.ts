/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ProductNativeRenderInputAuthorityBinding } from '../common/editor/controller/product-native-render-input-authority.ts';
import { adaptFramescaperNativeRenderInputAuthorityV31 } from './editor-controller-v31-foundation-view.ts';
import {
	FRAMESCAPER_NATIVE_RENDER_INPUT_PRODUCER_DEPENDENCIES_V28,
	type FramescaperNativeRenderInputProducerDependenciesV28,
	type FramescaperNativeRenderInputRequestV28,
	type NativeRenderInputStoreV28,
} from './editor-native-render-input-producer-v28.ts';
import {
	createFramescaperNativeRenderInputStreamProducerV28,
	type FramescaperNativeRenderInputStreamV28,
} from './editor-native-render-input-stream-producer-v28.ts';
import { FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE } from './editor-project-runtime-profile-v28.ts';
import { assertFramescaperProjectV31Profile } from './editor-project-runtime-profile-v31.ts';

/** Retain the V28 evaluated carrier while the controller owns an exact F31 lease. */
export function createFramescaperNativeRenderInputStreamProducerV31(
	profile: unknown,
	authority: Readonly<{
		readonly authority: ProductNativeRenderInputAuthorityBinding;
		readonly store: NativeRenderInputStoreV28;
	}>,
	dependencies: FramescaperNativeRenderInputProducerDependenciesV28 =
		FRAMESCAPER_NATIVE_RENDER_INPUT_PRODUCER_DEPENDENCIES_V28,
): (request: FramescaperNativeRenderInputRequestV28) => Promise<FramescaperNativeRenderInputStreamV28> {
	assertFramescaperProjectV31Profile(profile);
	if (!authority || typeof authority !== 'object') {
		throw new TypeError('F31 native render input requires its exact authority composition.');
	}
	return createFramescaperNativeRenderInputStreamProducerV28(
		FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE,
		{
			authority: adaptFramescaperNativeRenderInputAuthorityV31(authority.authority),
			store: authority.store,
		},
		dependencies,
	);
}
