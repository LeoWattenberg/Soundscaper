/* SPDX-License-Identifier: AGPL-3.0-only */

export const MEDIA_ASSET_STAGING_STORE_NAME = 'mediaAssetStaging';
export const MEDIA_ASSET_STAGING_STATE_KEY = 'state';
export const MEDIA_ASSET_STAGING_SCHEMA_VERSION = 5;
export const MEDIA_ASSET_STAGING_LEASE_MS = 24 * 60 * 60 * 1000;
export const MEDIA_ASSET_STAGING_KIND_INDEX_NAME = 'kind';
export const MEDIA_ASSET_STAGING_TOKEN_INDEX_NAME = 'mediaChunkToken';
export const MEDIA_ASSET_STAGING_PATH_INDEX_NAME = 'path';
export const MEDIA_ASSET_STAGING_EXPIRY_INDEX_NAME = 'expiresAt';

export interface MediaAssetStagingStateRecord extends Record<string, unknown> {
	readonly key: typeof MEDIA_ASSET_STAGING_STATE_KEY;
	readonly kind: 'state';
	readonly generation: string;
}

export interface MediaAssetStagingLeaseRecord extends Record<string, unknown> {
	readonly key: string;
	readonly kind: 'lease';
	readonly leaseId: string;
	readonly generation: string;
	readonly sourceId: string;
	readonly mediaChunkToken?: string;
	readonly path?: string;
	readonly createdAt: number;
	readonly updatedAt: number;
	readonly expiresAt: number;
}
