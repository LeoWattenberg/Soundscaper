/* SPDX-License-Identifier: AGPL-3.0-only */

import { useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { formatPresentationMessage, localizedErrorMessage, type LocalizedPresentationMessage } from '../../i18n/presentation-message.ts';
import { resolveEditorCopyScope } from '../../i18n/editor-copy-scope.ts';
import { errorDiagnosticMessage } from '../error-diagnostic-message.ts';

export type PresentationFeedback = string | LocalizedPresentationMessage | Readonly<{ failure: unknown }>;
const EMPTY_COPY: Readonly<Record<string, string>> = Object.freeze({});

export function feedbackFailure(failure: unknown): PresentationFeedback { return { failure }; }

export function feedbackErrorParameter(failure: unknown): string | LocalizedPresentationMessage {
	const diagnostic = errorDiagnosticMessage(failure, '');
	const identity = localizedErrorMessage(failure);
	return identity ? { ...identity, fallback: diagnostic } : diagnostic || { key: 'unknownError' };
}

export function presentationFeedbackText(value: PresentationFeedback, copy: object): string {
	if (typeof value === 'string') return value;
	if ('failure' in value) {
		const identity = localizedErrorMessage(value.failure);
		return identity ? formatPresentationMessage(copy, { ...identity, fallback: errorDiagnosticMessage(value.failure, '') }) : errorDiagnosticMessage(value.failure,
			formatPresentationMessage(copy, { key: 'unknownError', fallback: '' }));
	}
	return formatPresentationMessage(copy, value);
}

/** Store identities and raw failures; format the public string on every copy revision. */
export function usePresentationFeedback(
	copy: object, defaults = EMPTY_COPY, owner?: string, initialValue: PresentationFeedback = '',
): readonly [string, Dispatch<SetStateAction<PresentationFeedback>>] {
	const [value, setValue] = useState<PresentationFeedback>(initialValue);
	const effective = useMemo(() => owner
		? { ...copy, ...resolveEditorCopyScope(owner, defaults, copy as Readonly<Record<string, unknown>>) }
		: { ...defaults, ...copy }, [copy, defaults, owner]);
	return [presentationFeedbackText(value, effective), setValue];
}
