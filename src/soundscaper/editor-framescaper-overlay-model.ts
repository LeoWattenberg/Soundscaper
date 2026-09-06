/* SPDX-License-Identifier: AGPL-3.0-only */

import type * as Finishing from '../common/editor/ui/framescaper-finishing-menu.ts';
import type * as Authoring from '../common/editor/ui/framescaper-selected-visual-authoring-menu.ts';
import type * as Proxy from '../common/editor/ui/framescaper-video-proxy-application-menu.ts';

// An unavailable implementation still implements the complete consumer contract.
// These type-only imports never bring Framescaper features into the browser graph.
export type FramescaperFinishingSurface = Finishing.FramescaperFinishingSurface;

export const framescaperFinishingSurface: typeof Finishing.framescaperFinishingSurface = () => null;
export const framescaperFinishingSurfaceId: typeof Finishing.framescaperFinishingSurfaceId = () => '';
export const framescaperSelectedVisualAuthoringSurface: typeof Authoring.framescaperSelectedVisualAuthoringSurface = () => null;
export const framescaperSelectedVisualAuthoringSurfaceId: typeof Authoring.framescaperSelectedVisualAuthoringSurfaceId = () => '';

const EMPTY_FINISHING_MENU_ITEMS = Object.freeze({
	tracks: [], effect: [], analyze: [], mixer: [], tools: [],
} as const);

export const createFramescaperFinishingMenuItems: typeof Finishing.createFramescaperFinishingMenuItems = () => EMPTY_FINISHING_MENU_ITEMS;
export const createFramescaperVideoProxyApplicationMenuItems: typeof Proxy.createFramescaperVideoProxyApplicationMenuItems = () => Object.freeze([]);
