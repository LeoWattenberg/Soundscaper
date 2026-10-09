/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	FRAMESCAPER_PROJECT_SCHEMA_FAMILY,
	SOUNDSCAPER_PROJECT_SCHEMA_FAMILY,
	isCurrentProjectSchemaIdentity,
} from '../project-schema-identity.ts';

/** Selected products own captions separately from their video-file renderers. */
export function videoCaptionDeliveryUnavailable(
	productId: unknown,
	project: unknown,
): boolean {
	return (productId === 'framescaper'
		&& isCurrentProjectSchemaIdentity(project, FRAMESCAPER_PROJECT_SCHEMA_FAMILY))
		|| (productId === 'soundscaper'
			&& isCurrentProjectSchemaIdentity(project, SOUNDSCAPER_PROJECT_SCHEMA_FAMILY));
}

export { videoCaptionDeliveryUnavailable as framescaperCaptionDeliveryUnavailable };
