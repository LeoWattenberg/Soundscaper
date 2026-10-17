/* SPDX-License-Identifier: AGPL-3.0-only */
import { freezeMotionValue, motionArray, motionRecord } from '../common/editor/motion-values.ts';
import { createEditorProjectStorageProfile } from '../common/editor/storage/project-storage-profile.ts';
import { VIDEO_TIMING_ASSET_MAXIMUM_FRAMES } from '../common/editor/video-timing-asset-reference.ts';
import { cloneFramescaperProject, FRAMESCAPER_PROJECT_FIELDS, type FramescaperProject } from './editor-project.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE } from './editor-project-runtime-profile.ts';
import { normalizeFramescaperCompositionLink, type FramescaperCompositionLink } from './editor-project-successor-link.ts';

export const FRAMESCAPER_SUCCESSOR_STORAGE_PROFILE = createEditorProjectStorageProfile({
	databaseName: 'kw-media-framescaper-editor-v2', opfsDirectoryName: 'framescaper-editor-v2-sources',
	opfsWorkerName: 'framescaper-editor-v2-opfs-storage', projectLockPrefix: 'kw-media-framescaper-editor-v2-lock:',
});
export type FramescaperSuccessorProject = Omit<FramescaperProject, 'schemaVersion'> & {
	readonly id: string; readonly title: string;
	readonly sources: FramescaperProject['sources']; readonly clips: FramescaperProject['clips'];
	readonly schemaVersion: 2; readonly compositionLinks: readonly FramescaperCompositionLink[];
};
export function migrateFramescaperSuccessorProject(value: unknown): FramescaperSuccessorProject {
	const project = cloneFramescaperProject(FRAMESCAPER_PROJECT_RUNTIME_PROFILE, value);
	return freezeMotionValue({ ...project, schemaVersion: 2 as const, compositionLinks: [] });
}
export function normalizeFramescaperSuccessorProject(value: unknown): FramescaperSuccessorProject {
	const record = motionRecord(value, [...FRAMESCAPER_PROJECT_FIELDS, 'compositionLinks'], 'Framescaper successor project');
	if (record.schemaVersion !== 2) throw new RangeError('Framescaper successor requires family schema version 2.');
	const { compositionLinks, ...baseline } = record;
	const project = cloneFramescaperProject(FRAMESCAPER_PROJECT_RUNTIME_PROFILE, { ...baseline, schemaVersion: 1 });
	const links = motionArray(compositionLinks, 16384, 'composition links').map(normalizeFramescaperCompositionLink);
	// Live activation and portable planning retain all generated linked timing tables together.
	if (links.reduce((sum, link) => sum + BigInt(link.output.durationFrames), 0n) > BigInt(VIDEO_TIMING_ASSET_MAXIMUM_FRAMES)) throw new RangeError('Successor project exceeds its aggregate generated timing-frame budget.');
	const sourceIds = new Set(project.sources.map((source) => source.id));
	const linked = new Set<string>();
	for (const link of links) {
		if (!sourceIds.has(link.sourceId) || linked.has(link.sourceId)) throw new RangeError('Composition link requires one unique existing source.');
		linked.add(link.sourceId);
		if (link.audioSourceId !== undefined) {
			if (linked.has(link.audioSourceId) || !project.sources.some(source => source.id === link.audioSourceId && source.kind === 'audio')) throw new RangeError('Composition companion audio requires one unique existing audio source.');
			linked.add(link.audioSourceId);
		}
	}
	return freezeMotionValue({ ...project, schemaVersion: 2 as const, compositionLinks: links });
}
export function assertFramescaperSuccessorLine(line: unknown): void {
	if (line !== 'successor') throw new RangeError('Framescaper v2 migration requires the explicit 1.1 successor development line.');
}
