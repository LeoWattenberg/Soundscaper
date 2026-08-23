/* SPDX-License-Identifier: AGPL-3.0-only */

import type { FfmpegOutputSink } from '../common/editor/ffmpeg-output-stream.ts';
import type {
	ProductVideoExportEncodedOutput,
	ProductVideoExportSinkOutput,
	ProductVideoExportStrategy,
	ProductVideoExportStrategyEncodeRequest,
	ProductVideoExportStrategyPlanRequest,
	ProductVideoExportProjectRequest,
} from '../common/editor/controller/product-video-export-strategy.ts';
import { sameProjectSnapshot } from '../common/editor/storage/project-snapshot-equality.ts';
import { defaultVideoSourceColorInterpretationV1 } from '../common/editor/video-color-management-v27.ts';
import { createDefaultFramescaperAudioFinishingV27 } from './editor-audio-finishing-v27.ts';
import { framescaperProjectV20FoundationV27 } from './editor-project-v27-runtime.ts';
import { assertFramescaperProjectV27Profile } from './editor-project-runtime-profile-v27.ts';
import {
	validateFramescaperProjectV27,
	type FramescaperProjectV27,
} from './editor-project-v27.ts';
import { FRAMESCAPER_V20_PROJECT_RUNTIME_PROFILE } from './editor-project-runtime-profile-v20.ts';
import {
	createFramescaperVideoExportStrategyV20,
	type FramescaperVideoExportStrategyV20Dependencies,
} from './video-export-strategy-v20.ts';

interface ExportAuthorityV27 {
	readonly canonicalProject: Readonly<Record<string, unknown>>;
	readonly v20Project: Readonly<Record<string, unknown>>;
}

/**
 * Authenticate V27, then delegate only the state the maintained V20 browser
 * encoder represents exactly. Selected V13 finishing is never silently lost.
 */
export function createFramescaperVideoExportStrategyV27(
	profile: unknown,
	dependencies?: FramescaperVideoExportStrategyV20Dependencies,
): ProductVideoExportStrategy {
	assertFramescaperProjectV27Profile(profile);
	const delegate = dependencies === undefined
		? createFramescaperVideoExportStrategyV20(FRAMESCAPER_V20_PROJECT_RUNTIME_PROFILE)
		: createFramescaperVideoExportStrategyV20(
			FRAMESCAPER_V20_PROJECT_RUNTIME_PROFILE, dependencies,
		);
	const exports = new WeakMap<object, ExportAuthorityV27>();
	return Object.freeze({
		createExportProject(request: ProductVideoExportProjectRequest) {
			const v20Project = executableFoundation(profile, request.canonicalProject);
			const exportProject = delegate.createExportProject({
				canonicalProject: v20Project,
				delivery: request.delivery,
			});
			exports.set(exportProject, Object.freeze({
				canonicalProject: request.canonicalProject,
				v20Project,
			}));
			return exportProject;
		},
		createPlan(request: ProductVideoExportStrategyPlanRequest) {
			const authority = currentAuthority(profile, request, exports);
			return delegate.createPlan({
				...request,
				canonicalProject: authority.v20Project,
			});
		},
		async encode(
			request: ProductVideoExportStrategyEncodeRequest,
		): Promise<ProductVideoExportEncodedOutput> {
			const authority = currentAuthority(profile, request, exports);
			return delegate.encode({ ...request, canonicalProject: authority.v20Project });
		},
		async encodeToSink<Output>(
			request: ProductVideoExportStrategyEncodeRequest,
			sink: FfmpegOutputSink<Output>,
		): Promise<ProductVideoExportSinkOutput<Output>> {
			const authority = currentAuthority(profile, request, exports);
			return delegate.encodeToSink(
				{ ...request, canonicalProject: authority.v20Project }, sink,
			);
		},
	});
}

