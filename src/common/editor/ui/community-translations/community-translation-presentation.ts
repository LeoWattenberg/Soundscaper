/* SPDX-License-Identifier: AGPL-3.0-only */

import { useMemo, useSyncExternalStore } from 'react';

export interface CommunityTranslationPresentationSnapshot {
	readonly locale: string;
	readonly copy: Readonly<Record<string, string>>;
	readonly revision: number;
}

export interface CommunityTranslationPresentationPort {
	readonly publishedCopy: Readonly<Record<string, string>>;
	getSnapshot(): CommunityTranslationPresentationSnapshot;
	subscribe(listener: () => void): () => void;
	applyPreview(locale: string, translations: Readonly<Record<string, string>>): void;
	resetPreview(): void;
}

interface TranslationPresentationController {
	readonly presentationLocalization?: CommunityTranslationPresentationPort;
}

const noopSubscribe = (_listener: () => void): (() => void) => () => {};

export function useCommunityTranslationPresentation(
	controller: TranslationPresentationController,
	locale: string,
	copy: Readonly<Record<string, string>>,
): CommunityTranslationPresentationSnapshot {
	const fallback = useMemo(() => ({ locale, copy, revision: 0 }), [locale, copy]);
	const port = controller.presentationLocalization;
	return useSyncExternalStore(port?.subscribe ?? noopSubscribe, port?.getSnapshot ?? (() => fallback), () => fallback);
}
