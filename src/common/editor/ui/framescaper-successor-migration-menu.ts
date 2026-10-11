/* SPDX-License-Identifier: AGPL-3.0-only */
import { framescaperSuccessorCopy } from '../../i18n/framescaper-successor-copy.ts';
import type { FramescaperSuccessorMenuRuntime } from './framescaper-successor-menu-runtime.ts';
declare const __SCAPE_FRAMESCAPER_LINE__: 'baseline' | 'successor';

/** No successor code or migration entry is reachable in the frozen baseline editor. */
export function createFramescaperSuccessorMigrationMenuItems(productId: string, runtime?: FramescaperSuccessorMenuRuntime | null) {
	if (productId !== 'framescaper' || typeof __SCAPE_FRAMESCAPER_LINE__ === 'undefined' || __SCAPE_FRAMESCAPER_LINE__ !== 'successor') return [];
	const copy = framescaperSuccessorCopy(typeof document === 'undefined' ? 'en' : document.documentElement.lang);
	return [...(runtime ? [{ id: 'framescaper-composition-links', label: copy.linksMenu, preserveLabel: true, onClick: () => runtime.openLinks() }] : []), { id: 'framescaper-successor-migration', label: framescaperSuccessorCopy(typeof document === 'undefined' ? 'en' : document.documentElement.lang).menu, preserveLabel: true,
		onClick: () => runtime ? runtime.openMigration() : import('./framescaper-successor-migration-dialog.tsx').then(({ openFramescaperSuccessorMigrationDialog }) => openFramescaperSuccessorMigrationDialog()),
	}];
}
