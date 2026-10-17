/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoLibraryPageV1, PhotoLibraryQueryV1 } from './photo-library-session-port-v1.ts';
import type { PhotoLibraryQueryV2 } from './photo-library-query-port-v2.ts';

/** Ephemeral current destination selection; contains no cursor, body or write authority. */
export type PhotoLibraryCullingNavigationContextV1 =
	| Readonly<{ kind: 'plain' }>
	| Readonly<{ kind: 'query'; query: PhotoLibraryQueryV1 | PhotoLibraryQueryV2; collapsed: boolean }>
	| Readonly<{ kind: 'saved'; collectionId: string; collapsed: boolean }>;
export interface PhotoLibraryCullingNavigationRequestV1 {
	readonly photoId: string;
	readonly signal?: AbortSignal;
}
export interface PhotoLibraryCullingNavigationPortV1 {
	readDestinationPage(context: PhotoLibraryCullingNavigationContextV1, request: PhotoLibraryCullingNavigationRequestV1): Promise<Readonly<PhotoLibraryPageV1> | null>;
}
