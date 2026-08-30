/* SPDX-License-Identifier: AGPL-3.0-only */

/** Separates scanner/descriptor failures from transient main-owned staging failures. */

import type { OfxPluginDescriptorV1 } from '../src/common/editor/native-ofx-descriptor.ts';

const HOST_STAGING_ERROR_CODES = new Set([
	'EACCES', 'EBUSY', 'EDQUOT', 'EIO', 'EMFILE', 'ENFILE', 'ENOENT', 'ENOSPC', 'ENOTDIR', 'EPERM', 'EROFS',
]);

interface ScanIdentity {
	readonly byteLength: number;
	readonly sha256: string;
}

export async function authenticateOpenFxScanDescriptor(options: Readonly<{
	readonly scanning: Promise<Readonly<{ readonly descriptor: ScanIdentity }>>;
	readonly receiving: Promise<ScanIdentity>;
	readonly readDescriptor: () => Promise<Uint8Array>;
	readonly parseDescriptor: (bytes: Uint8Array) => OfxPluginDescriptorV1;
	readonly quarantine: () => void;
}>): Promise<OfxPluginDescriptorV1> {
	let result: Readonly<{ readonly descriptor: ScanIdentity }>;
	let completed: ScanIdentity;
	try {
		[result, completed] = await Promise.all([options.scanning, options.receiving]);
	} catch (error) {
		if (!hostStagingFailure(error)) options.quarantine();
		throw error;
	}
	if (result.descriptor.byteLength !== completed.byteLength
		|| result.descriptor.sha256 !== completed.sha256) {
		options.quarantine();
		throw new Error('The OpenFX scanner control and data planes disagree.');
	}
	const bytes = await options.readDescriptor();
	try { return options.parseDescriptor(bytes); }
	catch (error) { options.quarantine(); throw error; }
}

function hostStagingFailure(error: unknown): boolean {
	if (!error || typeof error !== 'object' || !('code' in error)) return false;
	return HOST_STAGING_ERROR_CODES.has(String((error as Readonly<{ code?: unknown }>).code ?? ''));
}
