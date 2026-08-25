/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createVideoProxyExistingCandidateObserverForRuntime,
} from '../common/editor/controller/video-proxy-candidate-composition.ts';
import {
	createFramescaperCapturedVideoProxyScheduler,
	type FramescaperCapturedVideoProxyRuntimeComposition,
	type FramescaperCapturedVideoProxyScheduler,
} from './editor-captured-video-proxy-scheduler.ts';
import { capturedVideoProxySchedulerDependenciesV31 } from './editor-captured-video-proxy-scheduler-composition.ts';
import type { FramescaperEditorProjectEnvironmentV31 } from './editor-project-environment-v31.ts';

type SessionV31 = Parameters<typeof capturedVideoProxySchedulerDependenciesV31>[1];

export function createFramescaperCapturedVideoProxySchedulerV31(
	environment: Readonly<FramescaperEditorProjectEnvironmentV31>,
	session: SessionV31,
	composition: FramescaperCapturedVideoProxyRuntimeComposition,
): FramescaperCapturedVideoProxyScheduler {
	return createFramescaperCapturedVideoProxyScheduler(
		capturedVideoProxySchedulerDependenciesV31(environment, session, composition),
	);
}
export function createFramescaperExistingVideoProxySchedulerV31(
	environment: Readonly<FramescaperEditorProjectEnvironmentV31>,
	session: SessionV31,
	composition: FramescaperCapturedVideoProxyRuntimeComposition,
	candidate: Blob,
): FramescaperCapturedVideoProxyScheduler {
	if (!composition || typeof composition !== 'object') {
		throw new TypeError('Existing F31 proxy attachment requires its runtime composition.');
	}
	const observer = createVideoProxyExistingCandidateObserverForRuntime(
		candidate, composition.runtime, composition,
	);
	if (!observer) throw new Error('This runtime cannot validate an existing F31 video proxy.');
	return createFramescaperCapturedVideoProxySchedulerV31(
		environment, session, Object.freeze({ ...composition, candidateObserver: observer }),
	);
}
