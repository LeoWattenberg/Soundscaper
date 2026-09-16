/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	Aup4CompatibilityIssue,
	NativeProgress,
	NativeProjectServiceRuntime,
} from '../../native-project-types.ts';
import { setLocalizedStatus, type LocalizedPresentationMessage } from '../../../../../i18n/presentation-message.ts';
import { percentagePresentationMessage } from '../../../../../i18n/presentation-progress.ts';

export function nativeProjectProgressMessage(progress: NativeProgress, prefix: string): string {
	const percentage = Math.round(Math.max(0, Math.min(1, Number(progress?.value) || 0)) * 100);
	return `${prefix} ${percentage}%`;
}

export function nativeProjectProgressLocalization(progress: NativeProgress, operation: string | LocalizedPresentationMessage): LocalizedPresentationMessage {
	return percentagePresentationMessage(progress?.value, operation);
}

export function publishAup4OpenStatus(
	runtime: Pick<NativeProjectServiceRuntime, 'copy' | 'setStatus'>,
	readOnly: boolean,
	readOnlyIssue: Aup4CompatibilityIssue | undefined,
	warnings: readonly string[],
): void {
	if (readOnly) {
		if (readOnlyIssue?.code === 'EDITABLE_LIMIT_EXCEEDED') setLocalizedStatus(runtime.setStatus, runtime.copy, 'oversizedAup4ReadOnly', undefined, 'error');
		else if (readOnlyIssue?.message) setLocalizedStatus(runtime.setStatus, runtime.copy, 'ui.importStatus.notice', { notice: readOnlyIssue.message }, 'error', { fallback: '{notice}' });
		else setLocalizedStatus(runtime.setStatus, runtime.copy, 'newerAup4ReadOnly', undefined, 'error');
		return;
	}
	const warning = warnings.length ? ` ${warnings.join(' ')}` : '';
	setLocalizedStatus(runtime.setStatus, runtime.copy, 'aup4Opened', undefined, warnings.length ? 'info' : 'success', { suffix: warning });
}
