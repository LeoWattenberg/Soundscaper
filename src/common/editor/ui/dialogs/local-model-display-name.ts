/* SPDX-License-Identifier: AGPL-3.0-only */

import { LOCAL_MODEL_NAMES_COPY } from '../../../i18n/editor-local-model-names-copy.ts';
import { resolveEditorCopyScope } from '../../../i18n/editor-copy-scope.ts';

export function localModelDisplayName(modelId: string, copy: Readonly<Record<string, string | undefined>> = {}): string {
	return resolveEditorCopyScope('localModelNames', LOCAL_MODEL_NAMES_COPY, copy)[modelId]
		?? modelId.replaceAll('-', ' ').replace(/^./u, (first) => first.toUpperCase());
}
