/* SPDX-License-Identifier: AGPL-3.0-only */

import type { FfmpegOutputSink } from '../common/editor/ffmpeg-output-stream.ts';
import type {
	ProductVideoExportEncodedOutput,
	ProductVideoExportPlan,
	ProductVideoExportSinkOutput,
	ProductVideoExportStrategy,
	ProductVideoExportStrategyEncodeRequest,
	ProductVideoExportStrategyPlanRequest,
	ProductVideoExportProjectRequest,
} from '../common/editor/controller/product-video-export-strategy.ts';
import { sameProjectSnapshot } from '../common/editor/storage/project-snapshot-equality.ts';
import {
	assertVideoKeyframeExportPlanV7,
	type VideoKeyframeExportPlanV7,
} from '../common/editor/video-keyframe-export-plan-v7.ts';
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
import {
	createFramescaperVideoExportFinishingV27,
	type FramescaperVideoExportFinishingAssetStoreV27,
} from './video-export-finishing-v27.ts';

interface ExportAuthorityV27 {
	readonly canonicalProject: Readonly<Record<string, unknown>>;
	readonly v20Project: Readonly<Record<string, unknown>>;
	readonly v20ExportProject: Readonly<Record<string, unknown>>;
}

/**
 * Authenticate V27, then delegate only the state the maintained V20 browser
 * encoder represents exactly. Selected V13 finishing is never silently lost.
 */
export function createFramescaperVideoExportStrategyV27(
	profile: unknown,
	dependencies?: FramescaperVideoExportStrategyV20Dependencies,
	assetStore?: FramescaperVideoExportFinishingAssetStoreV27,
): ProductVideoExportStrategy {
	assertFramescaperProjectV27Profile(profile);
	const delegate = createFramescaperVideoExportStrategyV20(
		FRAMESCAPER_V20_PROJECT_RUNTIME_PROFILE, dependencies,
		{ forceKeyed: true },
	);
	const exports = new WeakMap<object, ExportAuthorityV27>();
	const timingSources = new WeakMap<object, readonly string[]>();
	return Object.freeze({
		createExportProject(request: ProductVideoExportProjectRequest) {
			const v20Project = executableFoundation(profile, request.canonicalProject);
			const v20ExportProject = delegate.createExportProject({
				canonicalProject: v20Project,
				delivery: request.delivery,
			});
			const exportProject = dataRecord(
				request.delivery.project, 'Selected V27 browser delivery project',
			);
			exports.set(exportProject, Object.freeze({
				canonicalProject: request.canonicalProject,
				v20Project,
				v20ExportProject,
			}));
			return exportProject;
		},
		createPlan(request: ProductVideoExportStrategyPlanRequest) {
			const authority = currentAuthority(profile, request, exports);
			const plan = delegate.createPlan({
				...request,
				canonicalProject: authority.v20Project,
				exportProject: authority.v20ExportProject,
			});
			if (!plan) throw new Error('Selected V27 browser export requires the exact keyed RGBA route.');
			timingSources.set(plan, allVideoSourceIds(authority.canonicalProject));
			return plan;
		},
		async encode(
			request: ProductVideoExportStrategyEncodeRequest,
		): Promise<ProductVideoExportEncodedOutput> {
			const authority = currentAuthority(profile, request, exports);
			const rgbaPostprocessor = await finishingPostprocessor(
				profile, authority, request, assetStore,
			);
			return delegate.encode({
				...request, canonicalProject: authority.v20Project,
				exportProject: authority.v20ExportProject, rgbaPostprocessor,
			});
		},
		async encodeToSink<Output>(
			request: ProductVideoExportStrategyEncodeRequest,
			sink: FfmpegOutputSink<Output>,
		): Promise<ProductVideoExportSinkOutput<Output>> {
			const authority = currentAuthority(profile, request, exports);
			const rgbaPostprocessor = await finishingPostprocessor(
				profile, authority, request, assetStore,
			);
			return delegate.encodeToSink(
				{
					...request, canonicalProject: authority.v20Project,
					exportProject: authority.v20ExportProject, rgbaPostprocessor,
				}, sink,
			);
		},
		captureTimingSourceIds(plan: ProductVideoExportPlan) {
			const sourceIds = timingSources.get(plan);
			if (!sourceIds) throw new TypeError('Selected V27 timing closure requires an owned export plan.');
			return sourceIds;
		},
	});
}

async function finishingPostprocessor(
	profile: unknown,
	authority: ExportAuthorityV27,
	request: ProductVideoExportStrategyEncodeRequest,
	assetStore: FramescaperVideoExportFinishingAssetStoreV27 | undefined,
) {
	assertVideoKeyframeExportPlanV7(request.plan);
	if (!(request.timingViewsBySourceId instanceof Map)) {
		throw new TypeError('Selected V27 browser export lost its raw exact timing authority.');
	}
	return createFramescaperVideoExportFinishingV27({
		profile,
		project: authority.canonicalProject as unknown as FramescaperProjectV27,
		plan: request.plan as VideoKeyframeExportPlanV7,
		timingViewsBySourceId: request.timingViewsBySourceId,
		...(assetStore === undefined ? {} : { store: assetStore }),
		signal: request.signal,
		assertCurrent: request.assertCurrent,
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
	assertSupportedBrowserFinishingState(project);
	return framescaperProjectV20FoundationV27(profile, project) as unknown as Readonly<Record<string, unknown>>;
}

function assertSupportedBrowserFinishingState(project: FramescaperProjectV27): void {
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
	]) {
		if (array(record[field], `V27 browser export ${field}`).length > 0) refuse(field);
	}
	for (const track of records(record.tracks, 'V27 browser export tracks')) {
		if (track.type === 'video'
			&& array(track.videoTransitions, 'V27 browser export video transitions').length > 0) {
			refuse('video transitions');
		}
	}
	for (const interpretation of records(
		record.videoSourceColorInterpretations, 'V27 browser export color interpretations',
	)) {
		if (interpretation.provenance === 'legacy-unmanaged-encoded') {
			refuse('a legacy unmanaged source');
		}
		if (!['srgb', 'bt709'].includes(String(interpretation.primaries))
			|| !['srgb', 'bt709'].includes(String(interpretation.transfer))
			|| !['rgb', 'bt709'].includes(String(interpretation.matrix))) {
			refuse('an HDR or wide-gamut source interpretation');
		}
	}
	for (const presentation of records(
		record.videoVisualPresentations, 'V27 browser export visual presentations',
	)) {
		if (presentation.enabled !== true) continue;
		const owner = dataRecord(presentation.owner, 'V27 browser export presentation owner');
		if (!['clip', 'source'].includes(String(owner.kind))) {
			refuse('a non-media visual presentation owner');
		}
		if (presentation.opacity !== 1 || presentation.blendMode !== 'normal'
			|| array(presentation.maskMatteIds, 'V27 browser export mask/matte IDs').length > 0) {
			refuse('presentation opacity, blending, or masks before per-layer finishing');
		}
	}
}

function refuse(feature: string): never {
	throw new Error(
		`Selected V27 browser export refuses ${feature}; it has no exact V13 execution path.`,
	);
}

function allVideoSourceIds(projectValue: Readonly<Record<string, unknown>>): readonly string[] {
	return Object.freeze(records(projectValue.sources, 'V27 browser export timing sources')
		.filter(({ kind }) => kind === 'video')
		.map((source) => stableId(source.id, 'V27 browser export timing source'))
		.sort((left, right) => left.localeCompare(right)));
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
