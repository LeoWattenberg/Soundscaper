/* SPDX-License-Identifier: AGPL-3.0-only */

import { EXTERNAL_MEDIA_ENCODING, externalMediaForSource } from './desktop-external-media.ts';
import { digestScapeBytes, safeScapeEntryId } from './scape-archive-media.ts';
import type { PlannedScapeExportAsset } from './scape-export-plan.ts';

export function planExternalScapeAsset(source: Readonly<Record<string, unknown>>): PlannedScapeExportAsset | null {
	const reference = externalMediaForSource(source);
	if (!reference) return null;
	const body = new TextEncoder().encode(JSON.stringify(reference));
	return { source, sourceId: String(source.id), storageKey: String(source.storageKey || source.id),
		kind: String(source.kind), entry: `references/${safeScapeEntryId(String(source.id))}.json`,
		encoding: EXTERNAL_MEDIA_ENCODING, mimeType: String(source.mimeType || ''), size: body.byteLength,
		expectedSha256: digestScapeBytes(body), body };
}
