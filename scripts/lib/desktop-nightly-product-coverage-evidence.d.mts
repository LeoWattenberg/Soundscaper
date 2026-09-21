/* SPDX-License-Identifier: AGPL-3.0-only */

export interface DesktopNightlyProductCoverageFile {
	readonly artifactPath: string;
	readonly byteLength: number;
	readonly sha256: string;
}

export interface DesktopNightlyProductCoverageResourceIdentity {
	readonly fileCount: number;
	readonly totalBytes: number;
	readonly sha256: string;
}

export interface DesktopNightlyProductCoverageExcludedScript {
	readonly path: string;
	readonly byteLength: number;
	readonly sha256: string;
}

export interface DesktopNightlyProductCoverageScript extends DesktopNightlyProductCoverageFile {
	readonly realm: 'main' | 'preload' | 'renderer';
	readonly packagedPath: string;
}

export interface DesktopNightlyProductCoverageDocument extends DesktopNightlyProductCoverageFile {
	readonly packagedPath: string;
}

export interface DesktopNightlyProductCoverageWebAssembly extends DesktopNightlyProductCoverageFile {
	readonly packagedPath: string;
}

export interface DesktopNightlyProductCoverageEvidence {
	readonly schemaVersion: 4;
	readonly kind: 'soundscaper-e2e-product-build-evidence';
	readonly productId: 'soundscaper' | 'framescaper';
	readonly sourceRevision: string;
	readonly packageArchive: Omit<DesktopNightlyProductCoverageFile, 'artifactPath'>;
	readonly executableResources: DesktopNightlyProductCoverageResourceIdentity;
	readonly excludedRuntimeScripts: readonly DesktopNightlyProductCoverageExcludedScript[];
	readonly documents: readonly DesktopNightlyProductCoverageDocument[];
	readonly scripts: readonly DesktopNightlyProductCoverageScript[];
	readonly sourceMaps: readonly DesktopNightlyProductCoverageFile[];
	readonly webAssemblyResources: readonly DesktopNightlyProductCoverageWebAssembly[];
}

export function preserveDesktopNightlyProductCoverageEvidence(options: {
	readonly buildRoot: string;
	readonly productId: string;
	readonly productOutput: string;
	readonly sourceRevision: string;
}): Promise<DesktopNightlyProductCoverageEvidence>;
