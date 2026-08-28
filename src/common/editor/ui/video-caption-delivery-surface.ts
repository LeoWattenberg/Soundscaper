/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	FRAMESCAPER_PROJECT_SCHEMA_FAMILY,
	isCurrentProjectSchemaIdentity,
} from '../project-schema-identity.ts';

/** Framescaper owns caption sidecars outside generic video-file delivery. */
export function framescaperCaptionDeliveryUnavailable(
	productId: unknown,
	project: unknown,
): boolean {
	return productId === 'framescaper'
		&& isCurrentProjectSchemaIdentity(project, FRAMESCAPER_PROJECT_SCHEMA_FAMILY);
}