function currentAuthority(
	profile: unknown,
	request: Readonly<{
		readonly canonicalProject: Readonly<Record<string, unknown>>;
		readonly exportProject: Readonly<Record<string, unknown>>;
	}>,
	exports: WeakMap<object, ExportAuthorityV27>,
): ExportAuthorityV27 {
	const authority = exports.get(request.exportProject);
	if (!authority || authority.canonicalProject !== request.canonicalProject) {
		throw new TypeError('The browser export projection is not owned by this exact V27 project.');
	}
	const current = executableFoundation(profile, request.canonicalProject);
	if (!sameProjectSnapshot(current, authority.v20Project)) {
		throw new Error('The selected V27 browser export projection is stale.');
	}
	return authority;
}

function executableFoundation(
	profile: unknown,
	projectValue: unknown,
): Readonly<Record<string, unknown>> {
	validateFramescaperProjectV27(profile, projectValue);
	const project = projectValue as FramescaperProjectV27;
	assertV20DelegableState(project);
	return framescaperProjectV20FoundationV27(profile, project) as unknown as Readonly<Record<string, unknown>>;
}

function assertV20DelegableState(project: FramescaperProjectV27): void {
	const record = project as unknown as Readonly<Record<string, unknown>>;
	const sources = records(record.sources, 'V27 browser export sources');
	const clips = [
		...records(record.clips, 'V27 browser export clips'),
		...records(dataRecord(record.projectBin, 'V27 browser export project bin').clips,
			'V27 browser export project bin clips'),
	];
	if (sources.some(({ kind }) => kind === 'still' || kind === 'generator')
		|| clips.some(({ kind }) => kind === 'still' || kind === 'generator')) {
		refuse('stills or generated visuals');
	}
	for (const field of [
		'videoAdjustmentLayers', 'videoVisualPresets', 'videoMaskMattes', 'videoFreezeFallbacks',
		'videoVisualPresentations', 'videoProcessorStacks', 'videoMotionAnalyses',
		'videoFinishingPresets', 'videoCaptionTracks', 'automationLanes',
	]) {
		if (array(record[field], `V27 browser export ${field}`).length > 0) refuse(field);
	}
	for (const track of records(record.tracks, 'V27 browser export tracks')) {
		if (track.type === 'video'
			&& array(track.videoTransitions, 'V27 browser export video transitions').length > 0) {
			refuse('video transitions');
		}
	}
	const expectedContexts = records(record.sequences, 'V27 browser export sequences').map((sequence) => ({
		schemaVersion: 1,
		sequenceId: stableId(sequence.id, 'V27 browser export sequence'),
		workingSpace: 'linear-rec709-d65',
		outputSpace: 'rec709',
		alphaMode: 'straight-authored-premultiplied-working',
		toneMapping: 'none',
	}));
	if (!sameProjectSnapshot(record.videoColorContexts, expectedContexts)) {
		refuse('a non-default managed color context');
	}
	const expectedInterpretations = sources.flatMap((source) => source.kind === 'video'
		? [defaultVideoSourceColorInterpretationV1(
			'video', stableId(source.id, 'V27 browser export video source'),
		)] : []);
	if (!sameProjectSnapshot(record.videoSourceColorInterpretations, expectedInterpretations)) {
		refuse('a color interpretation override or legacy unmanaged source');
	}
	const defaults = createDefaultFramescaperAudioFinishingV27(record);
	if (!sameProjectSnapshot(record.mixer, defaults.mixer)) refuse('a non-default mixer graph');
}

function refuse(feature: string): never {
	throw new Error(
		`Selected V27 browser export refuses ${feature}; its V13 finishing executor is unavailable.`,
	);
}

function stableId(value: unknown, name: string): string {
	if (typeof value !== 'string' || !value) throw new TypeError(`${name} must have an identity.`);
	return value;
}

function dataRecord(value: unknown, name: string): Readonly<Record<string, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`${name} must be an object.`);
	}
	return value as Readonly<Record<string, unknown>>;
}

function records(value: unknown, name: string): Readonly<Record<string, unknown>>[] {
	return array(value, name).map((item, index) => dataRecord(item, `${name}[${String(index)}]`));
}

function array(value: unknown, name: string): unknown[] {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
	return value;
}
