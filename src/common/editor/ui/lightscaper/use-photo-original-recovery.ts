/* SPDX-License-Identifier: AGPL-3.0-only */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { PhotoLibraryOriginalRecoveryV1 } from '../../controller/shared/photo-library-original-recovery-v1.ts';
import type { PhotoLibraryOriginalInspectionPageV1, PhotoLibraryOriginalRestorationReceiptV1,
	PhotoLibraryOriginalRestoreTargetV1 } from '../../photo-library-original-recovery-port-v1.ts';
import type { PhotoLibrarySessionPortV1 } from '../../photo-library-session-port-v1.ts';

export interface PhotoOriginalRecoveryContextV1 {
	readonly signal: AbortSignal;
	readonly acquire: () => Promise<PhotoLibrarySessionPortV1>;
	readonly refresh: () => Promise<void>;
	readonly isCurrent: () => boolean;
}
export type ExecutePhotoOriginalRecoveryV1 = (run: (context: PhotoOriginalRecoveryContextV1) => Promise<void>) => Promise<unknown>;
interface View {
	readonly generation: unknown;
	readonly page: PhotoLibraryOriginalInspectionPageV1 | null;
	readonly receipt: PhotoLibraryOriginalRestorationReceiptV1 | null;
	readonly active: boolean;
}
interface Demand {
	active: boolean;
	readonly generation: unknown;
	readonly isCurrent: () => boolean;
	readonly previousPage: PhotoLibraryOriginalInspectionPageV1 | null;
	readonly previousReceipt: PhotoLibraryOriginalRestorationReceiptV1 | null;
}

/** Presentation survives dialog dismissal; the borrowed controller owns pending bytes. */
export function usePhotoOriginalRecovery(options: Readonly<{ generation: unknown; controller: PhotoLibraryOriginalRecoveryV1;
	execute: ExecutePhotoOriginalRecoveryV1 }>) {
	const { generation, controller, execute } = options;
	const currentGeneration = useRef(generation); currentGeneration.current = generation;
	const observing = useRef<Demand | null>(null);
	const pageOwner = useRef<Readonly<{ generation: unknown; page: PhotoLibraryOriginalInspectionPageV1 }> | null>(null);
	const receiptOwner = useRef<Readonly<{ generation: unknown; receipt: PhotoLibraryOriginalRestorationReceiptV1 }> | null>(null);
	const [view, setView] = useState<View>({ generation, page: null, receipt: null, active: false });
	const [result, setResult] = useState<Readonly<{ generation: unknown; notice: 'refresh-failed' | null; cancelled: boolean }>>(
		{ generation, notice: null, cancelled: false });
	useEffect(() => controller.subscribe(snapshot => {
		const demand = observing.current;
		if (!demand || demand.generation !== currentGeneration.current || !demand.isCurrent()) return;
		// Phase changes may retain the controller's old catalog page and receipt.
		// Only new scalar identities can acquire this factory generation's owner.
		if (snapshot.page === null) pageOwner.current = null;
		else if (snapshot.page !== demand.previousPage) pageOwner.current = { generation: demand.generation, page: snapshot.page };
		if (snapshot.receipt === null) receiptOwner.current = null;
		else if (snapshot.receipt !== demand.previousReceipt) receiptOwner.current = { generation: demand.generation, receipt: snapshot.receipt };
		setView({ generation: demand.generation,
			page: pageOwner.current !== null && pageOwner.current.generation === demand.generation && pageOwner.current.page === snapshot.page ? snapshot.page : null,
			receipt: receiptOwner.current !== null && receiptOwner.current.generation === demand.generation && receiptOwner.current.receipt === snapshot.receipt ? snapshot.receipt : null,
			active: demand.active });
	}), [controller]);
	const executeDemand = useCallback(async (run: (context: PhotoOriginalRecoveryContextV1) => Promise<void>) => {
		const attempt: { demand: Demand | null } = { demand: null };
		const status = await execute(async context => {
			const previous = controller.getSnapshot(), demand: Demand = { generation, isCurrent: context.isCurrent,
				previousPage: previous.page, previousReceipt: previous.receipt, active: true };
			attempt.demand = demand;
			observing.current = demand; setResult({ generation, notice: null, cancelled: false });
			setView({ generation, active: true, page: pageOwner.current !== null && pageOwner.current.generation === generation ? pageOwner.current.page : null,
				receipt: receiptOwner.current !== null && receiptOwner.current.generation === generation ? receiptOwner.current.receipt : null });
			try { await run(context); }
			finally {
				demand.active = false;
				if (observing.current === demand && context.isCurrent()) setView(current => ({ ...current, active: false }));
			}
		});
		const demand = attempt.demand;
		if (status === 'cancelled' && demand && observing.current === demand && demand.isCurrent()
			&& generation === currentGeneration.current) {
			// Factory acquisition can be cancelled before the body controller starts.
			// A later refresh cancellation keeps its durable receipt and notice.
			setResult(current => current.generation === generation && current.notice !== null ? current
				: { generation, notice: null, cancelled: true });
		}
	}, [controller, execute, generation]);
	const inspectOriginals = useCallback(async (cursor: string | null = null): Promise<void> => {
		await executeDemand(async context => {
			const owner = await context.acquire(); context.signal.throwIfAborted();
			const outcome = await controller.startInspection({ cursor, signal: context.signal,
				inspectOriginals: request => owner.inspectOriginals(request) });
			if (context.isCurrent()) setResult({ generation, notice: null, cancelled: 'status' in outcome });
		});
	}, [controller, executeDemand, generation]);
	const restoreOriginalBody = useCallback(async (target: PhotoLibraryOriginalRestoreTargetV1,
		file: File): Promise<PhotoLibraryOriginalRestorationReceiptV1 | null> => {
		let receipt: PhotoLibraryOriginalRestorationReceiptV1 | null = null;
		await executeDemand(async context => {
			const owner = await context.acquire(); context.signal.throwIfAborted();
			const outcome = await controller.startRestore({ target, file, signal: context.signal,
				restoreOriginalBody: (binding, body, request) => owner.restoreOriginalBody(binding, body, request) });
			if ('status' in outcome) {
				if (context.isCurrent()) setResult({ generation, notice: null, cancelled: true });
				return;
			}
			receipt = outcome;
			if (!context.isCurrent()) return;
			setResult({ generation, notice: null, cancelled: false });
			// The Session has returned its writer lease. Strict startup recovery may
			// now run independently; its failure cannot revoke the body receipt.
			try { context.signal.throwIfAborted(); await context.refresh(); context.signal.throwIfAborted(); }
			catch (error) {
				if (context.isCurrent()) setResult({ generation, notice: 'refresh-failed', cancelled: false });
				throw error;
			}
		});
		return receipt;
	}, [controller, executeDemand, generation]);
	return {
		originalInspectionPage: view.generation === generation ? view.page : null,
		originalRestorationReceipt: view.generation === generation ? view.receipt : null,
		originalRecoveryActive: view.generation === generation && view.active,
		originalRestorationNotice: result.generation === generation ? result.notice : null,
		originalRecoveryCancelled: result.generation === generation && result.cancelled,
		inspectOriginals, restoreOriginalBody,
	};
}
