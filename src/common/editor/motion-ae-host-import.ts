/* SPDX-License-Identifier: AGPL-3.0-only */
import type { MotionAeImportComposition, MotionAeImportFootage, MotionAeImportLayer, MotionAeImportPlan } from './motion-ae-host-import-plan.ts';
export interface MotionAeImportTransaction {
	footage(item: MotionAeImportFootage): void; composition(item: MotionAeImportComposition): void;
	layer(composition: MotionAeImportComposition, layer: MotionAeImportLayer): void;
	parent(layer: MotionAeImportLayer): void; properties(layer: MotionAeImportLayer): void;
	finish(): void; rollback(): void;
}
export interface MotionAeImportHost {
	checkCancelled(): void; verifyMedia(footage: readonly MotionAeImportFootage[]): void;
	begin(plan: MotionAeImportPlan): MotionAeImportTransaction;
}
/** Input must come from prepareMotionAeHostImport. All created AE objects remain transaction-owned. */
export function importMotionAeHostPlan(plan: MotionAeImportPlan, host: MotionAeImportHost): void {
	host.checkCancelled(); host.verifyMedia(plan.footage); host.checkCancelled(); const transaction = host.begin(plan);
	try {
		for (let index = 0; index < plan.footage.length; index++) { host.checkCancelled(); transaction.footage(plan.footage[index]!); }
		for (let index = 0; index < plan.compositions.length; index++) { host.checkCancelled(); transaction.composition(plan.compositions[index]!); }
		for (let index = 0; index < plan.compositions.length; index++) {
			const comp = plan.compositions[index]!;
			for (let layer = comp.layers.length - 1; layer >= 0; layer--) { host.checkCancelled(); transaction.layer(comp, comp.layers[layer]!); }
		}
		for (let index = 0; index < plan.compositions.length; index++) {
			const comp = plan.compositions[index]!;
			for (let layer = 0; layer < comp.layers.length; layer++) {
				host.checkCancelled(); const item = comp.layers[layer]!; if (item.parentId !== null) transaction.parent(item); transaction.properties(item);
			}
		}
		host.checkCancelled(); transaction.finish();
	} catch (error) {
		try { transaction.rollback(); } catch (cleanup) {
			const cause = { primary: error, cleanup }, failure = new Error('AE import failed: ' + String(error) + '; removal of created objects failed: ' + String(cleanup), { cause });
			failure.cause = cause; throw failure;
		}
		throw error;
	}
}
