/* SPDX-License-Identifier: AGPL-3.0-only */

import { createFramescaperCaptureAppBinding } from
	'../common/editor/controller/framescaper-capture-app-binding.ts';
import { createFramescaperCaptureAdminInterlock } from
	'../common/editor/controller/framescaper-capture-admin-interlock.ts';
import { createFramescaperCaptureDerivativeScheduler } from
	'../common/editor/controller/framescaper-capture-derivative-scheduler.ts';
import {
	createFramescaperCaptureProxyActiveProjectSynchronizer,
	createFramescaperCaptureProxySaveQuiescence,
} from '../common/editor/controller/framescaper-capture-proxy-quiescence.ts';
import { createFramescaperCaptureProjectWriteAuthority } from
	'../common/editor/controller/framescaper-capture-project-write-authority.ts';

/** Framescaper is the sole owner of capture implementation and its callable ports. */
export const FRAMESCAPER_EDITOR_CAPTURE_RUNTIME = Object.freeze({
	createAdminInterlock: createFramescaperCaptureAdminInterlock,
	createAppBinding: createFramescaperCaptureAppBinding,
	createDerivativeScheduler: createFramescaperCaptureDerivativeScheduler,
	createProxyActiveProjectSynchronizer: createFramescaperCaptureProxyActiveProjectSynchronizer,
	createProxySaveQuiescence: createFramescaperCaptureProxySaveQuiescence,
	createProjectWriteAuthority: createFramescaperCaptureProjectWriteAuthority,
});
