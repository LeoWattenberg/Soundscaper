/* SPDX-License-Identifier: AGPL-3.0-only */

import { createStableId } from '../common/editor/stable-id.js';
import { sampleFrameToVideoFrame } from '../common/editor/timeline-time.ts';
import {
	bindFramescaperCandidateAuthoringActionRuntime,
	createFramescaperCandidateAuthoringActionSubsetRuntime,
	framescaperCandidateAuthoringActionRuntimeFor,
	type FramescaperCandidateAuthoringSurface,
} from '../common/editor/ui/framescaper-candidate-authoring-actions.ts';
import {
	importFramescaperTimelineImagesV30,
	type FramescaperImageImportFileV30,
	type FramescaperTimelineImageImportResultV30,
} from './editor-image-import-coordinator-v30.ts';
import {
	createFramescaperTimelineImageCurrentProjectPublicationV30,
	type FramescaperTimelineImageCurrentProjectPublicationDependenciesV30,
	type FramescaperTimelineImagePublicationControllerV30,
} from './editor-timeline-image-current-project-publication-v30.ts';
import type { FramescaperProjectV30 } from './editor-project-v30.ts';

const IMAGE_ACCEPT = [
	'.jpg', '.jpeg', '.png', '.apng', '.gif', '.webp', '.bmp',
	'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp',
].join(',');

type ImportImages = typeof importFramescaperTimelineImagesV30;
type PublicationDependencies = Omit<
	FramescaperTimelineImageCurrentProjectPublicationDependenciesV30,
	'controller'
>;

export interface FramescaperSelectedImageFileServiceV30 {
	readonly isDesktop?: boolean;
	chooseFiles?(request: Readonly<{ readonly purpose: 'media'; readonly multiple: true }>): Promise<readonly unknown[]>;
	withReadDescriptors?<Result>(
		descriptors: readonly unknown[],
		request: Readonly<Record<string, never>>,
		consume: (files: readonly FramescaperImageImportFileV30[]) => PromiseLike<Result> | Result,
	): Promise<Result>;
}

export interface FramescaperSelectedImageAuthoringControllerV30
	extends FramescaperTimelineImagePublicationControllerV30 {
	readonly project: FramescaperProjectV30 | null;
	getTelemetrySnapshot(): Readonly<{ readonly positionFrame?: unknown }>;
}

export interface BindFramescaperSelectedImageAuthoringControllerV30Options
	extends PublicationDependencies {
	readonly controller: FramescaperSelectedImageAuthoringControllerV30;
	readonly fileService?: FramescaperSelectedImageFileServiceV30;
	readonly selectFiles?: () => Promise<readonly FramescaperImageImportFileV30[]>;
	readonly createId?: (prefix: string) => string;
	readonly importImages?: ImportImages;
	readonly schemaVersion?: 30 | 31;
}

const RESULTS = new WeakMap<object, FramescaperTimelineImageImportResultV30>();

export function framescaperSelectedImageImportResultV30For(
	owner: unknown,
): FramescaperTimelineImageImportResultV30 | null {
	return owner && (typeof owner === 'object' || typeof owner === 'function')
		? RESULTS.get(owner as object) ?? null : null;
}

