/* SPDX-License-Identifier: AGPL-3.0-only */

interface WorkspaceFileChoiceRuntime {
	getProjectId(): string | null;
	readonly fileService: Readonly<{
		chooseFiles(request: Readonly<{ purpose: string; multiple: boolean }>): PromiseLike<readonly unknown[]>;
		withReadDescriptors(
			descriptors: readonly unknown[],
			request: Readonly<Record<string, never>>,
			consume: (files: readonly File[]) => Promise<number>,
		): PromiseLike<number>;
	}>;
	openProjectDescriptor(descriptor: unknown): PromiseLike<unknown> | unknown;
	importFiles(files: readonly File[], options: Readonly<Record<string, unknown>>): PromiseLike<unknown> | unknown;
}

/** Keep a selected media handoff within the project that opened its chooser. */
export async function openDesktopWorkspaceFiles(
	runtime: WorkspaceFileChoiceRuntime,
	purpose: string,
	multiple = false,
	importOptions: Readonly<Record<string, unknown>> = {},
): Promise<number> {
	const projectId = runtime.getProjectId();
	const descriptors = await runtime.fileService.chooseFiles({ purpose, multiple });
	if (purpose === 'project') {
		for (const descriptor of descriptors) await runtime.openProjectDescriptor(descriptor);
		return descriptors.length;
	}
	return runtime.fileService.withReadDescriptors(descriptors, {}, async files => {
		// Enter the read owner even after a project switch so it retires the
		// selected capabilities; only their publication loses admission.
		if (runtime.getProjectId() !== projectId) return 0;
		if (files.length) await runtime.importFiles(files, importOptions);
		return files.length;
	});
}
