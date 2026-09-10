/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	connectProductNativeRenderInputAuthority,
	type ProductNativeRenderInputAuthorityBinding,
	type ProductNativeRenderInputOperation,
} from './product-native-render-input-authority.ts';
import {
	renderProductNativeAudioToSink,
	type ProductNativeRenderAudioStreamDependencies,
} from './internal/product-native-render-audio-stream.ts';
import {
	EDITOR_PROJECT_TASK_SCOPE,
	EditorProjectChangedError,
	type EditorControllerLifetime,
	type EditorProjectGeneration,
} from '../shared/lifecycle.ts';

type ProjectInput = ProductNativeRenderInputOperation['project'];
type RenderRange = Parameters<ProductNativeRenderInputOperation['renderAudio']>[1];

export interface NativeRenderInputDependencies<Project extends ProjectInput & { readonly id: string }, Buffers>
	extends Pick<ProductNativeRenderAudioStreamDependencies<Buffers>,
		'sourceBuffers' | 'createRenderEngine' | 'prepareCommittedTimePitchCaches'> {
	readonly lifetime: EditorControllerLifetime;
	readonly projectGeneration: EditorProjectGeneration;
	readonly getProject: () => Project | null;
	readonly cloneProject: (project: Project) => ProjectInput;
	readonly renderSnapshot: (
		project: ProjectInput, range: RenderRange, buffers: Buffers, signal: AbortSignal,
	) => Promise<unknown>;
}

/** Bind native rendering to the current revision and the project's cancellation scope. */
export function connectControllerNativeRenderInput<Project extends ProjectInput & { readonly id: string }, Buffers>(
	binding: ProductNativeRenderInputAuthorityBinding,
	dependencies: NativeRenderInputDependencies<Project, Buffers>,
): void {
	connectProductNativeRenderInputAuthority(binding, () => {
		const project = dependencies.getProject();
		if (!project) throw new Error('A current project is required for native render-input production.');
		const token = dependencies.projectGeneration.capture(project.id);
		const snapshot = dependencies.cloneProject(project);
		const task = dependencies.lifetime.startTask('product-native-render-input', { scope: EDITOR_PROJECT_TASK_SCOPE });
		const assertCurrent = () => {
			task.assertCurrent();
			dependencies.projectGeneration.assertCurrent(token);
			if (dependencies.getProject() !== project) throw new EditorProjectChangedError();
		};
		return Object.freeze({
			project: snapshot, signal: task.signal, assertCurrent, finish: task.finish,
			async renderAudio(renderProject: ProjectInput, range: RenderRange) {
				assertCurrent();
				const rendered = await dependencies.renderSnapshot(renderProject, range, dependencies.sourceBuffers, task.signal);
				assertCurrent();
				return rendered;
			},
			renderAudioToSink: (renderProject, range, sink) => renderProductNativeAudioToSink({
				...dependencies, signal: task.signal, assertCurrent,
			}, renderProject, range, sink),
		} satisfies ProductNativeRenderInputOperation);
	});
}
