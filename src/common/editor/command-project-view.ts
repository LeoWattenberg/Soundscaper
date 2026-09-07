/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	brandRuntimeProjectProjection, resolveRuntimeClipProjection, resolveRuntimeProjectProjection,
	type RuntimeClipProject, type RuntimeProjectProjection,
} from './runtime-clip-projection.ts';

type DataRecord = Readonly<Record<string, unknown>>;
type SourceOf<Project> = Project extends { readonly sources: readonly (infer Source)[] } ? Source : DataRecord;
type CommandSource<Source> = Source extends { readonly kind: 'video'; readonly sampleFrameCount: infer Frames } ? {
	[Key in keyof Source as Key extends 'frameCount' ? never : Key]: Source[Key];
} & Readonly<{ frameCount: Frames }> : Source;

/** The command view replaces coordinates and adds video's legacy sample-count alias. */
export type CommandProjectView<Project extends RuntimeClipProject> = {
	[Key in keyof RuntimeProjectProjection<Project> as Key extends 'sources' ? never : Key]: RuntimeProjectProjection<Project>[Key];
} & Readonly<{ sources: readonly CommandSource<SourceOf<Project>>[] }>;

export function projectForCommand<Project extends RuntimeClipProject>(project: Project): CommandProjectView<Project>;
export function projectForCommand(project: RuntimeClipProject): RuntimeClipProject {
	const runtime = resolveRuntimeProjectProjection(project);
	const bin = record(project.projectBin, 'project.projectBin');
	if (!Array.isArray(bin.clips)) throw new TypeError('project.projectBin.clips must be an array.');
	const projected = {
		...runtime,
		sources: Array.isArray(project.sources) ? project.sources.map((value: unknown) => {
			const source = record(value, 'source');
			return source.kind === 'video' ? { ...source, frameCount: source.sampleFrameCount } : source;
		}) : [],
		projectBin: {
			...bin,
			clips: bin.clips.map((value: unknown) => resolveRuntimeClipProjection(project, record(value, 'project.projectBin.clips'))),
		},
	};
	return brandRuntimeProjectProjection(projected);
}

function record(value: unknown, name: string): DataRecord {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object.`);
	return value as DataRecord;
}
