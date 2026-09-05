/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AnalysisDependencies } from './analysis-service.ts';
import { createDeferredModuleFacade } from './deferred-module-facade.ts';

type AnalysisModule = typeof import('./analysis-service.ts');
type AnalysisService = ReturnType<AnalysisModule['createAudioAnalysisService']>;

const DEFERRED_ANALYSIS_METHOD_NAMES = [
	'run',
	'plotSpectrum',
	'findClipping',
	'captureContrast',
	'measureLoudness',
	'repeatLast',
] as const satisfies readonly (keyof AnalysisService)[];

/**
 * Preserve the eager Analyze menu facade while loading report execution on demand.
 *
 * `cancel` stays eager: cancelling an analysis is a lifetime operation the
 * controller already owns, and loading the report implementation in order to
 * stop one would be backwards.
 */
export function createDeferredAudioAnalysisService(dependencies: AnalysisDependencies) {
	return createDeferredModuleFacade(
		async (): Promise<AnalysisService> => (
			(await import('./analysis-service.ts')).createAudioAnalysisService(dependencies)
		),
		DEFERRED_ANALYSIS_METHOD_NAMES,
		{
			eager: {
				cancel: (
					() => dependencies.lifetime.cancelTask('analysis')
				) satisfies AnalysisService['cancel'],
			},
		},
	);
}
