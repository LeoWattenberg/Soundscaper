/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createVideoProxyExistingCandidateObserverForRuntime,
} from '../common/editor/controller/video-proxy-candidate-composition.ts';
import {
	createFramescaperCapturedVideoProxyScheduler as createScheduler,
	type FramescaperCapturedVideoProxyRuntimeComposition,
	type FramescaperCapturedVideoProxyScheduler,
} from './editor-captured-video-proxy-scheduler.ts';
import { capturedVideoProxySchedulerDependencies } from
	'./editor-captured-video-proxy-scheduler-composition.ts';
import type { FramescaperEditorProjectEnvironment } from './editor-project-environment.ts';

type Session = Parameters<typeof capturedVideoProxySchedulerDependencies>[1];

export function createFramescaperCapturedVideoProxyScheduler(
	environment: Readonly<FramescaperEditorProjectEnvironment>,
	session: Session,
	composition: FramescaperCapturedVideoProxyRuntimeComposition,
): FramescaperCapturedVideoProxyScheduler {
	return createScheduler(capturedVideoProxySchedulerDependencies(environment, session, composition));
}

export function createFramescaperExistingVideoProxyScheduler(
	environment: Readonly<FramescaperEditorProjectEnvironment>,
	session: Session,
	composition: FramescaperCapturedVideoProxyRuntimeComposition,
	candidate: Blob,
): FramescaperCapturedVideoProxyScheduler {
	if (!composition || typeof composition !== 'object') {
		throw new TypeError('Existing Framescaper proxy attachment requires its runtime composition.');
	}
	const observer = createVideoProxyExistingCandidateObserverForRuntime(
		candidate,
		composition.runtime,
		composition,
	);
	if (!observer) throw new Error('This runtime cannot validate an existing Framescaper video proxy.');
	return createFramescaperCapturedVideoProxyScheduler(
		environment,
		session,
		Object.freeze({ ...composition, candidateObserver: observer }),
	);
}
