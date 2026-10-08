/* SPDX-License-Identifier: AGPL-3.0-only */

import { useCallback, useEffect, useRef, useState } from 'react';
import { PhotoLibraryRestoreV1 } from '../../controller/shared/photo-library-restore-v1.ts';
import type { LoadPhotoLibraryRestoreRuntimeV1, PhotoLibraryRestoreReceiptV1 } from '../../photo-library-restore-port-v1.ts';

export interface PhotoLibraryRestoreHookOptionsV1 {
	readonly loadRuntime?: LoadPhotoLibraryRestoreRuntimeV1;
	readonly retireAndJoin: () => Promise<void>;
	readonly onSettled: (receipt: Readonly<PhotoLibraryRestoreReceiptV1> | null) => void;
}

/** The opted-in dialog borrows one app-lifetime restore owner; Session epochs never clear its receipt. */
export function usePhotoLibraryRestore(options: PhotoLibraryRestoreHookOptionsV1) {
	const latest = useRef(options); latest.current = options;
	const owner = useRef<PhotoLibraryRestoreV1 | null>(null), alive = useRef(false);
	const [busy, setBusy] = useState(false), [cancelling, setCancelling] = useState(false), [cancelled, setCancelled] = useState(false);
	const [receipt, setReceipt] = useState<Readonly<PhotoLibraryRestoreReceiptV1> | null>(null), [error, setError] = useState<string | null>(null);
	useEffect(() => {
		const current = new PhotoLibraryRestoreV1(); owner.current = current; alive.current = true;
		return () => { alive.current = false; if (owner.current === current) owner.current = null; void current.close().catch(() => undefined); };
	}, []);
	const restore = useCallback(async (blob: Blob): Promise<Readonly<PhotoLibraryRestoreReceiptV1> | null> => {
		const current = owner.current, source = latest.current;
		if (!alive.current || !current || current.isPending() || !source.loadRuntime) return null;
		setBusy(true); setError(null); setCancelled(false); setCancelling(false);
		let retired = false, known: Readonly<PhotoLibraryRestoreReceiptV1> | null = null;
		try {
			known = await current.start({ blob, loadRuntime: source.loadRuntime,
				retireAndJoin: () => { retired = true; return source.retireAndJoin(); } });
			if (alive.current && owner.current === current) setReceipt(known);
			return known;
		} catch (failure) {
			if (alive.current && owner.current === current) {
				if (current.wasCancelled()) setCancelled(true); else setError(message(failure));
			}
			return null;
		} finally {
			if (alive.current && owner.current === current) {
				if (retired) { try { source.onSettled(known); } catch (failure) { setError(message(failure)); } }
				setBusy(false); setCancelling(false);
			}
		}
	}, []);
	const cancel = useCallback((): Promise<void> => {
		const current = owner.current;
		if (!current?.isPending()) return Promise.resolve();
		setCancelling(true); return current.cancelAndJoin();
	}, []);
	return { busy, cancelling, cancelled, receipt, error, ready: options.loadRuntime !== undefined, restore, cancel };
}

function message(error: unknown): string {
	try { const descriptor = error && typeof error === 'object' ? Object.getOwnPropertyDescriptor(error, 'message') : undefined;
		if (descriptor && Object.hasOwn(descriptor, 'value') && typeof descriptor.value === 'string') return descriptor.value.slice(0, 2048); }
	catch { /* Diagnostics cannot erase a durable receipt. */ }
	return 'Catalog restoration failed.';
}
