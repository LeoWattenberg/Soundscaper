/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect } from 'react';

import { PRIVACY_POLICY_REQUEST_EVENT } from '../../site/privacy-policy-links.js';

export function usePrivacyPolicySurface(
	productId: string,
	initialSurface: string | null,
	setActiveSurface: (surface: string | null) => void,
): void {
	useEffect(() => {
		if (initialSurface) setActiveSurface(initialSurface);
	}, [initialSurface, setActiveSurface]);
	useEffect(() => {
		const openPrivacyPolicy = (event: Event): void => {
			if (event instanceof CustomEvent
				&& event.detail?.productId && event.detail.productId !== productId) return;
			setActiveSurface('privacy-policy');
		};
		window.addEventListener(PRIVACY_POLICY_REQUEST_EVENT, openPrivacyPolicy);
		return () => window.removeEventListener(PRIVACY_POLICY_REQUEST_EVENT, openPrivacyPolicy);
	}, [productId, setActiveSurface]);
}
