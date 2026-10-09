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
interface Owner { readonly generation: unknown; readonly retire: () => Promise<void> }
interface Retirement { readonly promise: Promise<void>; readonly demands: Set<Promise<void>>; revision: number }

/** The current menu entry owns one whole Workspace demand join before Restore may load its backend. */
export function usePhotoDevelopEntryV2(generation: unknown) {
	const [entry, setEntry] = useState<Entry | null>(null), [closing, setClosing] = useState(false);
	const latest = useRef(generation), live = useRef(true), blocked = useRef(false);
	const admission = useRef<Entry | null>(null), owner = useRef<Owner | null>(null);
	const drain = useRef<Promise<void>>(Promise.resolve()), retiring = useRef<Retirement | null>(null);
	latest.current = generation;
	const join = useCallback((retirement: Promise<void>) => {
		const current = retiring.current;
		if (current && retirement !== current.promise && !current.demands.has(retirement)) { current.demands.add(retirement); current.revision++; }
		drain.current = joinPhotoLibraryRetirementV1([drain.current, retirement]); void drain.current.catch(() => undefined); return drain.current;
	}, []);
	const retireAll = useCallback((presentation?: Promise<void>) => {
		const existing = retiring.current;
		if (existing) {
			if (presentation && presentation !== existing.promise) void join(presentation);
			return existing.promise;
		}
		const registered = owner.current, admitted = admission.current, previous = drain.current;
		if (!registered && !admitted && presentation === undefined) return previous;
		let resolve!: () => void, reject!: (error: unknown) => void;
		const pending = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
		const current: Retirement = { promise: pending, demands: new Set([previous]), revision: 0 };
		if (admitted) current.demands.add(admitted.beforePresent);
		if (presentation) current.demands.add(presentation);
		retiring.current = current; blocked.current = true;
		void pending.catch(() => undefined); void join(pending);
		if (live.current) { setClosing(true); setEntry(null); }
		if (registered) void join(registered.retire());
		void (async () => {
			for (;;) {
				const revision = current.revision;
				try { await joinPhotoLibraryRetirementV1([...current.demands]); }
				catch (error) { if (revision === current.revision) throw error; continue; }
				if (revision === current.revision) break;
			}
			if (owner.current === registered) owner.current = null;
			if (admission.current === admitted) admission.current = null;
			retiring.current = null; blocked.current = false;
			if (live.current) setClosing(false);
		})().then(resolve, reject);
		return pending;
	}, [join]);
	const register = useCallback(function(this: unknown, retire: () => Promise<void>) {
		const record: Owner = Object.freeze({ generation, retire: captureRetirement(retire, this) });
		if (!live.current || !Object.is(latest.current, generation) || blocked.current || !admission.current || !Object.is(admission.current.generation, generation)) {
			void join(record.retire()); return () => { void join(record.retire()); };
		}
		const previous = owner.current; owner.current = record;
		if (previous) void join(previous.retire());
		return () => { void join(record.retire()); if (owner.current === record) owner.current = null; };
	}, [generation, join]);
	useEffect(() => {
		live.current = true; setClosing(blocked.current);
		return () => { live.current = false; void retireAll(); };
	}, [generation, retireAll]);
	const isCurrent = () => live.current && Object.is(latest.current, generation);
	const begin = (photoId: string, label: string, preparePresentation: () => Promise<void>) => {
		if (!isCurrent() || blocked.current || admission.current !== null) return;
		let resolve!: (promise: Promise<void>) => void, reject!: (error: unknown) => void;
		const beforePresent = new Promise<void>((yes, no) => { resolve = yes; reject = no; }); void beforePresent.catch(() => undefined);
		const admitted = Object.freeze({ generation, photoId, label, beforePresent, beforeOpen: drain.current }); admission.current = admitted;
		try { resolve(preparePresentation()); } catch (error) { reject(error); }
		if (isCurrent() && !blocked.current && admission.current === admitted) setEntry(admitted);
	};
	const retireAndJoin = (presentation?: Promise<void>) => isCurrent() ? retireAll(presentation) : drain.current;
	const close = (presentation: Promise<void>) => { if (isCurrent()) void retireAll(presentation); };
	return { entry: entry && Object.is(entry.generation, generation) ? entry : null, closing, begin, close, register, retireAndJoin,
		isCurrent, isAdmitted: () => blocked.current || admission.current !== null };
}

function captureRetirement(method: () => Promise<void>, receiver: unknown): () => Promise<void> {
	let pending: Promise<void> | null = null;
	return () => {
		if (pending) return pending;
		let resolve!: () => void, reject!: (error: unknown) => void;
		pending = new Promise<void>((yes, no) => { resolve = yes; reject = no; }); void pending.catch(() => undefined);
		try { void Promise.resolve(Reflect.apply(method, receiver, []) as Promise<void>).then(resolve, reject); } catch (error) { reject(error); }
		return pending;
	};
}
