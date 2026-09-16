/* SPDX-License-Identifier: AGPL-3.0-only */

import { formatPresentationMessage, localizedErrorMessage } from '../../../i18n/presentation-message.ts';
import { errorDiagnosticMessage } from '../../error-diagnostic-message.ts';

/** Retain the error itself so current copy can format it again during a local preview. */
export function workspaceErrorMessage(error: unknown, copy: Readonly<{ genericError: string; unknownError: string }>): string {
	if (error === null) return '';
	const diagnostic = errorDiagnosticMessage(error, '');
	const message = localizedErrorMessage(error) ?? (diagnostic || { key: 'unknownError' });
	return formatPresentationMessage(copy, { key: 'genericError', parameters: { message } });
}
