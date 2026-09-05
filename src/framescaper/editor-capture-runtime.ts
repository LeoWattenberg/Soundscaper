/* SPDX-License-Identifier: AGPL-3.0-only */

import { createFramescaperCaptureAdminInterlock } from
	'../common/editor/controller/framescaper-capture-admin-interlock.ts';
import type {
	FramescaperCaptureDerivativeScheduler,
	FramescaperCaptureDerivativeSchedulerOptions,
} from '../common/editor/controller/framescaper-capture-derivative-scheduler.ts';
import { createFramescaperCaptureProjectWriteAuthority } from
	'../common/editor/controller/framescaper-capture-project-write-authority.ts';
import {
	createFramescaperCaptureProxyActiveProjectSynchronizer,
	createFramescaperCaptureProxySaveQuiescence,
} from '../common/editor/controller/framescaper-capture-proxy-quiescence.ts';
import {
	createDeferredFramescaperCaptureAppBinding,
	type FramescaperCaptureImplementationLoader,
} from './editor-capture-deferred-binding.ts';

const DEFAULT_LOADER: FramescaperCaptureImplementationLoader = () => import('./editor-capture-runtime-implementation.ts')
	.then((module) => module.FRAMESCAPER_EDITOR_CAPTURE_IMPLEMENTATION);

/**
 * Framescaper is the sole owner of capture implementation and its callable ports.
 *
 * The editor composes this record synchronously while it constructs, so the
 * ports it needs at that moment — the admin interlock, the project write
 * authority and the two proxy ports — are the real implementations. The capture
 * stack itself sits behind `editor-capture-runtime-implementation.ts` and is
 * imported when the deferred binding first needs it, so a Framescaper boot that
 * never captures never downloads it.
 */
export function createDeferredFramescaperCaptureRuntime(load: FramescaperCaptureImplementationLoader = DEFAULT_LOADER) {
	let implementation: ReturnType<FramescaperCaptureImplementationLoader> | null = null;
	const loadOnce: FramescaperCaptureImplementationLoader = () => {
		implementation ??= Promise.resolve().then(load);
		return implementation;
	};
	return Object.freeze({
		createAdminInterlock: createFramescaperCaptureAdminInterlock,
		createAppBinding: (
			options: Parameters<typeof createDeferredFramescaperCaptureAppBinding>[0],
		) => createDeferredFramescaperCaptureAppBinding(options, loadOnce),
		createDerivativeScheduler: (
			options: FramescaperCaptureDerivativeSchedulerOptions,
		): FramescaperCaptureDerivativeScheduler => {
			let scheduler: Promise<FramescaperCaptureDerivativeScheduler> | null = null;
			return async (request) => {
				scheduler ??= loadOnce().then((loaded) => loaded.createDerivativeScheduler(options));
				await (await scheduler)(request);
			};
		},
		createProxyActiveProjectSynchronizer: createFramescaperCaptureProxyActiveProjectSynchronizer,
		createProxySaveQuiescence: createFramescaperCaptureProxySaveQuiescence,
		createProjectWriteAuthority: createFramescaperCaptureProjectWriteAuthority,
	});
}

export const FRAMESCAPER_EDITOR_CAPTURE_RUNTIME = createDeferredFramescaperCaptureRuntime();
