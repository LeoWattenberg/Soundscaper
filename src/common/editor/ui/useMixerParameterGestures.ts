/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, useRef, useState } from 'react';
import { canonicalParameterAddressKey, type ParameterAddress } from '../parameter-address.ts';

export interface MixerParameterActions {
	beginParameterGesture(address: ParameterAddress): number;
	previewParameterGesture(address: ParameterAddress, value: number): unknown;
	commitParameterGesture(address: ParameterAddress, value: number): unknown;
	cancelParameterGesture(address: ParameterAddress): unknown;
}

/** Keep the visible draft separate from the document until a strip gesture ends. */
export function useMixerParameterGestures(actions: MixerParameterActions, projectId: string | null, onError: (error: unknown) => void) {
	const [drafts, setDrafts] = useState<ReadonlyMap<string, number>>(new Map());
	const active = useRef(new Map<string, ParameterAddress>());
	const report = useRef(onError);
	report.current = onError;
	const clear = (key: string) => {
		active.current.delete(key);
		setDrafts((current) => { const next = new Map(current); next.delete(key); return next; });
	};
	useEffect(() => {
		setDrafts(new Map());
		const gestures = active.current;
		return () => {
			for (const address of gestures.values()) {
				try { actions.cancelParameterGesture(address); } catch (error) { report.current(error); }
			}
			gestures.clear();
		};
	}, [actions, projectId]);
	const begin = (address: ParameterAddress) => {
		const key = canonicalParameterAddressKey(address);
		if (active.current.has(key)) return true;
		try {
			const value = actions.beginParameterGesture(address);
			active.current.set(key, address);
			setDrafts((current) => new Map(current).set(key, value));
			return true;
		} catch (error) { report.current(error); return false; }
	};
	const cancel = (address: ParameterAddress) => {
		const key = canonicalParameterAddressKey(address);
		if (!active.current.has(key)) return false;
		try { actions.cancelParameterGesture(address); } catch (error) { report.current(error); }
		clear(key);
		return true;
	};
	const preview = (address: ParameterAddress, value: number) => {
		const key = canonicalParameterAddressKey(address);
		if (!active.current.has(key)) return false;
		try {
			actions.previewParameterGesture(address, value);
			setDrafts((current) => new Map(current).set(key, value));
		} catch (error) { cancel(address); report.current(error); }
		return true;
	};
	const release = (address: ParameterAddress, value: number) => {
		const key = canonicalParameterAddressKey(address);
		if (!active.current.has(key)) return false;
		try { actions.commitParameterGesture(address, value); } catch (error) { cancel(address); report.current(error); }
		clear(key);
		return true;
	};
	return {
		value: (address: ParameterAddress, fallback: number) => drafts.get(canonicalParameterAddressKey(address)) ?? fallback,
		begin, preview, release, cancel,
	};
}
