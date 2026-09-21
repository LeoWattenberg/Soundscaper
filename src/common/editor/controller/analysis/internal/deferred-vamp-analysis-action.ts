/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	createDesktopVampAnalysisAction,
	DesktopVampAnalysisAction,
} from './vamp-analysis-action.ts';

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
	let actionPromise: Promise<Readonly<DesktopVampAnalysisAction>> | null = null;
	const load = (): Promise<Readonly<DesktopVampAnalysisAction>> => {
		actionPromise ??= import('./vamp-analysis-action.ts').then(({ createDesktopVampAnalysisAction }) => {
			const action = createDesktopVampAnalysisAction(options);
			if (action === null) throw new Error('The native Vamp analyzer bridge became unavailable.');
			return action;
		});
		return actionPromise;
	};
	const deferred: DesktopVampAnalysisAction = {
		list: async () => (await load()).list(),
		analyze: async (input, signal) => (await load()).analyze(input, signal),
	};
	return Object.freeze(deferred);
}

function hasVampBridge(value: unknown): boolean {
	if (value === null || typeof value !== 'object') return false;
	const candidate = value as Record<string, unknown>;
	return BRIDGE_METHODS.every((method) => typeof candidate[method] === 'function');
}
