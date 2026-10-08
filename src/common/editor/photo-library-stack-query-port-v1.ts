/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoLibraryQueryV1, PhotoLibraryQueryStepV1 } from './photo-library-session-port-v1.ts';

/** Opt-in global collapsing; empty nonterminal steps retain bounded member-probe progress. */
export interface PhotoLibraryStackQueryPortV1 {
	readStackQueryStep(options: Readonly<{ query: PhotoLibraryQueryV1; cursor?: string | null; signal?: AbortSignal }>): Promise<PhotoLibraryQueryStepV1>;
}
