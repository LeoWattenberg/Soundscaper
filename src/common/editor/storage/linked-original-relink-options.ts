/* SPDX-License-Identifier: AGPL-3.0-only */

export interface RelinkLinkedOriginalOptions {
	readonly expectedBindingToken: string;
	readonly expectedLocatorRevision: string;
	readonly expectedSnapshot: unknown;
	readonly assertCanPublish?: () => void;
	readonly signal?: AbortSignal;
}

export interface RelinkLinkedAudioOriginalOptions extends RelinkLinkedOriginalOptions {
	/** Exact-content relink is the default; changed content requires explicit admission. */
	readonly admission?: 'exact-content' | 'changed-content';
}

export interface RelinkLinkedVideoOriginalOptions extends RelinkLinkedOriginalOptions {
	/** Exact-content relink is the default; changed content requires explicit admission. */
	readonly admission?: 'exact-content' | 'changed-content';
}
