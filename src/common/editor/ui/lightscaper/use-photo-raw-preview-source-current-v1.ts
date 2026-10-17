/* SPDX-License-Identifier: AGPL-3.0-only */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { PhotoLibrarySessionPortCurrentV1, PhotoLibraryRawPreviewSourceCurrentV1 } from '../../photo-library-session-port-current-v1.ts';

type Reader = PhotoLibrarySessionPortCurrentV1['readPreview'];
type Profile = 'legacy2' | 'current3';

/** Session-generation preference for culling only. Reader replacement lets the
 * existing preview presenter cancel and join its pending job before demand for
 * the new source begins. Develop retains its separate unmodified read port. */
export function usePhotoRawPreviewSourceCurrentV1(profile: Profile, generation: object, readPreview: Reader) {
	const [selected, setSelected] = useState<Readonly<{ generation: object; source: PhotoLibraryRawPreviewSourceCurrentV1 }>>(
		() => ({ generation, source: 'neutral-original' }));
	const current = useRef({ generation, profile }); current.current = { generation, profile };
	const live = useRef(true);
	useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
	const source = selected.generation === generation ? selected.source : 'neutral-original';
	const select = useCallback((source: PhotoLibraryRawPreviewSourceCurrentV1) => {
		if (!live.current || current.current.generation !== generation || current.current.profile !== 'current3' || profile !== 'current3') return;
		if (source !== 'neutral-original' && source !== 'camera-embedded') throw new RangeError('Unknown RAW culling preview source.');
		setSelected(previous => previous.generation === generation && previous.source === source ? previous : { generation, source });
	}, [generation, profile]);
	const readCullingPreview = useCallback<Reader>((photoId, tier, options = {}) =>
		readPreview(photoId, tier, { ...options, rawPreviewSource: source }), [readPreview, source]);
	return { source, select, readPreview: profile === 'current3' ? readCullingPreview : readPreview };
}
