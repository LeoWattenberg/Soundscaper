/* SPDX-License-Identifier: AGPL-3.0-only */

import { runDesktopNightlyTestsMetricsPhase } from './desktop-nightly-tests-metrics.mjs';
import { runDesktopNightlyTestsPackagedMetricsPhase } from './desktop-nightly-tests-packaged-runtime.mjs';
import { runDesktopNightlyTestsLocalAssistancePhase } from './desktop-nightly-tests-local-assistance.mjs';

// Collect independent diagnostics even after a failed assertion, but never
// launch another expensive phase after interruption or an infrastructure error.
export async function* runDesktopNightlyTestsDiagnosticPhases(options, dependencies) {
	for (const [runPhase, writeDiagnostics] of [
		[runDesktopNightlyTestsMetricsPhase, dependencies.writeMetricsDiagnostics],
		[runDesktopNightlyTestsPackagedMetricsPhase, dependencies.writePackagedMetricsDiagnostics],
		[runDesktopNightlyTestsLocalAssistancePhase, undefined],
	]) {
		const result = await runPhase(options, { runPlaywright: dependencies.runPlaywright, writeDiagnostics });
		yield result;
		if (result.child.signal || ![0, 1].includes(result.child.code)) return;
	}
}
