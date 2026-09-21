/* SPDX-License-Identifier: AGPL-3.0-only */

import { createStableId } from '../../stable-id.js';
import {
	createFreesoundImportService,
	type FreesoundImportRequest,
	type FreesoundImportServiceRuntime,
} from '../../controller/import/freesound-import-service.ts';
import type { EditorProjectToken } from '../../controller/shared/lifecycle.ts';

interface FreesoundWorkspaceSnapshot {
	readonly productId: string;
	readonly readOnly?: boolean;
	readonly importing?: boolean;
	readonly project?: Readonly<{ readonly id: string }> | null;
}

export interface FreesoundWorkspaceController {
	readonly actions: Readonly<{
		readonly project: Readonly<{
			importFiles(files: File[], options?: Readonly<Record<string, unknown>>): Promise<unknown> | unknown;
		}>;
	}>;
	readonly getSnapshot: () => FreesoundWorkspaceSnapshot;
	readonly captureProjectGeneration: (projectId?: string | null) => EditorProjectToken;
	readonly assertProjectGeneration: (token: EditorProjectToken) => void;
}

export type FreesoundWorkspaceRuntime = Readonly<Pick<
	FreesoundImportServiceRuntime,
	'apiBaseUrl' | 'fetch' | 'maximumPreviewBytes'
>>;

const activeImports = new WeakMap<FreesoundWorkspaceController, EditorProjectToken>();
const services = new WeakMap<
	FreesoundWorkspaceController,
	ReturnType<typeof createFreesoundWorkspaceActions>
>();

/** Build the Freesound port only after an optional workspace surface asks for it. */
export function createFreesoundWorkspaceActions(
	controller: FreesoundWorkspaceController,
	runtime: FreesoundWorkspaceRuntime = {},
) {
	const service = createFreesoundImportService({
		enabled: controller.getSnapshot().productId === 'soundscaper',
		...runtime,
		createContributionId: () => createStableId('attribution'),
		importFile: async (file, options, assertProjectCurrent) => {
			assertProjectCurrent?.();
			return controller.actions.project.importFiles([file], options);
		},
	});

	return Object.freeze({
		search: service.search,
		importSound: async (request: FreesoundImportRequest) => {
			request.signal?.throwIfAborted();
			const snapshot = controller.getSnapshot();
			if (snapshot.productId !== 'soundscaper') {
				throw new Error('Freesound is unavailable for this product.');
			}
			if (activeImports.has(controller)) {
				throw new Error('A Freesound import is already in progress.');
			}
			if (snapshot.importing) throw new Error('Editing is blocked during Freesound import.');
			if (snapshot.readOnly) throw new Error('The project is read-only.');
			const projectId = snapshot.project?.id;
			if (!projectId) throw new Error('Freesound import requires an open project.');
			const projectToken = controller.captureProjectGeneration(projectId);
			activeImports.set(controller, projectToken);
			const assertProjectCurrent = () => {
				request.signal?.throwIfAborted();
				if (activeImports.get(controller) !== projectToken) {
					throw new Error('Freesound import admission is no longer current.');
				}
				const current = controller.getSnapshot();
				if (current.importing) throw new Error('Another import began during the Freesound import.');
				if (current.readOnly) throw new Error('The project became read-only during Freesound import.');
				if (current.project?.id !== projectId) {
					throw new Error('The project changed during Freesound import.');
				}
				try { controller.assertProjectGeneration(projectToken); }
				catch (error) { throw new Error('The project changed during Freesound import.', { cause: error }); }
			};
			try {
				return await service.importSound(request, assertProjectCurrent);
			} finally {
				if (activeImports.get(controller) === projectToken) activeImports.delete(controller);
			}
		},
	});
}

export function freesoundWorkspaceActions(controller: FreesoundWorkspaceController) {
	let actions = services.get(controller);
	if (!actions) {
		actions = createFreesoundWorkspaceActions(controller);
		services.set(controller, actions);
	}
	return actions;
}

export function importFreesoundSound(
	controller: FreesoundWorkspaceController,
	request: FreesoundImportRequest,
): Promise<unknown> {
	return freesoundWorkspaceActions(controller).importSound(request);
}
