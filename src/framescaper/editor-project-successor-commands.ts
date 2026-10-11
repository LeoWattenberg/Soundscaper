/* SPDX-License-Identifier: AGPL-3.0-only */
import { motionArray, motionDigest, motionId, motionRecord, freezeMotionValue } from '../common/editor/motion-values.ts';
import { applyFramescaperProjectCommand, snapshotFramescaperProjectCommand, type FramescaperProjectCommand, type FramescaperProjectCommandOptions } from './editor-project-commands.ts';
import { cloneFramescaperProject, type FramescaperProject } from './editor-project.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE } from './editor-project-runtime-profile.ts';
import { normalizeFramescaperSuccessorProject, type FramescaperSuccessorProject } from './editor-project-successor.ts';
import { createFramescaperCompositionSource } from './editor-composition-link-source.ts';
import { createMotionCompositionOffer } from '../common/editor/motion-link-protocol.ts';
import { normalizeFramescaperCompositionLink, type FramescaperCompositionLink } from './editor-project-successor-link.ts';
export interface FramescaperSuccessorLinkCommand {
	readonly type: 'composition-link/replace'; readonly sourceId: string; readonly expectedDigest: string | null;
	readonly link: FramescaperCompositionLink | null;
	/** Source insertion, exact placement or explicit conform shares this one validated history action. */
	readonly commands: readonly FramescaperProjectCommand[];
}
export type FramescaperSuccessorCommand = FramescaperProjectCommand | FramescaperSuccessorLinkCommand;
/** A transient authenticated timeline projection; never save this as the successor document. */
export function framescaperSuccessorBaselineProject(value: unknown): FramescaperProject {
	const { compositionLinks: _links, ...project } = normalizeFramescaperSuccessorProject(value);
	return cloneFramescaperProject(FRAMESCAPER_PROJECT_RUNTIME_PROFILE, { ...project, schemaVersion: 1 });
}
export function snapshotFramescaperSuccessorCommand(value: unknown): FramescaperSuccessorCommand {
	const type = value && typeof value === 'object' ? Object.getOwnPropertyDescriptor(value, 'type') : undefined;
	if (!type || !Object.hasOwn(type, 'value') || type.value !== 'composition-link/replace') return snapshotFramescaperProjectCommand(value);
	const record = motionRecord(value, ['type', 'sourceId', 'expectedDigest', 'link', 'commands'], 'Framescaper successor link command');
	const sourceId = motionId(record.sourceId); const link = record.link === null ? null : normalizeFramescaperCompositionLink(record.link);
	if (link && link.sourceId !== sourceId) throw new RangeError('Composition link source identity differs from its command.');
	return freezeMotionValue({ type: 'composition-link/replace' as const, sourceId,
		expectedDigest: record.expectedDigest === null ? null : motionDigest(record.expectedDigest), link,
		commands: motionArray(record.commands, 1024, 'link placement commands').map(snapshotFramescaperProjectCommand) });
}
export function applyFramescaperSuccessorCommand(value: unknown, commandValue: unknown, options: FramescaperProjectCommandOptions = {}): FramescaperSuccessorProject {
	const project = normalizeFramescaperSuccessorProject(value); const command = snapshotFramescaperSuccessorCommand(commandValue);
	const baseline = framescaperSuccessorBaselineProject(project);
	if (isLinkCommand(command)) {
		const prior = project.compositionLinks.find(({ sourceId }) => sourceId === command.sourceId);
		if ((prior?.acceptedDigest ?? null) !== command.expectedDigest) throw new Error('The accepted composition link changed; retry against the current project.');
		if (prior && command.link && (prior.projectId !== command.link.projectId || prior.compositionId !== command.link.compositionId)) throw new RangeError('A composition link update cannot replace its external identity.');
		let applied = command.commands.length ? applyFramescaperProjectCommand(FRAMESCAPER_PROJECT_RUNTIME_PROFILE, baseline,
			command.commands.length === 1 ? command.commands[0] : { type: 'batch', commands: command.commands }, options) : baseline;
		if (command.link) {
			const picture = applied.sources.find(source => source.id === command.sourceId);
			if (!picture) throw new RangeError('Composition publication requires its video placement source.');
			const descriptors = createFramescaperCompositionSource({ sourceId: command.sourceId, audioSourceId: command.link.audioSourceId,
				offer: createMotionCompositionOffer(command.link.compositionId, command.link.snapshot), sampleRate: Number(applied.sampleRate), name: String(picture.name) });
			applied = { ...applied, sources: applied.sources.map(source => source.id === command.sourceId && source.kind === 'video' ? { ...source, ...descriptors.source }
				: source.id === command.link?.audioSourceId ? { ...descriptors.audioSource!, name: source.name } : source) };
		}
		const revision = Number(project.revision) + 1; if (!Number.isSafeInteger(revision)) throw new RangeError('Framescaper successor revision overflowed.');
		const now = options.now === undefined ? new Date() : new Date(options.now); if (!Number.isFinite(now.getTime())) throw new TypeError('Framescaper successor command timestamp is invalid.');
		const links = project.compositionLinks.filter(({ sourceId }) => sourceId !== command.sourceId);
		if (command.link) links.push(command.link);
		return normalizeFramescaperSuccessorProject({ ...applied, revision, updatedAt: now.toISOString(), schemaVersion: 2, compositionLinks: links });
	}
	const applied = applyFramescaperProjectCommand(FRAMESCAPER_PROJECT_RUNTIME_PROFILE, baseline, command, options);
	const sourceIds = new Set(applied.sources.map(({ id }) => id));
	const links = project.compositionLinks.filter(({ sourceId }) => sourceIds.has(sourceId));
	for (const link of links) {
		for (const linkedId of [link.sourceId, link.audioSourceId].filter(id => id !== undefined)) {
			if (JSON.stringify(baseline.sources.find(({ id }) => id === linkedId)) !== JSON.stringify(applied.sources.find(({ id }) => id === linkedId))) throw new Error('Use the composition link conform or detach command before replacing a linked source.');
		}
	}
	return normalizeFramescaperSuccessorProject({ ...applied, schemaVersion: 2, compositionLinks: links });
}
function isLinkCommand(command: FramescaperSuccessorCommand): command is FramescaperSuccessorLinkCommand { return command.type === 'composition-link/replace'; }
