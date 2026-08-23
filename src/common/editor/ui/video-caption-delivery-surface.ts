/* SPDX-License-Identifier: AGPL-3.0-only */

/** Selected V27 owns caption sidecars outside the generic video-file delivery. */
export function framescaperV27CaptionDeliveryUnavailable(
	productId: unknown,
	project: unknown,
): boolean {
	if (productId !== 'framescaper' || !project || typeof project !== 'object' || Array.isArray(project)) {
		return false;
	}
	const descriptor = Object.getOwnPropertyDescriptor(project, 'schemaVersion');
	return descriptor?.enumerable === true
		&& Object.hasOwn(descriptor, 'value')
		&& descriptor.value === 27;
}
