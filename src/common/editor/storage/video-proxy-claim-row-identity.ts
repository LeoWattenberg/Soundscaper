/* SPDX-License-Identifier: AGPL-3.0-only */

import type { VideoProxyClaimRowIdentity } from './video-proxy-claim-repository.ts';

/** Keep archive and preservation publication bound to the same verified body row. */
export function sameVideoProxyClaimBodyRow(
	row: Readonly<Record<string, unknown>>,
	identity: Readonly<VideoProxyClaimRowIdentity>,
): boolean {
	return row.sourceId === identity.sourceId && row.kind === identity.kind
		&& row.encoding === identity.encoding && row.storage === identity.storage
		&& (row.path ?? null) === identity.path && (row.mediaChunkToken ?? null) === identity.mediaChunkToken
		&& (row.mediaChunkBytes ?? null) === identity.mediaChunkBytes
		&& (row.mediaChunkCount ?? null) === identity.mediaChunkCount
		&& row.mediaContentDigestVersion === identity.mediaContentDigestVersion
		&& row.mediaContentToken === identity.mediaContentToken && row.sha256 === identity.sha256
		&& row.size === identity.byteLength && row.mimeType === identity.mimeType;
}
