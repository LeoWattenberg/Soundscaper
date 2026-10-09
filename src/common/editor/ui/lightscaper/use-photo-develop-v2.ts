/* SPDX-License-Identifier: AGPL-3.0-only */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PhotoLibraryDevelopWorkflowV2, type ExecutePhotoDevelopV2, type PhotoDevelopWorkflowSnapshotV2 } from '../../controller/shared/photo-library-develop-workflow-v2.ts';
import { joinPhotoLibraryRetirementV1 } from '../../controller/shared/photo-library-workflow-slot.ts';

export function usePhotoDevelopV2(options: Readonly<{ generation: unknown; execute: ExecutePhotoDevelopV2 }>) {
	const execute = options.execute;
	const owner = useMemo(() => new PhotoLibraryDevelopWorkflowV2({ execute: (...args) => Reflect.apply(execute, options, args) }), [options.generation, options.execute]);
	const retirement = useRef<Promise<void>>(Promise.resolve());
	const drain = useCallback(() => joinPhotoLibraryRetirementV1([retirement.current, owner.cancel()]), [owner]);
	const [state, setState] = useState<Readonly<{ owner: PhotoLibraryDevelopWorkflowV2; snapshot: PhotoDevelopWorkflowSnapshotV2 }>>(() => ({ owner, snapshot: owner.snapshot() }));
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
