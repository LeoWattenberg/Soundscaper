/* SPDX-License-Identifier: AGPL-3.0-only */

/** Handle-bound file identity, length, and digest authentication for media jobs. */

import {
	acquireNativeMediaFileLease,
	type NativeMediaAuthenticatedFile,
	type NativeMediaFileAuthentication,
} from './native-media-filesystem-lease.ts';

export type {
	NativeMediaAuthenticatedFile,
	NativeMediaFileAuthentication,
} from './native-media-filesystem-lease.ts';

export async function authenticateNativeMediaFile(
	request: NativeMediaFileAuthentication,
): Promise<NativeMediaAuthenticatedFile> {
	const lease = await acquireNativeMediaFileLease(request);
	try {
		return lease.authenticated;
	} finally {
		await lease.close();
	}
}
