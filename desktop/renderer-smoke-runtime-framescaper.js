/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	collectDesktopChromeArtifactWitness,
	collectSoundscaperArtifactWitness,
} from './desktop-chrome-renderer-smoke.js';
import { runDirectWavRendererSmoke } from './direct-wav-renderer-smoke.js';
import {
	runFramescaperBaselineArtifactRendererSmoke,
} from './framescaper-baseline-artifact-renderer-smoke.js';
import {
	runFramescaperCaptureArtifactRendererSmoke,
} from './framescaper-capture-artifact-renderer-smoke.js';
import {
	runFramescaperWebVcrDormantRendererSmoke,
	runFramescaperWebVcrPackagedRendererSmoke,
} from './framescaper-web-vcr-renderer-runner.js';
import {
	runDesktopProjectLibraryLeaseRendererSmoke,
} from './project-library-lease-renderer-smoke.js';
import { runScapeOpenRendererSmoke } from './scape-open-renderer-smoke.js';
import { runScapeReopenRendererSmoke } from './scape-reopen-renderer-smoke.js';
import {
	runDesktopRendererSmokeOperation,
	runDesktopRendererSmokeOperationEnvelope,
} from './renderer-smoke-runtime.js';
import {
	runDesktopVideoTimingProbeRendererSmoke,
} from './video-timing-probe-renderer-smoke.js';

const OPERATIONS = Object.freeze({
	'artifact-baseline': runFramescaperBaselineArtifactRendererSmoke,
	'artifact-capture': runFramescaperCaptureArtifactRendererSmoke,
	'artifact-chrome': collectDesktopChromeArtifactWitness,
	'artifact-soundscaper': collectSoundscaperArtifactWitness,
	'direct-wav': runDirectWavRendererSmoke,
	'project-library-lease': runDesktopProjectLibraryLeaseRendererSmoke,
	'scape-open': runScapeOpenRendererSmoke,
	'scape-reopen': runScapeReopenRendererSmoke,
	'video-timing': runDesktopVideoTimingProbeRendererSmoke,
	'web-vcr-dormant': runFramescaperWebVcrDormantRendererSmoke,
	'web-vcr-packaged': runFramescaperWebVcrPackagedRendererSmoke,
});

/** Execute only named, statically bundled renderer smoke code. */
export function runDesktopRendererSmoke(scope, request) {
	return runDesktopRendererSmokeOperation(scope, request, OPERATIONS);
}

/** Keep error normalization in inventoried renderer code, not the launcher. */
export function runDesktopRendererSmokeEnvelope(scope, request) {
	return runDesktopRendererSmokeOperationEnvelope(scope, request, OPERATIONS);
}
