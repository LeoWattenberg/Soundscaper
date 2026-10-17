/* SPDX-License-Identifier: AGPL-3.0-only */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PhotoLibraryDevelopWorkflowV2, type ExecutePhotoDevelopV2, type PhotoDevelopWorkflowSnapshotV2 } from '../../controller/shared/photo-library-develop-workflow-v2.ts';
import { PhotoLibraryDevelopWorkflowCurrentV1, type ExecutePhotoDevelopCurrentV1, type PhotoDevelopWorkflowSnapshotCurrentV1 } from '../../controller/shared/photo-library-develop-workflow-current-v1.ts';
import { joinPhotoLibraryRetirementV1 } from '../../controller/shared/photo-library-workflow-slot.ts';

function useDevelop(profile: 'legacy2' | 'current3', options: Readonly<{ generation: unknown; execute: ExecutePhotoDevelopV2 | ExecutePhotoDevelopCurrentV1 }>) {
	if (profile !== 'legacy2' && profile !== 'current3') throw new TypeError('Unknown photo Develop profile.');
	const execute = options.execute;
	const owner = useMemo(() => profile === 'current3'
		? new PhotoLibraryDevelopWorkflowCurrentV1({ execute: (...args) => Reflect.apply(execute, options, args) as ReturnType<ExecutePhotoDevelopCurrentV1> })
		: new PhotoLibraryDevelopWorkflowV2({ execute: (...args) => Reflect.apply(execute, options, args) as ReturnType<ExecutePhotoDevelopV2> }), [profile, options.generation, options.execute]);
	const retirement = useRef<Promise<void>>(Promise.resolve());
	const drain = useCallback(() => joinPhotoLibraryRetirementV1([retirement.current, owner.cancel()]), [owner]);
	const [state, setState] = useState<Readonly<{ owner: PhotoLibraryDevelopWorkflowV2 | PhotoLibraryDevelopWorkflowCurrentV1; snapshot: PhotoDevelopWorkflowSnapshotV2 | PhotoDevelopWorkflowSnapshotCurrentV1 }>>(() => ({ owner, snapshot: owner.snapshot() }));
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

export type PhotoDevelopHookLegacyV2 = Omit<ReturnType<typeof useDevelop>, 'owner' | 'snapshot'> & { owner: PhotoLibraryDevelopWorkflowV2; snapshot: PhotoDevelopWorkflowSnapshotV2 };
export type PhotoDevelopHookCurrentV1 = Omit<ReturnType<typeof useDevelop>, 'owner' | 'snapshot'> & { owner: PhotoLibraryDevelopWorkflowCurrentV1; snapshot: PhotoDevelopWorkflowSnapshotCurrentV1 };
export function usePhotoDevelopForProfileV1(profile: 'legacy2', options: Readonly<{ generation: unknown; execute: ExecutePhotoDevelopV2 }>): PhotoDevelopHookLegacyV2;
export function usePhotoDevelopForProfileV1(profile: 'current3', options: Readonly<{ generation: unknown; execute: ExecutePhotoDevelopCurrentV1 }>): PhotoDevelopHookCurrentV1;
export function usePhotoDevelopForProfileV1(profile: 'legacy2' | 'current3', options: Readonly<{ generation: unknown; execute: ExecutePhotoDevelopV2 | ExecutePhotoDevelopCurrentV1 }>): PhotoDevelopHookLegacyV2 | PhotoDevelopHookCurrentV1 {
	return useDevelop(profile, options) as PhotoDevelopHookLegacyV2 | PhotoDevelopHookCurrentV1;
}
