/* SPDX-License-Identifier: AGPL-3.0-only */
export interface FramescaperSuccessorMenuRuntime { openLinks(): Promise<void>; openMigration(): Promise<void>; openNativeDelivery?(): Promise<void> }
const runtimes = new WeakMap<object, FramescaperSuccessorMenuRuntime>();
export function bindFramescaperSuccessorMenuRuntime(controller: object, runtime: FramescaperSuccessorMenuRuntime): () => void {
	if (runtimes.has(controller)) throw new Error('Successor menu runtime is already bound.');
	runtimes.set(controller, runtime); return () => { if (runtimes.get(controller) === runtime) runtimes.delete(controller); };
}
export function framescaperSuccessorMenuRuntimeFor(controller: unknown): FramescaperSuccessorMenuRuntime | null {
	return controller && typeof controller === 'object' ? runtimes.get(controller) ?? null : null;
}
