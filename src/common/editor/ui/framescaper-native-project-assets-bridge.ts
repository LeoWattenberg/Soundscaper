/* SPDX-License-Identifier: AGPL-3.0-only */

/** Optional pathless renderer claims for main-owned project assets. */

export const FRAMESCAPER_NATIVE_PROJECT_ASSET_METHODS = Object.freeze([
	'claimWatchImport', 'completeWatchImport',
	'claimProxyOutput', 'readProxyOutput', 'releaseProxyOutput',
] as const);

interface FramescaperNativeWatchImportClaimBase {
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
}

export type FramescaperNativeWatchImportClaimV20 = FramescaperNativeWatchImportClaimBase;

export interface FramescaperNativeWatchImportClaimV28
	extends FramescaperNativeWatchImportClaimBase {
	readonly projectSchemaVersion: 28;
	readonly binId: string;
	readonly generateProxies: boolean;
	readonly existingSourceId: string | null;
}

export type FramescaperNativeWatchImportClaim =
	| FramescaperNativeWatchImportClaimV20
	| FramescaperNativeWatchImportClaimV28;

export interface FramescaperNativeWatchImportCompletionV20 {
	readonly claimId: string;
	readonly projectId: string;
	readonly expectedProjectRevision: number;
	readonly committedProjectRevision: number;
	readonly success: boolean;
}

export interface FramescaperNativeWatchImportCompletionV28
	extends FramescaperNativeWatchImportCompletionV20 {
	readonly projectSchemaVersion: 28;
	readonly binId: string;
	readonly sourceId: string | null;
	readonly contentSha256: string;
}

export type FramescaperNativeWatchImportCompletion =
	| FramescaperNativeWatchImportCompletionV20
	| FramescaperNativeWatchImportCompletionV28;

export interface FramescaperNativeProjectAssetsBridge {
	claimWatchImport?(request: Readonly<{
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
