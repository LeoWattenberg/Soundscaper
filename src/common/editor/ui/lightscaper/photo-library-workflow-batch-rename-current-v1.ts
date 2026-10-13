/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoLibraryBatchRenamePortV1 } from '../../photo-library-batch-rename-port-v1.ts';

const CHECK = AbortSignal.prototype.throwIfAborted;

/** Capture the complete named Current child before selection or native edits
 * yield. The permanent scalar Session methods retain their legacy admission. */
export function capturePhotoLibraryBatchRenameCurrentV1(session: object,
	signal?: AbortSignal): Readonly<PhotoLibraryBatchRenamePortV1> {
	const check = () => { if (signal !== undefined) Reflect.apply(CHECK, signal, []); };
	check();
	try {
		const descriptor = Object.getOwnPropertyDescriptor(session, 'batchRenameCurrent');
		const child: unknown = descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
		if (typeof child !== 'object' || child === null) throw new Error('Current photo batch rename is unavailable.');
		const read = captureMethod(child, 'readBatchRenameSelection'), plan = captureMethod(child, 'planBatchRename');
		const rename = captureMethod(child, 'renamePhotos'), undo = captureMethod(child, 'undoBatchRename');
		check();
		return Object.freeze<PhotoLibraryBatchRenamePortV1>({
			readBatchRenameSelection(ids, options) { return Reflect.apply(read, child, [ids, options]) as ReturnType<typeof read>; },
			planBatchRename(request) { return Reflect.apply(plan, child, [request]) as ReturnType<typeof plan>; },
			renamePhotos(request, options) { return Reflect.apply(rename, child, [request, options]) as ReturnType<typeof rename>; },
			undoBatchRename(request, options) { return Reflect.apply(undo, child, [request, options]) as ReturnType<typeof undo>; },
		});
	} catch (error) { check(); throw error; }
}

function captureMethod<Key extends keyof PhotoLibraryBatchRenamePortV1>(child: object, key: Key): PhotoLibraryBatchRenamePortV1[Key] {
	const descriptor = Object.getOwnPropertyDescriptor(child, key);
	const method: unknown = descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
	if (typeof method !== 'function') throw new TypeError('Current photo batch rename requires its complete native capability.');
	return method as PhotoLibraryBatchRenamePortV1[Key];
}
