/* SPDX-License-Identifier: AGPL-3.0-only */

/** Optional pathless renderer claims for main-owned baseline project assets. */

export const FRAMESCAPER_NATIVE_PROJECT_ASSET_METHODS = Object.freeze([
	'claimWatchImport', 'completeWatchImport',
	'claimProxyOutput', 'readProxyOutput', 'releaseProxyOutput',
] as const);

export interface FramescaperNativeWatchImportClaim {
	readonly schemaFamily: 'framescaper';
	readonly schemaVersion: 1;
	readonly claimId: string;
	readonly projectId: string;
	readonly projectRevision: number;
	readonly importMode: 'link' | 'copy';
	readonly locatorId: string;
	readonly locatorRevision: string;
	readonly name: string;
	readonly size: number;
	readonly mimeType: string;
	readonly lastModified: number;
	readonly contentSha256: string;
	readonly binId: 'project-bin';
	readonly generateProxies: boolean;
	readonly existingSourceId: string | null;
}

export interface FramescaperNativeWatchImportCompletion {
	readonly schemaFamily: 'framescaper';
	readonly schemaVersion: 1;
	readonly claimId: string;
	readonly projectId: string;
	readonly expectedProjectRevision: number;
	readonly committedProjectRevision: number;
	readonly success: boolean;
	readonly binId: 'project-bin';
	readonly sourceId: string | null;
	readonly contentSha256: string;
}

export interface FramescaperNativeProjectAssetsBridge {
	claimWatchImport?(request: Readonly<{
		readonly schemaFamily: 'framescaper';
		readonly schemaVersion: 1;
		readonly projectId: string;
		readonly projectRevision: number;
	}>): Promise<FramescaperNativeWatchImportClaim | null>;
	completeWatchImport?(request: FramescaperNativeWatchImportCompletion): Promise<boolean>;
	claimProxyOutput?(request: Readonly<{ readonly jobId: string }>): Promise<Readonly<{
		readonly claimId: string;
		readonly byteLength: number;
		readonly sha256: string;
		readonly mimeType: 'video/quicktime';
	}>>;
	readProxyOutput?(request: Readonly<{
		readonly claimId: string; readonly offset: number; readonly length: number;
	}>): Promise<Uint8Array>;
	releaseProxyOutput?(request: Readonly<{ readonly claimId: string }>): Promise<boolean>;
}
