/* SPDX-License-Identifier: AGPL-3.0-only */
import { publishLocalizedStatus, setLocalizedStatus, type LocalizedPresentationMessage } from '../../../../i18n/presentation-message.ts';

export interface LocalizedImportNotice {
	readonly text: string;
	readonly localization?: LocalizedPresentationMessage;
}

export function publishImportCompletionStatus(
	setStatus: (text: string, state: string, localization?: LocalizedPresentationMessage) => void,
	copy: object,
	notices: readonly LocalizedImportNotice[],
): void {
	const first = notices[0];
	if (!first) { setLocalizedStatus(setStatus, copy, 'done', undefined, 'success'); return; }
	publishLocalizedStatus(setStatus, notices.map((notice) => notice.text).join(' '), importNoticeLocalization(notices), 'success');
}

export function importNoticeLocalization(notices: readonly LocalizedImportNotice[]): LocalizedPresentationMessage {
	const first = notices[0];
	return {
		key: 'ui.importStatus.notice', fallback: '{notice}', parameters: { notice: first.localization ?? first.text },
		append: notices.slice(1).flatMap((notice) => [' ', notice.localization ?? notice.text]),
	};
}
