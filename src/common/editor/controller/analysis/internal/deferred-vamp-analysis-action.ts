/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	createDesktopVampAnalysisAction,
	DesktopVampAnalysisAction,
} from './vamp-analysis-action.ts';
import { createDeferredModuleFacade } from '../../shared/deferred-module-facade.ts';

const BRIDGE_METHODS = Object.freeze([
	'listNativeVampAnalyzers', 'startNativeVampAnalyzer', 'configureNativeVampAnalyzer',
	'pushNativeVampAnalyzerPcm', 'finishNativeVampAnalyzer', 'cancelNativeVampAnalyzer',
] as const);

type DesktopVampAnalysisOptions = Parameters<typeof createDesktopVampAnalysisAction>[0];

/** Keep the native analyzer implementation outside the renderer startup graph. */
export function createDeferredDesktopVampAnalysisAction(
	options: Readonly<DesktopVampAnalysisOptions>,
): Readonly<DesktopVampAnalysisAction> | null {
	if (!hasVampBridge(options.bridge)) return null;
	return createDeferredModuleFacade<DesktopVampAnalysisAction, readonly ['list', 'analyze']>(
		async () => import('./vamp-analysis-action.ts').then(({ createDesktopVampAnalysisAction }) => {
			const action = createDesktopVampAnalysisAction(options);
			if (action === null) throw new Error('The native Vamp analyzer bridge became unavailable.');
			return action;
		}),
		['list', 'analyze'],
	);
}

function hasVampBridge(value: unknown): boolean {
	if (value === null || typeof value !== 'object') return false;
	const candidate = value as Record<string, unknown>;
	return BRIDGE_METHODS.every((method) => typeof candidate[method] === 'function');
}
