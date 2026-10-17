/* SPDX-License-Identifier: AGPL-3.0-only */

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { PhotoLibraryCompareV1 } from '../../controller/shared/photo-library-compare-v1.ts';
import type { PhotoLibraryCullReceiptV1, PhotoLibraryCullSaveV1 } from '../../controller/shared/photo-library-culling-v1.ts';
import type { PhotoLibraryAttributePatchV1, PhotoLibraryPageV1, PhotoLibraryRowV1 } from '../../photo-library-session-port-v1.ts';

export interface PhotoCompareOptionsV1 {
	readonly generation: unknown;
	readonly queryIdentity: unknown;
	readonly page: Readonly<PhotoLibraryPageV1> | null;
	readonly enabled: boolean;
	readonly busy: boolean;
	readonly autoAdvance: boolean;
	readonly setRating: (photoId: string, rating: number, options?: Readonly<{ signal?: AbortSignal }>) => Promise<PhotoLibraryCullReceiptV1>;
	readonly applyAttributes: (photoId: string, changes: PhotoLibraryAttributePatchV1, options?: Readonly<{ signal?: AbortSignal }>) => Promise<PhotoLibraryCullReceiptV1>;
}
const CANCELLED: PhotoLibraryCullReceiptV1 = Object.freeze({ outcome: 'cancelled' });
const BUSY: PhotoLibraryCullReceiptV1 = Object.freeze({ outcome: 'busy' });

/** Observe the scalar Compare owner and borrow writes from the existing workflow. */
export function usePhotoCompare(options: PhotoCompareOptionsV1) {
	const owner = useRef<PhotoLibraryCompareV1 | null>(null); owner.current ??= new PhotoLibraryCompareV1();
	const controller = owner.current, alive = useRef(false);
	const context = useMemo(() => Object.freeze({ generation: options.generation, queryIdentity: options.queryIdentity, enabled: options.enabled }),
		[options.generation, options.queryIdentity, options.enabled]);
	const current = useRef({ options, context }); current.current = { options, context };
	const [snapshot, setSnapshot] = useState(() => controller.snapshot());
	const [requested, setRequested] = useState<typeof context | null>(null);
	const ids = JSON.stringify(options.enabled ? options.page?.rows.map(row => row.id) ?? [] : []);
	useLayoutEffect(() => {
		alive.current = true;
		const unsubscribe = controller.subscribe(setSnapshot);
		return () => { alive.current = false; unsubscribe(); void controller.close(); };
	}, [controller]);
	useLayoutEffect(() => {
		void controller.setPage(JSON.parse(ids) as string[], { generation: context, pageIdentity: options.enabled ? options.page : null });
	}, [controller, context, ids, options.enabled, options.page]);
	const isCurrent = useCallback(() => alive.current && current.current.context === context, [context]);
	const open = useCallback((selectedIds: readonly string[]) => {
		const active = current.current.options;
		if (!isCurrent() || !active.enabled || !active.page || active.busy || controller.snapshot().pendingPhotoId !== null) return;
		controller.open(selectedIds); setRequested(context);
	}, [controller, context, isCurrent]);
	const close = useCallback(() => {
		if (!isCurrent()) return Promise.resolve();
		setRequested(null); return controller.close();
	}, [controller, isCurrent]);
	const navigate = useCallback((action: 'next' | 'previous' | 'swap' | 'promoteCandidate') => {
		const view = controller.snapshot();
		if (isCurrent() && !current.current.options.busy && view.open && view.pendingPhotoId === null) controller[action]();
	}, [controller, isCurrent]);
	const cull = useCallback((photoId: string, save: PhotoLibraryCullSaveV1): Promise<PhotoLibraryCullReceiptV1> => {
		if (!isCurrent()) return Promise.resolve(CANCELLED);
		const active = current.current.options, view = controller.snapshot();
		if (active.busy || view.pendingPhotoId !== null) return Promise.resolve(BUSY);
		if (!active.enabled || !view.open || (photoId !== view.referenceId && photoId !== view.candidateId)) return Promise.resolve(CANCELLED);
		return controller.executeCull(photoId, save, { autoAdvance: active.autoAdvance });
	}, [controller, isCurrent]);
	const rate = useCallback((photoId: string, rating: number) => cull(photoId,
		signal => current.current.options.setRating(photoId, rating, { signal })), [cull]);
	const flag = useCallback((photoId: string, value: PhotoLibraryRowV1['flag']) => cull(photoId,
		signal => current.current.options.applyAttributes(photoId, { flag: value }, { signal })), [cull]);
	const label = useCallback((photoId: string, value: PhotoLibraryRowV1['colorLabel']) => cull(photoId,
		signal => current.current.options.applyAttributes(photoId, { colorLabel: value }, { signal })), [cull]);
	return { snapshot, notice: snapshot.notice,
		visible: requested === context && (snapshot.open || snapshot.pendingPhotoId !== null || snapshot.notice !== null),
		open, close, rate, flag, label,
		next: () => { navigate('next'); }, previous: () => { navigate('previous'); },
		swap: () => { navigate('swap'); }, promote: () => { navigate('promoteCandidate'); } };
}
