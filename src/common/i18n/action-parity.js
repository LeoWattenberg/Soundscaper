import {
	CANONICAL_EXTRA_COPY_BY_LOCALE,
	audacityParityLabelCopyKey,
	audacityParityReasonCopyKey,
	canonicalCopyValue,
} from './canonical-extras.js';

function reason(name) {
	const catalogKey = audacityParityReasonCopyKey(name);
	return deepFreeze({
		en: CANONICAL_EXTRA_COPY_BY_LOCALE.en[catalogKey],
		de: CANONICAL_EXTRA_COPY_BY_LOCALE.de[catalogKey],
		catalogKey,
	});
}

export const AUDACITY_DISABLED_REASONS = deepFreeze({
	menu: reason('menu'),
	todo: reason('todo'),
	local: reason('local'),
	state: reason('state'),
	pending: reason('pending'),
});

export const AUDACITY_EXCLUDED_REASONS = deepFreeze({
	cloud: reason('cloud'),
	plugins: reason('plugins'),
	os: reason('os'),
	developer: reason('developer'),
	midi: reason('midi'),
});

export function localizedAudacityParityLabel(label, copyOrLocale = 'en') {
	const catalogKey = audacityParityLabelCopyKey(label);
	const value = canonicalCopyValue(catalogKey, copyOrLocale);
	return value === catalogKey ? label : value;
}

export function localizedAudacityReason(value, copyOrLocale = 'en') {
	if (!value) return null;
	return canonicalCopyValue(value.catalogKey, copyOrLocale);
}

function deepFreeze(value) {
	if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
	for (const child of Object.values(value)) deepFreeze(child);
	return Object.freeze(value);
}
