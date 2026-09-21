/* SPDX-License-Identifier: AGPL-3.0-only */

export interface PackagedExecutableResourceFile {
	readonly path: string;
	readonly byteLength: number;
	readonly sha256: string;
}

export interface PackagedExecutableResourceIdentity {
	readonly fileCount: number;
	readonly totalBytes: number;
	readonly sha256: string;
}

export interface PackagedExecutableResourcesBeforeLaunch {
	readonly path: string;
	readonly beforeLaunch: PackagedExecutableResourceIdentity;
	readonly webAssemblyResources: readonly PackagedExecutableResourceFile[];
}

export interface PackagedExecutableResources extends PackagedExecutableResourcesBeforeLaunch {
	readonly afterCollection: PackagedExecutableResourceIdentity;
}

export function resolvePackagedResourcesPath(executablePath: string, platform: string): string;
export function collectPackagedExecutableResourceFiles(
	resourcesRoot: string,
): Promise<readonly PackagedExecutableResourceFile[]>;
export function packagedExecutableResourceIdentity(
	files: readonly PackagedExecutableResourceFile[],
): PackagedExecutableResourceIdentity;
export function capturePackagedExecutableResourcesBeforeLaunch(options: {
	readonly executablePath: string;
	readonly platform: string;
}): Promise<PackagedExecutableResourcesBeforeLaunch>;
export function capturePackagedExecutableResourcesAfterCollection(
	value: PackagedExecutableResourcesBeforeLaunch,
): Promise<PackagedExecutableResources>;
export function inspectPackagedExecutableResourcesBeforeLaunch(
	value: PackagedExecutableResourcesBeforeLaunch,
	expectedPath?: string | null,
): PackagedExecutableResourcesBeforeLaunch;
