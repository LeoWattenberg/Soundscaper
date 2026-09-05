/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Which of a live render stage's two inputs a carrier chunk belongs to.
 *
 * The renderer's bridge projection and the desktop main process both name this
 * role - it is half the identity of every live-render carrier record - so it is
 * declared in the editor domain rather than inside the bridge under `ui/`.
 * A `desktop/` module that had to import a presentation module to name a two-case
 * union is the boundary leak the architecture gate now refuses; the bridge
 * re-exports the union so its own consumers are unchanged.
 */

export type FramescaperNativeLiveRenderInputRoleV1 =
	| 'evaluated-rgba-frame-pack'
	| 'staged-audio-mix';
