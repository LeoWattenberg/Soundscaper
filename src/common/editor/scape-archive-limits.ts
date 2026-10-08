/* SPDX-License-Identifier: AGPL-3.0-only */

export const SCAPE_FORMAT = 'scape-project';
export const SCAPE_FORMAT_VERSION = 1;
export const SCAPE_MANIFEST_ENTRY = 'manifest.json';
export const SCAPE_PROJECT_ENTRY = 'project.json';

export interface ScapeArchiveLimits {
	maximumEntryCount: number;
	maximumManifestBytes: number;
	maximumProjectBytes: number;
	maximumExpandedBytes: number;
}

export const SCAPE_ARCHIVE_LIMITS: Readonly<ScapeArchiveLimits> = Object.freeze({
	maximumEntryCount: 4_096,
	maximumManifestBytes: 32 * 1024 * 1024,
	maximumProjectBytes: 256 * 1024 * 1024,
	maximumExpandedBytes: 64 * 1024 * 1024 * 1024,
});
