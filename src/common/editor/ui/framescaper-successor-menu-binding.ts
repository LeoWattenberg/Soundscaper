/* SPDX-License-Identifier: AGPL-3.0-only */
import type { createFramescaperSuccessorController } from '../../../framescaper/editor-successor-controller.ts';
import { framescaperSuccessorControllerContext } from '../../../framescaper/editor-successor-controller.ts';
import { bindFramescaperSuccessorMenuRuntime } from './framescaper-successor-menu-runtime.ts';
type Controller = ReturnType<typeof createFramescaperSuccessorController>;
/** Menu actions own lazy dialogs; closing a dialog does not disconnect a saved-revision session. */
export function createFramescaperSuccessorMenuBinding(controller: Controller) {
	let loaded: Promise<typeof import('./FramescaperCompositionLinksDialog.tsx')> | null = null;
	let disposed = false;
	const unbind = bindFramescaperSuccessorMenuRuntime(controller, {
		async openLinks() {
			loaded ??= import('./FramescaperCompositionLinksDialog.tsx'); const module = await loaded;
			if (!disposed) module.openFramescaperCompositionLinksDialog(controller, framescaperSuccessorControllerContext(controller));
		},
		async openMigration() {
			const module = await import('./framescaper-successor-migration-dialog.tsx');
			if (!disposed) module.openFramescaperSuccessorMigrationDialog(async id => { await controller.actions.project.openById(id, { adoptSessionRevision: true }); });
		},
	});
	return { async dispose() { disposed = true; unbind(); await (await loaded)?.disposeFramescaperCompositionLinks(controller); } };
}
