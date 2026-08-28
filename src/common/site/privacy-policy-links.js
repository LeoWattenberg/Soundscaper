/* SPDX-License-Identifier: AGPL-3.0-only */

import { localeLanguage } from '../i18n/locale.js';
import { productWebOrigin } from '../product-web-links.js';

export function privacyPolicyLocale(locale = 'en') {
	return localeLanguage(locale) === 'de' ? 'de' : 'en';
}

export function privacyPolicyPath(locale = 'en') {
	return `/privacy/${privacyPolicyLocale(locale)}/`;
}

export function privacyPolicyUrl(productId, locale = 'en') {
	return `${productWebOrigin(productId)}${privacyPolicyPath(locale)}`;
}
