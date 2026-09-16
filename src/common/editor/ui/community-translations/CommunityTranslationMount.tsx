/* SPDX-License-Identifier: AGPL-3.0-only */

import { Suspense, useEffect, useRef, useState } from 'react';

import { lazyEditorModule } from '../../../offline/lazy-module.tsx';
import { COMMUNITY_TRANSLATIONS_REQUEST_EVENT } from './community-translation-menu.ts';
import type { CommunityTranslationFileService } from './community-translation-files.ts';
import type { CommunityTranslationPresentationPort } from './community-translation-presentation.ts';

const CommunityTranslationSurface = lazyEditorModule(() => import('./CommunityTranslationSurface.tsx'));

interface CommunityTranslationMountProps {
	readonly controller: { readonly presentationLocalization?: CommunityTranslationPresentationPort };
	readonly fileService: CommunityTranslationFileService;
	readonly productId: string;
	readonly locale: string;
	readonly copy: Readonly<Record<string, string>>;
}

/** A menu-only, nonmodal surface independent of the editor's active dialog. */
export default function CommunityTranslationMount({ controller, fileService, productId, locale, copy }: CommunityTranslationMountProps) {
	const [open, setOpen] = useState(false);
	const returnFocus = useRef<HTMLElement | null>(null);
	useEffect(() => {
		const request = (event: Event): void => {
			if (!(event instanceof CustomEvent) || event.detail?.productId !== productId) return;
			returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
			setOpen(true);
		};
		globalThis.addEventListener(COMMUNITY_TRANSLATIONS_REQUEST_EVENT, request);
		return () => globalThis.removeEventListener(COMMUNITY_TRANSLATIONS_REQUEST_EVENT, request);
	}, [productId]);
	if (!open || !controller.presentationLocalization) return null;
	const initialLocale = locale === 'en' ? 'de' : locale;
	return <Suspense fallback={null}><CommunityTranslationSurface
		port={controller.presentationLocalization} copy={copy} initialLocale={initialLocale} fileService={fileService}
		onClose={() => {
			setOpen(false);
			if (returnFocus.current?.isConnected) returnFocus.current.focus({ preventScroll: true });
		}}
	/></Suspense>;
}
