/* SPDX-License-Identifier: AGPL-3.0-only */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PhotoLibraryDevelopWorkflowV1, type ExecutePhotoDevelopV1, type PhotoDevelopWorkflowSnapshotV1 } from '../../controller/shared/photo-library-develop-workflow-v1.ts';
import { joinPhotoLibraryRetirementV1 } from '../../controller/shared/photo-library-workflow-slot.ts';

export function usePhotoDevelop(options: Readonly<{ generation: unknown; execute: ExecutePhotoDevelopV1 }>) {
	const owner = useMemo(() => new PhotoLibraryDevelopWorkflowV1({ execute: options.execute }), [options.generation, options.execute]);
	const retirement = useRef<Promise<void>>(Promise.resolve());
	const drain = useCallback(() => joinPhotoLibraryRetirementV1([retirement.current, owner.cancel()]), [owner]);
	const [state, setState] = useState<Readonly<{ owner: PhotoLibraryDevelopWorkflowV1; snapshot: PhotoDevelopWorkflowSnapshotV1 }>>(() => ({ owner, snapshot: owner.snapshot() }));
	useEffect(() => {
		owner.resume();
		const unsubscribe = owner.subscribe(snapshot => { setState({ owner, snapshot }); });
		return () => {
			unsubscribe(); retirement.current = joinPhotoLibraryRetirementV1([retirement.current, owner.retire()]);
			void retirement.current.catch(() => undefined);
		};
	}, [owner]);
	return { owner, drain, snapshot: state.owner === owner ? state.snapshot : owner.snapshot() };
}
