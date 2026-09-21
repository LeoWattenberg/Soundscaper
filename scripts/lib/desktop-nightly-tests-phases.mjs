/* SPDX-License-Identifier: AGPL-3.0-only */

import { runDesktopNightlyTestsMetricsPhase } from './desktop-nightly-tests-metrics.mjs';
import { runDesktopNightlyTestsPackagedCoveragePhase } from './desktop-nightly-tests-packaged-coverage.mjs';
import { runDesktopNightlyTestsPackagedMetricsPhase } from './desktop-nightly-tests-packaged-runtime.mjs';
import { runDesktopNightlyTestsLocalAssistancePhase } from './desktop-nightly-tests-local-assistance.mjs';
import {
	DUAL_ORIGIN_ARTIFACT_PATHS,
	runDesktopNightlyTestsDualOriginPhase,
} from './desktop-nightly-tests-dual-origin.mjs';

export { DUAL_ORIGIN_ARTIFACT_PATHS };

// Collect independent diagnostics even after a failed assertion, but never
// launch another expensive phase after interruption or an infrastructure error.
export async function* runDesktopNightlyTestsDiagnosticPhases(options, dependencies) {
	const phases = [
		[dependencies.runDualOriginPhase ?? runDesktopNightlyTestsDualOriginPhase, undefined, 'Dual-origin browser coverage'],
		[runDesktopNightlyTestsMetricsPhase, dependencies.writeMetricsDiagnostics, 'Performance diagnostics'],
		[runDesktopNightlyTestsPackagedMetricsPhase, dependencies.writePackagedMetricsDiagnostics, 'Packaged app diagnostics'],
		[runDesktopNightlyTestsPackagedCoveragePhase, undefined, 'Packaged app coverage'],
		[runDesktopNightlyTestsLocalAssistancePhase, undefined, 'Local model tests'],
	];
	for (const [index, [runPhase, writeDiagnostics, label]] of phases.entries()) {
		options.onProgress?.(Object.freeze({ completed: index + 1, total: 6, label }));
		const result = await runPhase(options, {
			runPlaywright: dependencies.runPlaywright,
			startPagesSiteServer: dependencies.startPagesSiteServer,
			writeDiagnostics,
			preserveEvidence: dependencies.preserveCoverageEvidence,
		});
		yield result;
		if (result.child.signal || ![0, 1].includes(result.child.code)) return;
	}
}
