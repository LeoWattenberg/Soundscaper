/* SPDX-License-Identifier: AGPL-3.0-only */
import { useState } from 'react';
import { preparePhotoDevelopPreviewRendererCurrentV1, type PhotoDevelopPreviewRendererCurrentV1 } from '../../photo-library-develop-gpu-preview-port-current-v1.ts';

/** Presentation preference only. A replaced workspace starts from CPU. */
export function usePhotoDevelopPreviewRendererCurrentV1(owner: object, photoId: string) {
	const [selected, setSelected] = useState(() => ({ owner, photoId, value: 'cpu' as PhotoDevelopPreviewRendererCurrentV1 }));
	const value = selected.owner === owner && selected.photoId === photoId ? selected.value : 'cpu';
	return { value, apply(next: PhotoDevelopPreviewRendererCurrentV1) { setSelected({ owner, photoId, value: preparePhotoDevelopPreviewRendererCurrentV1(next) }); } };
}
