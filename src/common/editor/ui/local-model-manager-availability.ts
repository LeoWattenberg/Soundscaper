/* SPDX-License-Identifier: AGPL-3.0-only */

import type { LocalModelManagerBridge } from './local-model-manager-bridge.ts';

/** Keep desktop capability admission independent of the deferred model response validators. */
const REQUIRED_METHODS = Object.freeze([
	'listAssistanceModels', 'installAssistanceModel', 'cancelAssistanceModelInstall',
	'installPreseededAssistanceModel', 'reconcileAssistanceModels',
	'collectAssistanceModelGarbage', 'listAssistanceModelNotices',
	'relocateAssistanceModels', 'removeAssistanceModel',
	'onAssistanceInstallProgress',
] as const);

export function resolveLocalModelManagerBridge(value: unknown): LocalModelManagerBridge | null {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
	if (REQUIRED_METHODS.some((method) => typeof (value as Record<string, unknown>)[method] !== 'function')) return null;
	return value as unknown as LocalModelManagerBridge;
}

