/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createVideoProxyExistingCandidateObserverForRuntime,
} from '../common/editor/controller/video-proxy-candidate-composition.ts';
import {
	createFramescaperCapturedVideoProxySchedulerV20,
	createFramescaperCapturedVideoProxySchedulerV27,
	type FramescaperCapturedVideoProxyRuntimeComposition,
	type FramescaperCapturedVideoProxyScheduler,
} from './editor-captured-video-proxy-scheduler.ts';
import type { FramescaperEditorProjectEnvironmentV20 } from './editor-project-environment-v20.ts';
import type { FramescaperEditorProjectEnvironmentV27 } from './editor-project-environment-v27.ts';

type SessionV20 = Parameters<typeof createFramescaperCapturedVideoProxySchedulerV20>[1];
type SessionV27 = Parameters<typeof createFramescaperCapturedVideoProxySchedulerV27>[1];

/** Compose a one-operation, pathless existing-candidate scheduler for selected V20. */
export function createFramescaperExistingVideoProxySchedulerV20(
	environment: Readonly<FramescaperEditorProjectEnvironmentV20>,
	session: SessionV20,
	composition: FramescaperCapturedVideoProxyRuntimeComposition,
	candidate: Blob,
): FramescaperCapturedVideoProxyScheduler {
	return createFramescaperCapturedVideoProxySchedulerV20(
		environment,
		session,
		existingCandidateComposition(composition, candidate),
	);
}

/** Compose a one-operation, pathless existing-candidate scheduler for selected V27. */
export function createFramescaperExistingVideoProxySchedulerV27(
	environment: Readonly<FramescaperEditorProjectEnvironmentV27>,
	session: SessionV27,
	composition: FramescaperCapturedVideoProxyRuntimeComposition,
	candidate: Blob,
): FramescaperCapturedVideoProxyScheduler {
	return createFramescaperCapturedVideoProxySchedulerV27(
		environment,
		session,
		existingCandidateComposition(composition, candidate),
	);
}

function existingCandidateComposition(
	composition: FramescaperCapturedVideoProxyRuntimeComposition,
	candidate: Blob,
): FramescaperCapturedVideoProxyRuntimeComposition {
	if (!composition || typeof composition !== 'object') {
		throw new TypeError('Existing proxy attachment requires its runtime composition.');
	}
	const observer = createVideoProxyExistingCandidateObserverForRuntime(
		candidate,
		composition.runtime,
		composition,
	);
	if (!observer) {
		throw new Error('This runtime cannot validate an existing video proxy.');
	}
	return Object.freeze({ ...composition, candidateObserver: observer });
}