/** Bind the V30 multi-file timeline import to Generate > Add Images only. */
export function bindFramescaperSelectedImageAuthoringControllerV30(
	options: BindFramescaperSelectedImageAuthoringControllerV30Options,
): void {
	const { controller } = options;
	const selectFiles = options.selectFiles ?? (() => selectImageFiles(options.fileService));
	const importImages = options.importImages ?? importFramescaperTimelineImagesV30;
	const publisher = createFramescaperTimelineImageCurrentProjectPublicationV30({
		controller,
		session: options.session,
		executeCommand: options.executeCommand,
		publishIfCurrent: options.publishIfCurrent,
		...(options.now ? { now: options.now } : {}),
	});
	let tail = Promise.resolve();
	const run = (): Promise<void> => {
		const operation = tail.then(importSelected, importSelected);
		tail = operation.then(() => undefined, () => undefined);
		return operation;
	};
	const inherited = framescaperCandidateAuthoringActionRuntimeFor(controller as object);
	const surfaces = inherited?.surfaces.includes('video-still')
		? inherited.surfaces
		: Object.freeze([...(inherited?.surfaces ?? []), 'video-still'] as const);
	const actions = Object.fromEntries(surfaces.map((surface) => [
		surface,
		surface === 'video-still' ? run : () => inherited!.run(surface),
	])) as Partial<Record<FramescaperCandidateAuthoringSurface, () => Promise<void>>>;
	bindFramescaperCandidateAuthoringActionRuntime(controller as object,
		createFramescaperCandidateAuthoringActionSubsetRuntime(surfaces, actions));

	async function importSelected(): Promise<void> {
		const files = await selectFiles();
		if (files.length === 0) return;
		const project = exactProject(controller.project, options.schemaVersion ?? 30);
		const playhead = playheadSample(controller.getTelemetrySnapshot().positionFrame);
		const sequence = project.sequences.find(({ id }) => id === project.primarySequenceId);
		if (!sequence) throw new ReferenceError('Add Images requires the primary Framescaper sequence.');
		const result = await importImages({
			project,
			files,
			sequenceStartFrame: sampleFrameToVideoFrame(
				playhead, sequence.rate, Number(project.sampleRate), 'enclosingStart',
			),
			createId: options.createId ?? createStableId,
			publisher,
		});
		RESULTS.set(controller as object, result);
		const failures = result.files.filter(({ status }) => status === 'failed');
		if (failures.length > 0) throw new Error(importFailureMessage(result));
	}
}

async function selectImageFiles(
	fileService: FramescaperSelectedImageFileServiceV30 | undefined,
): Promise<readonly FramescaperImageImportFileV30[]> {
	if (fileService?.isDesktop) {
		if (typeof fileService.chooseFiles !== 'function'
			|| typeof fileService.withReadDescriptors !== 'function') {
			throw new Error('Desktop Add Images requires bounded media read capabilities.');
		}
		const descriptors = await fileService.chooseFiles({ purpose: 'media', multiple: true });
		if (descriptors.length === 0) return Object.freeze([]);
		return fileService.withReadDescriptors(descriptors, {}, (files) => snapshotFiles(files));
	}
	if (!globalThis.document?.createElement || !globalThis.document.body) {
		throw new Error('Add Images requires a browser or desktop file picker.');
	}
	return new Promise((resolve) => {
		const input = globalThis.document.createElement('input');
		input.type = 'file'; input.multiple = true; input.accept = IMAGE_ACCEPT; input.hidden = true;
		let settled = false;
		const finish = (files: readonly FramescaperImageImportFileV30[]): void => {
			if (settled) return;
			settled = true; input.remove(); resolve(snapshotFiles(files));
		};
		input.addEventListener('change', () => finish([...input.files ?? []]), { once: true });
		input.addEventListener('cancel', () => finish([]), { once: true });
		globalThis.document.body.append(input);
		input.click();
	});
}

function snapshotFiles(value: readonly FramescaperImageImportFileV30[]): readonly FramescaperImageImportFileV30[] {
	if (!Array.isArray(value)) throw new TypeError('Add Images selection must be an array.');
	for (const file of value) {
		if (!file || typeof file !== 'object' || typeof file.arrayBuffer !== 'function') {
			throw new TypeError('Add Images received an invalid file capability.');
		}
	}
	return Object.freeze([...value]);
}

function exactProject(value: FramescaperProjectV30 | null, schemaVersion: 30 | 31): FramescaperProjectV30 {
	if (!value || Number(value.schemaVersion) !== schemaVersion) {
		throw new Error(`Add Images requires a writable Framescaper V${String(schemaVersion)} project.`);
	}
	return value;
}

function playheadSample(value: unknown): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) {
		throw new RangeError('Add Images requires an exact non-negative playhead sample.');
	}
	return Number(value);
}

function importFailureMessage(result: FramescaperTimelineImageImportResultV30): string {
	const imported = result.files.filter(({ status }) => status === 'imported').length;
	const details = result.files.filter(({ status }) => status === 'failed').map(({ fileName, message }) => (
		`${fileName}: ${message ?? 'Image import failed.'}`
	)).join('; ');
	return `Imported ${String(imported)} of ${String(result.files.length)} images. ${details}`;
}
