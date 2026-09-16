/* SPDX-License-Identifier: AGPL-3.0-only */

import { setLocalizedStatus, type LocalizedPresentationMessage } from '../../../i18n/presentation-message.ts';
import { publishedCopyFor } from '../shared/presentation-localization.ts';

/** Application copy retains an identity; imported diagnostic wording remains literal. */
export function publishProjectReadOnlyStatus(
	copy: Readonly<{ projectReadOnly: string; futureProjectReadOnly?: string }>,
	publish: (message: string, state: 'error', localization?: LocalizedPresentationMessage) => void,
	reason?: string | null,
): void {
	const published = publishedCopyFor(copy);
	if (!reason || reason === copy.projectReadOnly || reason === published.projectReadOnly) {
		setLocalizedStatus(publish, copy, 'projectReadOnly', undefined, 'error');
	} else if (reason === copy.futureProjectReadOnly || reason === published.futureProjectReadOnly) {
		setLocalizedStatus(publish, copy, 'futureProjectReadOnly', undefined, 'error');
	} else publish(reason, 'error');
}
