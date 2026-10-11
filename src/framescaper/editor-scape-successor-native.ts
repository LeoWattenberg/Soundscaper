/* SPDX-License-Identifier: AGPL-3.0-only */
import type { ControllerOptions } from '../common/editor/controller/composition/controller-options.ts';
import { assertFramescaperSuccessorEnvironment } from './editor-project-successor-environment.ts';
import { normalizeFramescaperSuccessorProject } from './editor-project-successor.ts';

/** Standard File actions retain successor custody; archive machinery stays outside startup. */
export function createFramescaperSuccessorScapeNativeRuntime(value: unknown): NonNullable<ControllerOptions['scapeProjectRuntime']> {
	const environment = assertFramescaperSuccessorEnvironment(value);
	const assertStore = (store: unknown) => {
		if (store !== environment.controllerStore) throw new TypeError('Successor File actions require their exact owning controller store.');
	};
	return Object.freeze({
		async inspectScapeProject(input, store, options, retention) {
			assertStore(store); options.signal.throwIfAborted();
			const operation = (async () => {
				const { inspectFramescaperSuccessorPortableArchive } = await import('./editor-project-successor-portable-inspect.ts');
				const result = await inspectFramescaperSuccessorPortableArchive(input, { signal: options.signal });
				const existing = await environment.owners.loadOwner(result.project.id); options.signal.throwIfAborted();
				return { ...result, id: result.project.id, title: result.project.title, schemaFamily: 'framescaper' as const,
					schemaVersion: 2, exists: existing !== null, featureRequirementsCompatibility: null };
			})();
			retention.retain(operation); return operation;
		},
		async importScapeProject(input, store, options) {
			assertStore(store); options.assertCurrent?.(); options.signal.throwIfAborted();
			const { importFramescaperSuccessorPortableArchive } = await import('./editor-project-successor-portable-import.ts');
			const result = await importFramescaperSuccessorPortableArchive(input, environment.store, {
				line: 'successor', signal: options.signal, assertCurrent: options.assertCurrent,
				estimateStorageForPreflight: options.estimateStorageForPreflight,
				collision: options.collision, acquireReplaceProjectWriteAuthority: options.acquireReplaceProjectWriteAuthority,
			});
			// Durable publication owns late cancellation; capture its history before activation.
			environment.invalidatePortableCustody(result.project.id);
			const project = await environment.controllerStore.loadProject(result.project.id);
			if (!project) throw new Error('The published successor owner is unavailable.');
			return { ...result, project: normalizeFramescaperSuccessorProject(project) };
		},
		async exportScapeProject(project, store, options) {
			assertStore(store); options.assertCurrent?.(); options.signal.throwIfAborted();
			const { exportFramescaperSuccessorPortableArchive } = await import('./editor-project-successor-portable-export.ts');
			return exportFramescaperSuccessorPortableArchive(project, environment.store, {
				readAsset: asset => environment.owners.readAsset(asset), signal: options.signal,
				createWritable: options.createWritable, assertCurrent: options.assertCurrent,
				confirmFileSizeWarning: options.confirmFileSizeWarning,
			});
		},
	});
}
