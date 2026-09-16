/* SPDX-License-Identifier: AGPL-3.0-only */

import { SOUNDSCAPER_ROUTING_GRAPH_COPY } from '../../../i18n/editor-soundscaper-routing-graph-copy.ts';
export { SOUNDSCAPER_ROUTING_GRAPH_COPY } from '../../../i18n/editor-soundscaper-routing-graph-copy.ts';
import { resolveEditorCopyScope } from '../../../i18n/editor-copy-scope.ts';



export type SoundscaperRoutingGraphCopy = Readonly<{
	[Key in keyof typeof SOUNDSCAPER_ROUTING_GRAPH_COPY]: string;
}>;

export function resolveSoundscaperRoutingGraphCopy(
	copy: Readonly<Record<string, string | undefined>> = {},
): SoundscaperRoutingGraphCopy {
	return resolveEditorCopyScope('routing', SOUNDSCAPER_ROUTING_GRAPH_COPY, copy);
}
