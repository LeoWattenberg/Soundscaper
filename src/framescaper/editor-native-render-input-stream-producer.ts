/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ProductNativeRenderInputAuthorityBinding } from
	'../common/editor/controller/product-native-render-input-authority.ts';
import { adaptFramescaperNativeRenderInputAuthorityAssistance } from
	'./editor-controller-assistance-foundation-view.ts';
import {
	FRAMESCAPER_NATIVE_RENDER_INPUT_PRODUCER_DEPENDENCIES_NATIVE_MEDIA,
	type FramescaperNativeRenderInputProducerDependenciesNativeMedia,
	type FramescaperNativeRenderInputRequestNativeMedia,
	type NativeRenderInputStoreNativeMedia,
} from './editor-native-render-input-producer.ts';
import {
	createFramescaperNativeRenderInputStreamProducerNativeMedia,
	type FramescaperNativeRenderInputStreamNativeMedia,
} from './editor-native-render-input-stream-core.ts';
import { assertFramescaperProjectRuntimeProfile } from './editor-project-runtime-profile.ts';

export function createFramescaperNativeRenderInputStreamProducer(
	profile: unknown,
	authority: Readonly<{
		readonly authority: ProductNativeRenderInputAuthorityBinding;
		readonly store: NativeRenderInputStoreNativeMedia;
	}>,
	dependencies: FramescaperNativeRenderInputProducerDependenciesNativeMedia =
		FRAMESCAPER_NATIVE_RENDER_INPUT_PRODUCER_DEPENDENCIES_NATIVE_MEDIA,
): (request: FramescaperNativeRenderInputRequestNativeMedia) => Promise<FramescaperNativeRenderInputStreamNativeMedia> {
	assertFramescaperProjectRuntimeProfile(profile);
	if (!authority || typeof authority !== 'object') {
		throw new TypeError('Framescaper native render input requires its exact authority composition.');
	}
	return createFramescaperNativeRenderInputStreamProducerNativeMedia(
		profile,
		{
			authority: adaptFramescaperNativeRenderInputAuthorityAssistance(authority.authority),
			store: authority.store,
		},
		dependencies,
	);
}
