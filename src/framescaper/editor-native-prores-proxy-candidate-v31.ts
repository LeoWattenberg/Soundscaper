/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createVideoProxyCandidateObserver,
	VIDEO_PROXY_CANDIDATE_MAXIMUM_BYTES,
	type VideoProxyCandidateGeneratorPort,
	type VideoProxyCandidateObserver,
} from '../common/editor/video-proxy-candidate-observation.ts';
import { createFfmpegVideoTimingProbe, type VideoTimingProbePort } from '../common/editor/video-timing-probe.ts';
import {
	resolveFramescaperNativeServicesBridge,
	type FramescaperNativeServicesBridge,
} from '../common/editor/ui/framescaper-native-services-bridge.ts';
import type { FramescaperCapturedVideoProxyRuntimeComposition } from './editor-captured-video-proxy-scheduler-composition.ts';
import type {
	FramescaperNativeProResProxyCandidateV28Options,
	FramescaperNativeProResProxyGeneratorV28Options,
} from './editor-native-prores-proxy-candidate-v28.ts';
import { FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE } from './editor-project-runtime-profile-v28.ts';
import { assertFramescaperProjectV31Profile } from './editor-project-runtime-profile-v31.ts';
import { framescaperProjectV28FoundationShapeV31 } from './editor-project-v31-foundation.ts';

const GENERATOR = Object.freeze({ id: 'framescaper-native-media-host', version: 1 });
const RECIPE = Object.freeze({ id: 'framescaper-native-prores-proxy-mov-v1', version: 1 });

export type DeferredFramescaperNativeProResProxyCandidateModuleV31 = Pick<
	typeof import('./editor-native-prores-proxy-candidate-v28.ts'),
	'createFramescaperNativeProResProxyGeneratorV28'
>;

export type DeferredFramescaperNativeProResProxyCandidateLoaderV31 = () => Promise<
	DeferredFramescaperNativeProResProxyCandidateModuleV31
>;

const DEFAULT_LOADER: DeferredFramescaperNativeProResProxyCandidateLoaderV31 = () => (
	import('./editor-native-prores-proxy-candidate-v28.ts')
);

export interface FramescaperNativeProResProxyCandidateV31Options
	extends Omit<FramescaperNativeProResProxyCandidateV28Options, 'profile'> {
	readonly profile: unknown;
}

/** Route native ProRes Proxy planning through the exact F31-to-V28 foundation. */
export function createFramescaperNativeProResProxyCandidateObserverV31(
	options: FramescaperNativeProResProxyCandidateV31Options,
	loadModule: DeferredFramescaperNativeProResProxyCandidateLoaderV31 = DEFAULT_LOADER,
): VideoProxyCandidateObserver | null {
	assertFramescaperProjectV31Profile(options.profile);
	if (!options || typeof options !== 'object' || typeof options.getProject !== 'function') {
		throw new TypeError('Selected V28 native proxy composition requires its project authority.');
	}
	const bridge = resolveFramescaperNativeServicesBridge(options.scope ?? globalThis);
	if (!proxyBridgeAvailable(bridge)) return null;
	const probes = timingProbes(options.composition);
	if (probes.length === 0) return null;
	const executionOptions: FramescaperNativeProResProxyGeneratorV28Options = Object.freeze({
		profile: FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE,
		getProject: () => framescaperProjectV28FoundationShapeV31(options.getProject()),
		bridge,
		...(options.waitForPoll ? { waitForPoll: options.waitForPoll } : {}),
	});
	const loadGenerator = retryableGeneratorLoader(executionOptions, loadModule);
	const generator: VideoProxyCandidateGeneratorPort = Object.freeze({
		...GENERATOR,
		generate: async (...args: Parameters<VideoProxyCandidateGeneratorPort['generate']>) => {
			const loaded = await loadGenerator();
			return Reflect.apply(loaded.generate, loaded, args) as PromiseLike<unknown> | unknown;
		},
	});
	return createVideoProxyCandidateObserver({
		generator, recipe: RECIPE, probes, maximumBytes: VIDEO_PROXY_CANDIDATE_MAXIMUM_BYTES,
	});
}

function retryableGeneratorLoader(
	options: FramescaperNativeProResProxyGeneratorV28Options,
	loadModule: DeferredFramescaperNativeProResProxyCandidateLoaderV31,
): () => Promise<VideoProxyCandidateGeneratorPort> {
	let generatorPromise: Promise<VideoProxyCandidateGeneratorPort> | null = null;
	return () => {
		if (generatorPromise) return generatorPromise;
		const attempt = Promise.resolve().then(loadModule).then((module) => (
			exactGenerator(module.createFramescaperNativeProResProxyGeneratorV28(options))
		));
		generatorPromise = attempt;
		void attempt.catch(() => {
			if (generatorPromise === attempt) generatorPromise = null;
		});
		return attempt;
	};
}

function exactGenerator(value: unknown): VideoProxyCandidateGeneratorPort {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| Reflect.ownKeys(value).length !== 3
		|| !Reflect.ownKeys(value).every((key) => (
			typeof key === 'string' && ['id', 'version', 'generate'].includes(key)
		))) {
		throw new TypeError('Deferred native proxy execution returned an invalid generator.');
	}
	const generator = value as VideoProxyCandidateGeneratorPort;
	if (generator.id !== GENERATOR.id || generator.version !== GENERATOR.version
		|| typeof generator.generate !== 'function') {
		throw new TypeError('Deferred native proxy execution returned an invalid generator.');
	}
	return generator;
}

function timingProbes(
	composition: FramescaperCapturedVideoProxyRuntimeComposition,
): readonly VideoTimingProbePort[] {
	const web = createFfmpegVideoTimingProbe(composition.runtime ?? {});
	return Object.freeze([composition.helperTimingProbe ?? null, web]
		.filter((probe): probe is VideoTimingProbePort => probe !== null));
}

function proxyBridgeAvailable(
	bridge: FramescaperNativeServicesBridge | null,
): bridge is FramescaperNativeServicesBridge {
	return Boolean(bridge && ['enqueue', 'selectRoot', 'revalidateRoot', 'claimProxyOutput',
		'readProxyOutput', 'releaseProxyOutput'].every((method) => (
		typeof bridge[method as keyof FramescaperNativeServicesBridge] === 'function'
	)));
}
