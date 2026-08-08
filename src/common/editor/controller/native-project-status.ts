/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	Aup4CompatibilityIssue,
	NativeProgress,
	NativeProjectServiceRuntime,
} from './native-project-types.ts';

export function nativeProjectProgressMessage(progress: NativeProgress, prefix: string): string {
	const percentage = Math.round(Math.max(0, Math.min(1, Number(progress?.value) || 0)) * 100);
	return `${prefix} ${percentage}%`;
}

export function publishAup4OpenStatus(
	runtime: Pick<NativeProjectServiceRuntime, 'copy' | 'setStatus'>,
	readOnly: boolean,
	readOnlyIssue: Aup4CompatibilityIssue | undefined,
	warnings: readonly string[],
): void {
	if (readOnly) {
		runtime.setStatus(
			readOnlyIssue?.code === 'EDITABLE_LIMIT_EXCEEDED'
				? runtime.copy.oversizedAup4ReadOnly
				: readOnlyIssue?.message || runtime.copy.newerAup4ReadOnly,
			'error',
		);
		return;
	}
	const warning = warnings.length ? ` ${warnings.join(' ')}` : '';
	runtime.setStatus(`${runtime.copy.aup4Opened}${warning}`, warnings.length ? 'info' : 'success');
}
