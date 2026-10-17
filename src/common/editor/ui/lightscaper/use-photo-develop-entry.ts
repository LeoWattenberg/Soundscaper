/* SPDX-License-Identifier: AGPL-3.0-only */

import { useCallback, useEffect, useRef, useState } from 'react';
import { joinPhotoLibraryRetirementV1 } from '../../controller/shared/photo-library-workflow-slot.ts';

interface Entry {
	readonly generation: unknown;
	readonly photoId: string;
	readonly label: string;
	readonly beforeOpen: Promise<void>;
	readonly beforePresent: Promise<void>;
}

/** Carries the existing scalar demand drain across hidden/remounted workspaces. */
export function usePhotoDevelopEntry(generation: unknown) {
	const [entry, setEntry] = useState<Entry | null>(null), [closing, setClosing] = useState(false);
	const latest = useRef(generation), live = useRef(true), blocked = useRef(false), admission = useRef<Readonly<{ generation: unknown }> | null>(null);
	const drain = useRef<Promise<void>>(Promise.resolve());
	const owner = useRef<Readonly<{ generation: unknown; retire: () => Promise<void> }> | null>(null);
	latest.current = generation;
	if (admission.current !== null && !Object.is(admission.current.generation, generation)) admission.current = null;
	const join = useCallback((retirement: Promise<void>) => {
		drain.current = joinPhotoLibraryRetirementV1([drain.current, retirement]); void drain.current.catch(() => undefined);
		return drain.current;
	}, []);
	const register = useCallback((retire: () => Promise<void>) => {
		const record = Object.freeze({ generation, retire }); owner.current = record;
		return () => { void join(retire()); if (owner.current === record) owner.current = null; };
	}, [generation, join]);
	useEffect(() => { live.current = true; return () => { live.current = false; if (owner.current) void join(owner.current.retire()); }; }, [join]);
	const begin = (photoId: string, label: string, preparePresentation: () => Promise<void>) => {
		if (!live.current || blocked.current || !Object.is(latest.current, generation) || admission.current !== null) return;
		admission.current = Object.freeze({ generation }); let beforePresent: Promise<void>;
		try { beforePresent = preparePresentation(); } catch (error) { beforePresent = Promise.reject(error); }
		void beforePresent.catch(() => undefined);
		setEntry(Object.freeze({ generation, photoId, label, beforePresent, beforeOpen: drain.current }));
	};
	const close = (presentation: Promise<void>) => {
		if (!live.current || !Object.is(latest.current, generation) || !admission.current || !Object.is(admission.current.generation, generation) || blocked.current) return;
		blocked.current = true; setClosing(true); setEntry(null);
		const retiring = join(joinPhotoLibraryRetirementV1([owner.current?.retire() ?? null, presentation]));
		void retiring.then(() => {
			blocked.current = false; if (!live.current) return; setClosing(false);
			if (Object.is(latest.current, generation)) admission.current = null;
		}, () => { /* Failed cleanup keeps replacement resource admission blocked. */ });
	};
	return { entry: entry && Object.is(entry.generation, generation) ? entry : null, closing, begin, close, register,
		isCurrent: () => live.current && Object.is(latest.current, generation),
		isAdmitted: () => blocked.current || admission.current !== null };
}
