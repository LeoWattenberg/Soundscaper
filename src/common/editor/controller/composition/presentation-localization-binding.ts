/* SPDX-License-Identifier: AGPL-3.0-only */

import type { createPresentationLocalization } from '../shared/presentation-localization.ts';
import { selectPresentationCopy } from '../shared/presentation-localization.ts';
import type { createControllerPresentationState } from './presentation-state.ts';
import type { createEditorTaskProgressCoordinator } from '../shared/task-progress.ts';

export function bindPresentationLocalization(
	localization: ReturnType<typeof createPresentationLocalization>,
	presentation: ReturnType<typeof createControllerPresentationState>,
	tasks: ReturnType<typeof createEditorTaskProgressCoordinator>,
	publishDocument: () => void,
) {
	const unsubscribe = localization.port.subscribe(() => {
		presentation.refreshLocalization(localization.formatMessage);
		tasks.refreshLocalization();
		publishDocument();
	});
	return () => { localization.port.resetPreview(); unsubscribe(); localization.dispose(); };
}

export function storagePresentationCopy(copy: Readonly<Record<string, string>>, formatBytes: (value: number) => string) {
	const messages = selectPresentationCopy(copy, [
		'storageOperationRecording', 'storageOperationExport', 'storageOperationEffect',
		'storageOperationProject', 'storageOperationImport', 'insufficientStorage',
	]);
	const scoped = Object.create(messages) as typeof messages & { readonly formatBytes: typeof formatBytes };
	return Object.freeze(Object.defineProperty(scoped, 'formatBytes', { value: formatBytes, enumerable: true }));
}
