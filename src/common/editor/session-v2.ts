/* SPDX-License-Identifier: AGPL-3.0-only */

import { createAudioEditorSessionControllerCore } from './session-controller-core.js';
import { createAudioEditorSessionClipboardV2, normalizeAudioEditorSessionClipboardV1OrV2,
	collectSessionClipboardStorageKeysV2, type CurrentAudioEditorSessionClipboard } from './session-clipboard-codec-v2.ts';
import { collectAudioEditorClipboardSourceIdsV7 } from './commands/clipboard-codec-v7.ts';
import { collectAudioEditorClipboardSourceIds, createAudioEditorSessionClipboard } from './session-clipboard-codec.ts';

const CURRENT_CLIPBOARD = Object.freeze({ schemaVersion: 2,
	normalizeClipboard: normalizeAudioEditorSessionClipboardV1OrV2,
	createClipboard: (project: unknown, options: object) => {
		const descriptor = Object.getOwnPropertyDescriptor(options, 'descriptor');
		const value: unknown = descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
		const schema = value && typeof value === 'object' ? Object.getOwnPropertyDescriptor(value, 'schemaVersion') : undefined;
		return schema && Object.hasOwn(schema, 'value') && schema.value === 7
			? createAudioEditorSessionClipboardV2(project, options as Readonly<{ descriptor: unknown }>)
			: createAudioEditorSessionClipboard(project, options);
	},
	collectSources: (clipboard: CurrentAudioEditorSessionClipboard | null) => !clipboard ? [] : clipboard.schemaVersion === 2
		? collectAudioEditorClipboardSourceIdsV7(clipboard.descriptor) : collectAudioEditorClipboardSourceIds(clipboard.descriptor),
	storageKeys: (clipboard: CurrentAudioEditorSessionClipboard | null) => clipboard?.schemaVersion === 2 ? collectSessionClipboardStorageKeysV2(clipboard) : [],
	acceptsSnapshot: (version: unknown) => version === 1 || version === 2,
});

/** Explicit current session2. Legacy snapshots can be imported through this
 * named owner; serialization always identifies its selected current protocol. */
export function createAudioEditorSessionControllerV2(options: Parameters<typeof createAudioEditorSessionControllerCore>[0] = {}) {
	return createAudioEditorSessionControllerCore(options, CURRENT_CLIPBOARD);
}
