/* SPDX-License-Identifier: AGPL-3.0-only */
import { framescaperSuccessorCopy } from '../../i18n/framescaper-successor-copy.ts';
declare const __SCAPE_FRAMESCAPER_LINE__: 'baseline' | 'successor';

/** No successor code or migration entry is reachable in the frozen baseline editor. */
export function createFramescaperSuccessorMigrationMenuItems(productId: string) {
	if (productId !== 'framescaper' || typeof __SCAPE_FRAMESCAPER_LINE__ === 'undefined' || __SCAPE_FRAMESCAPER_LINE__ !== 'successor') return [];
	return [{ id: 'framescaper-successor-migration', label: framescaperSuccessorCopy(typeof document === 'undefined' ? 'en' : document.documentElement.lang).menu, preserveLabel: true,
		onClick: () => import('./framescaper-successor-migration-dialog.tsx').then(({ openFramescaperSuccessorMigrationDialog }) => openFramescaperSuccessorMigrationDialog()),
	}];
}
