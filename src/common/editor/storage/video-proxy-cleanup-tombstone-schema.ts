/* SPDX-License-Identifier: AGPL-3.0-only */

export const VIDEO_PROXY_CLEANUP_TOMBSTONE_KIND = 'video-proxy-cleanup-pending' as const;
export const VIDEO_PROXY_CLEANUP_TOMBSTONE_SCHEMA_VERSION = 1 as const;

const KEY_PREFIX = 'video-proxy-cleanup-pending:';

export function videoProxyCleanupTombstoneKey(bodyKeyValue: unknown): string {
	const bodyKey = String(bodyKeyValue);
	if (typeof bodyKeyValue !== 'string'
		|| !/^(?:video-proxy|video-timing)-sha256:[a-f0-9]{64}$/u.test(bodyKey)) {
		throw new TypeError('A content-addressed video proxy cleanup body key is required.');
	}
	return `${KEY_PREFIX}${bodyKey}`;
}
