/* SPDX-License-Identifier: AGPL-3.0-only */

import type { VideoProxyCandidateObserver } from '../common/editor/video-proxy-candidate-observation.ts';
import {
	createFramescaperNativeProResProxyCandidateObserverV28,
	type FramescaperNativeProResProxyCandidateV28Options,
} from './editor-native-prores-proxy-candidate-v28.ts';
import { FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE } from './editor-project-runtime-profile-v28.ts';
import { assertFramescaperProjectV31Profile } from './editor-project-runtime-profile-v31.ts';
import { framescaperProjectV28FoundationShapeV31 } from './editor-project-v31-foundation.ts';

export interface FramescaperNativeProResProxyCandidateV31Options
	extends Omit<FramescaperNativeProResProxyCandidateV28Options, 'profile'> {
	readonly profile: unknown;
}

/** Route native ProRes Proxy planning through the exact F31-to-V28 foundation. */
export function createFramescaperNativeProResProxyCandidateObserverV31(
	options: FramescaperNativeProResProxyCandidateV31Options,
): VideoProxyCandidateObserver | null {
	assertFramescaperProjectV31Profile(options.profile);
	return createFramescaperNativeProResProxyCandidateObserverV28({
		...options,
		profile: FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE,
		getProject: () => framescaperProjectV28FoundationShapeV31(options.getProject()),
	});
}
