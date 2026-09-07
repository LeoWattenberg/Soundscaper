/* SPDX-License-Identifier: AGPL-3.0-only */

import { audioEditorVideoThumbnailTimes, createAudioEditorVideoFrameExtractor } from '../video-media.js';
import type { FramescaperCaptureAppBindingOptions } from './framescaper-capture-app-binding.ts';
import type {
	FramescaperCaptureDerivativeScheduler,
	FramescaperCaptureDerivativeSchedulerOptions,
} from './framescaper-capture-derivative-scheduler.ts';
import type { createFramescaperCaptureProjectWriteAuthority } from './framescaper-capture-project-write-authority.ts';
import type { VideoProxyCandidateRuntime, VideoProxyCandidateCompositionOptions } from './video-proxy-candidate-composition.ts';
import type {
	createFramescaperCaptureProxyActiveProjectSynchronizer,
	createFramescaperCaptureProxySaveQuiescence,
} from './framescaper-capture-proxy-quiescence.ts';

export interface CaptureCompositionRuntime<Binding> {
	createAppBinding(options: FramescaperCaptureAppBindingOptions): Binding;
	createDerivativeScheduler(options: FramescaperCaptureDerivativeSchedulerOptions): FramescaperCaptureDerivativeScheduler;
	createProjectWriteAuthority: typeof createFramescaperCaptureProjectWriteAuthority;
	createProxyActiveProjectSynchronizer: typeof createFramescaperCaptureProxyActiveProjectSynchronizer;
	createProxySaveQuiescence: typeof createFramescaperCaptureProxySaveQuiescence;
}

export type CaptureProxyScheduler = NonNullable<FramescaperCaptureDerivativeSchedulerOptions['scheduleProxy']> & {
	dispose?(): PromiseLike<unknown> | unknown;
};

export interface CaptureProxyCompositionPorts {
	readonly runtime: VideoProxyCandidateRuntime | null | undefined;
	readonly helperTimingProbe: VideoProxyCandidateCompositionOptions['helperTimingProbe'];
	readonly quiesceProjectSaves: ReturnType<typeof createFramescaperCaptureProxySaveQuiescence>;
	readonly synchronizeActiveProject: ReturnType<typeof createFramescaperCaptureProxyActiveProjectSynchronizer>;
}

export interface CaptureCompositionDependencies {
	readonly app: Omit<FramescaperCaptureAppBindingOptions,
		'assertProjectWritable' | 'acquireProjectWriteAuthority' | 'scheduleDerivatives'>;
	readonly authority: Parameters<typeof createFramescaperCaptureProjectWriteAuthority>[0];
	readonly derivatives: Omit<FramescaperCaptureDerivativeSchedulerOptions,
		'createVideoFrameExtractor' | 'videoThumbnailTimes' | 'scheduleProxy'>;
	readonly proxy: Readonly<{
		createScheduler?: (ports: CaptureProxyCompositionPorts) => CaptureProxyScheduler;
		runtime: CaptureProxyCompositionPorts['runtime'];
		helperTimingProbe: CaptureProxyCompositionPorts['helperTimingProbe'];
		saves: Parameters<typeof createFramescaperCaptureProxySaveQuiescence>[0];
		activeProject: Parameters<typeof createFramescaperCaptureProxyActiveProjectSynchronizer>[0];
	}>;
}

/** Keep product capture admission, derivative work, and proxy save fences together. */
export function createCaptureComposition<Binding>(
	runtime: CaptureCompositionRuntime<Binding> | null,
	getDependencies: () => CaptureCompositionDependencies,
) {
	if (!runtime) return Object.freeze({ binding: null, proxyScheduler: null });
	const dependencies = getDependencies();
	const proxyScheduler = dependencies.proxy.createScheduler?.({
		runtime: dependencies.proxy.runtime, helperTimingProbe: dependencies.proxy.helperTimingProbe,
		quiesceProjectSaves: runtime.createProxySaveQuiescence(dependencies.proxy.saves),
		synchronizeActiveProject: runtime.createProxyActiveProjectSynchronizer(dependencies.proxy.activeProject),
	}) ?? null;
	const scheduleDerivatives = runtime.createDerivativeScheduler({
		...dependencies.derivatives,
		createVideoFrameExtractor: createAudioEditorVideoFrameExtractor,
		videoThumbnailTimes: audioEditorVideoThumbnailTimes,
		...(proxyScheduler ? { scheduleProxy: proxyScheduler } : {}),
	});
	const authority = runtime.createProjectWriteAuthority(dependencies.authority);
	const binding = runtime.createAppBinding({
		...dependencies.app, scheduleDerivatives,
		assertProjectWritable: authority.assertProjectWritable,
		acquireProjectWriteAuthority: authority.acquireProjectWriteAuthority,
	});
	return Object.freeze({ binding, proxyScheduler });
}
