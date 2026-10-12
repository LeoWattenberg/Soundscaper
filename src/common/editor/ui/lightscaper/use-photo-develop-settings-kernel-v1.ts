/* SPDX-License-Identifier: AGPL-3.0-only */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PhotoLibraryDevelopSettingsWorkflowV2 } from '../../controller/shared/photo-library-develop-settings-workflow-v2.ts';
import type { ExecutePhotoDevelopV2 } from '../../controller/shared/photo-library-develop-workflow-v2.ts';
import type { ExecutePhotoDevelopCurrentV1 } from '../../controller/shared/photo-library-develop-workflow-current-v1.ts';
import { PhotoLibraryDevelopSettingsWorkflowCurrentV1 } from '../../controller/shared/photo-library-develop-settings-workflow-current-v1.ts';
import { joinPhotoLibraryRetirementV1 } from '../../controller/shared/photo-library-workflow-slot.ts';

type ProfileV1 = 'legacy2' | 'current3';
type ExecuteForProfileV1<Profile extends ProfileV1> = Profile extends 'legacy2' ? ExecutePhotoDevelopV2 : ExecutePhotoDevelopCurrentV1;
export type SettingsOwnerForProfileV1<Profile extends ProfileV1> = Profile extends 'legacy2' ? PhotoLibraryDevelopSettingsWorkflowV2 : PhotoLibraryDevelopSettingsWorkflowCurrentV1;
export interface PhotoDevelopSettingsHookForProfileV1<Profile extends ProfileV1> {
	readonly owner: SettingsOwnerForProfileV1<Profile>;
	readonly snapshot: ReturnType<SettingsOwnerForProfileV1<Profile>['snapshot']>;
	readonly drain: () => Promise<void>;
}

export function usePhotoDevelopSettingsForProfileV1<Profile extends ProfileV1>(profile: Profile, options: Readonly<{ generation: unknown; execute: ExecuteForProfileV1<Profile> }>): PhotoDevelopSettingsHookForProfileV1<Profile> {
	if (profile !== 'legacy2' && profile !== 'current3') throw new TypeError('Unknown fixed Develop settings hook profile.');
	const execute = options.execute, generation = options.generation;
	const binding = useRef({ execute, generation, receiver: options });
	if (binding.current.execute !== execute || binding.current.generation !== generation) binding.current = { execute, generation, receiver: options };
	const captured = binding.current;
	const owner = useMemo(() => {
		const invoke = (...args: unknown[]) => Reflect.apply(captured.execute, captured.receiver, args) as Promise<unknown>;
		return (profile === 'legacy2' ? new PhotoLibraryDevelopSettingsWorkflowV2({ execute: (action, signal) => invoke(action, signal) })
			: new PhotoLibraryDevelopSettingsWorkflowCurrentV1({ execute: (action, signal) => invoke(action, signal) })) as SettingsOwnerForProfileV1<Profile>;
	}, [profile, captured]);
	const pending = useRef<Promise<void>>(Promise.resolve());
	const [view, setView] = useState(() => ({ owner, snapshot: owner.snapshot() }));
	useEffect(() => {
		owner.resume(); const unsubscribe = owner.subscribe(snapshot => { setView({ owner, snapshot }); });
		return () => { unsubscribe(); pending.current = joinPhotoLibraryRetirementV1([pending.current, owner.retire()]); void pending.current.catch(() => undefined); };
	}, [owner]);
	const drain = useCallback(() => joinPhotoLibraryRetirementV1([pending.current, owner.cancel()]), [owner]);
	return { owner, drain, snapshot: view.owner === owner ? view.snapshot : owner.snapshot() } as PhotoDevelopSettingsHookForProfileV1<Profile>;
}
