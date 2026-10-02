/* SPDX-License-Identifier: AGPL-3.0-only */

import { VIDEO_PROXY_MAXIMUM_BODY_BYTES } from './video-proxy-attachment-v18.ts';
import { confirmFileSizeWarning, type FileSizeWarningOptions } from './controller/shared/file-size-warning.ts';

/** Confirm whole proxy bodies before archive extraction or provisional writes. */
export async function confirmScapeProxyImportSizes(
	manifest: Readonly<{ assets: readonly Readonly<{ kind: string; size: number }>[] }>,
	options: FileSizeWarningOptions,
): Promise<void> {
	for (const asset of manifest.assets) if (asset.kind === 'video-proxy') {
		await confirmFileSizeWarning(asset.size, VIDEO_PROXY_MAXIMUM_BODY_BYTES, 'Video proxy archive body', options);
	}
}
