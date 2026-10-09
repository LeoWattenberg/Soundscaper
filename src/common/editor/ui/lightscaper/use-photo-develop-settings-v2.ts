/* SPDX-License-Identifier: AGPL-3.0-only */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PhotoLibraryDevelopSettingsWorkflowV2 } from '../../controller/shared/photo-library-develop-settings-workflow-v2.ts';
import type { ExecutePhotoDevelopV2 } from '../../controller/shared/photo-library-develop-workflow-v2.ts';
import { joinPhotoLibraryRetirementV1 } from '../../controller/shared/photo-library-workflow-slot.ts';

export function usePhotoDevelopSettingsV2(options: Readonly<{ generation: unknown; execute: ExecutePhotoDevelopV2 }>) {
	const execute = options.execute;
	const owner = useMemo(() => new PhotoLibraryDevelopSettingsWorkflowV2({ execute: (...args) => Reflect.apply(execute, options, args) }), [options.generation, options.execute]);
	const pending = useRef<Promise<void>>(Promise.resolve());
	const [view, setView] = useState(() => ({ owner, snapshot: owner.snapshot() }));
	useEffect(() => {
		owner.resume(); const unsubscribe = owner.subscribe(snapshot => { setView({ owner, snapshot }); });
		return () => { unsubscribe(); pending.current = joinPhotoLibraryRetirementV1([pending.current, owner.retire()]); void pending.current.catch(() => undefined); };
	}, [owner]);
	const drain = useCallback(() => joinPhotoLibraryRetirementV1([pending.current, owner.cancel()]), [owner]);
	return { owner, drain, snapshot: view.owner === owner ? view.snapshot : owner.snapshot() };
}
