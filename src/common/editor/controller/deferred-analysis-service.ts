/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AnalysisDependencies } from './analysis-service.ts';

type AnalysisModule = typeof import('./analysis-service.ts');
type AnalysisService = ReturnType<AnalysisModule['createAudioAnalysisService']>;

/** Preserve the eager Analyze menu facade while loading report execution on demand. */
export function createDeferredAudioAnalysisService(dependencies: AnalysisDependencies) {
	let servicePromise: Promise<AnalysisService> | null = null;
	const loadService = () => {
		servicePromise ??= import('./analysis-service.ts')
			.then((module) => module.createAudioAnalysisService(dependencies));
		return servicePromise;
	};
	const invoke = async (
		name: Exclude<keyof AnalysisService, 'cancel'>,
		args: readonly unknown[],
	): Promise<unknown> => {
		const service = await loadService();
		return Reflect.apply(service[name], service, args);
	};
	return Object.freeze({
		run: (...args: Parameters<AnalysisService['run']>) => invoke('run', args),
		plotSpectrum: (...args: Parameters<AnalysisService['plotSpectrum']>) => invoke('plotSpectrum', args),
		findClipping: (...args: Parameters<AnalysisService['findClipping']>) => invoke('findClipping', args),
		captureContrast: (...args: Parameters<AnalysisService['captureContrast']>) => invoke('captureContrast', args),
		measureLoudness: (...args: Parameters<AnalysisService['measureLoudness']>) => invoke('measureLoudness', args),
		repeatLast: (...args: Parameters<AnalysisService['repeatLast']>) => invoke('repeatLast', args),
		cancel: () => dependencies.lifetime.cancelTask('analysis'),
	});
}
