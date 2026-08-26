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
	importFramescaperTimelineImagesV32,
	type FramescaperImageImportFileV32,
	type FramescaperTimelineImageImportResultV32,
} from './editor-image-import-coordinator-v32.ts';
import {
	createFramescaperTimelineImageCurrentProjectPublicationV32,
	type FramescaperTimelineImageCurrentProjectPublicationDependenciesV32,
	type FramescaperTimelineImagePublicationControllerV32,
} from './editor-timeline-image-current-project-publication-v32.ts';
import type { FramescaperProjectV32 } from './editor-project-v32.ts';

const IMAGE_ACCEPT = [
	'.jpg', '.jpeg', '.png', '.apng', '.gif', '.webp', '.bmp',
	'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp',
].join(',');

type ImportImages = typeof importFramescaperTimelineImagesV32;
type PublicationDependencies = Omit<
	FramescaperTimelineImageCurrentProjectPublicationDependenciesV32,
	'controller'
>;

export interface FramescaperSelectedImageFileServiceV32 {
	readonly isDesktop?: boolean;
	chooseFiles?(request: Readonly<{ readonly purpose: 'media'; readonly multiple: true }>): Promise<readonly unknown[]>;
	withReadDescriptors?<Result>(
		descriptors: readonly unknown[],
		request: Readonly<Record<string, never>>,
		consume: (files: readonly FramescaperImageImportFileV32[]) => PromiseLike<Result> | Result,
	): Promise<Result>;
}

export interface FramescaperSelectedImageAuthoringControllerV32
	extends FramescaperTimelineImagePublicationControllerV32 {
	readonly project: FramescaperProjectV32 | null;
	getTelemetrySnapshot(): Readonly<{ readonly positionFrame?: unknown }>;
}

export interface BindFramescaperSelectedImageAuthoringControllerV32Options
	extends PublicationDependencies {
	readonly controller: FramescaperSelectedImageAuthoringControllerV32;
	readonly fileService?: FramescaperSelectedImageFileServiceV32;
	readonly selectFiles?: () => Promise<readonly FramescaperImageImportFileV32[]>;
	readonly createId?: (prefix: string) => string;
	readonly importImages?: ImportImages;
	readonly schemaVersion?: 32 | 31;
}

const RESULTS = new WeakMap<object, FramescaperTimelineImageImportResultV32>();

export function framescaperSelectedImageImportResultV32For(
	owner: unknown,
): FramescaperTimelineImageImportResultV32 | null {
	return owner && (typeof owner === 'object' || typeof owner === 'function')
		? RESULTS.get(owner as object) ?? null : null;
}

/** Bind the V32 multi-file timeline import to Generate > Add Images only. */
export function bindFramescaperSelectedImageAuthoringControllerV32(
	options: BindFramescaperSelectedImageAuthoringControllerV32Options,
): void {
	const { controller } = options;
	const selectFiles = options.selectFiles ?? (() => selectImageFiles(options.fileService));
	const importImages = options.importImages ?? importFramescaperTimelineImagesV32;
	const publisher = createFramescaperTimelineImageCurrentProjectPublicationV32({
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
		const project = exactProject(controller.project, options.schemaVersion ?? 32);
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
	fileService: FramescaperSelectedImageFileServiceV32 | undefined,
): Promise<readonly FramescaperImageImportFileV32[]> {
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
		const finish = (files: readonly FramescaperImageImportFileV32[]): void => {
			if (settled) return;
			settled = true; input.remove(); resolve(snapshotFiles(files));
		};
		input.addEventListener('change', () => finish([...input.files ?? []]), { once: true });
		input.addEventListener('cancel', () => finish([]), { once: true });
		globalThis.document.body.append(input);
		input.click();
	});
}

function snapshotFiles(value: readonly FramescaperImageImportFileV32[]): readonly FramescaperImageImportFileV32[] {
	if (!Array.isArray(value)) throw new TypeError('Add Images selection must be an array.');
	for (const file of value) {
		if (!file || typeof file !== 'object' || typeof file.arrayBuffer !== 'function') {
			throw new TypeError('Add Images received an invalid file capability.');
		}
	}
	return Object.freeze([...value]);
}

function exactProject(value: FramescaperProjectV32 | null, schemaVersion: 32 | 31): FramescaperProjectV32 {
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

function importFailureMessage(result: FramescaperTimelineImageImportResultV32): string {
	const imported = result.files.filter(({ status }) => status === 'imported').length;
	const details = result.files.filter(({ status }) => status === 'failed').map(({ fileName, message }) => (
		`${fileName}: ${message ?? 'Image import failed.'}`
	)).join('; ');
	return `Imported ${String(imported)} of ${String(result.files.length)} images. ${details}`;
}
