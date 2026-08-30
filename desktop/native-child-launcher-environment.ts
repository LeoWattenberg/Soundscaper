/* SPDX-License-Identifier: AGPL-3.0-only */

/** Closed launcher environment plus the Windows paths AppContainer creation requires. */

import type { NativeChildIsolationTarget } from './native-child-isolation-contract.ts';

const BASE_ENVIRONMENT = Object.freeze({
	LANG: 'C',
	LC_ALL: 'C',
	PATH: '',
	HOME: '/nonexistent',
});
const WINDOWS_SUBSTRATE = Object.freeze(['SystemRoot', 'SystemDrive', 'LOCALAPPDATA'] as const);

export function nativeChildLauncherEnvironment(
	target: NativeChildIsolationTarget,
	source: Readonly<NodeJS.ProcessEnv> = process.env,
): Readonly<Record<string, string>> {
	if (!target.startsWith('win-')) return BASE_ENVIRONMENT;
	const result: Record<string, string> = { ...BASE_ENVIRONMENT };
	for (const name of WINDOWS_SUBSTRATE) result[name] = requiredWindowsValue(source, name);
	return Object.freeze(result);
}

function requiredWindowsValue(source: Readonly<NodeJS.ProcessEnv>, name: string): string {
	let result: string | undefined;
	for (const [candidate, value] of Object.entries(source)) {
		if (candidate.toLowerCase() !== name.toLowerCase()) continue;
		if (typeof value !== 'string' || value.length === 0 || (result !== undefined && result !== value)) {
			throw new Error('The Windows native child substrate environment is incomplete.');
		}
		result = value;
	}
	if (result === undefined) throw new Error('The Windows native child substrate environment is incomplete.');
	return result;
}
