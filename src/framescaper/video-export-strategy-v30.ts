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
import { FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE } from './editor-project-runtime-profile-v28.ts';
import { framescaperProjectV28FoundationShapeV30 } from './editor-project-v30-foundation.ts';
import { validateFramescaperProjectV30 } from './editor-project-v30.ts';
import {
	createFramescaperVideoExportStrategyV28,
} from './video-export-strategy-v28.ts';
import type { FramescaperVideoExportStrategyV27Dependencies } from './video-export-strategy-v27.ts';
import type { FramescaperVideoExportVisualAssetStoreV27 } from './video-export-visual-execution-v27.ts';

interface ExportAuthorityV30 {
	readonly canonicalProject: Readonly<Record<string, unknown>>;
	readonly inheritedProject: Readonly<Record<string, unknown>>;
}

/** Retain V28 browser delivery for image-free V30 project snapshots. */
export function createFramescaperVideoExportStrategyV30(
	profile: unknown,
	dependencies?: FramescaperVideoExportStrategyV27Dependencies,
	assetStore?: FramescaperVideoExportVisualAssetStoreV27,
): ProductVideoExportStrategy {
	const delegate = createFramescaperVideoExportStrategyV28(
		FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE, dependencies, assetStore,
	);
	const exports = new WeakMap<object, ExportAuthorityV30>();
	const plans = new WeakMap<object, ExportAuthorityV30>();
	return Object.freeze({
		createExportProject(request: ProductVideoExportProjectRequest) {
			const authority = projectAuthority(profile, request.canonicalProject);
			const exportProject = delegate.createExportProject({
				canonicalProject: authority.inheritedProject,
				delivery: request.delivery,
			});
			exports.set(exportProject, authority);
			return exportProject;
		},
		hasPicture(exportProject: Readonly<Record<string, unknown>>) {
			if (!exports.has(exportProject)) {
				throw new TypeError('Selected V30 picture authority requires an owned export project.');
			}
			return delegate.hasPicture?.(exportProject) ?? false;
		},
		createPlan(request: ProductVideoExportStrategyPlanRequest) {
			const authority = currentAuthority(profile, request, exports);
			const plan = delegate.createPlan({
				...request,
				canonicalProject: authority.inheritedProject,
			});
			if (plan) plans.set(plan, authority);
			return plan;
		},
		encode(request: ProductVideoExportStrategyEncodeRequest): Promise<ProductVideoExportEncodedOutput> {
			const authority = ownedPlanAuthority(profile, request, exports, plans);
			return delegate.encode({ ...request, canonicalProject: authority.inheritedProject });
		},
		encodeToSink<Output>(
			request: ProductVideoExportStrategyEncodeRequest,
			sink: FfmpegOutputSink<Output>,
		): Promise<ProductVideoExportSinkOutput<Output>> {
			const authority = ownedPlanAuthority(profile, request, exports, plans);
			return delegate.encodeToSink(
				{ ...request, canonicalProject: authority.inheritedProject }, sink,
			);
		},
		captureTimingSourceIds(plan: ProductVideoExportPlan) {
			if (!plans.has(plan)) throw new TypeError('Selected V30 timing closure requires an owned plan.');
			return delegate.captureTimingSourceIds?.(plan) ?? plan.activeSourceIds;
		},
	});
}

function projectAuthority(
	profile: unknown,
	project: Readonly<Record<string, unknown>>,
): ExportAuthorityV30 {
	validateFramescaperProjectV30(profile, project);
	if (records(project.sources, 'V30 export sources').some(({ kind }) => kind === 'image')
		|| records(project.clips, 'V30 export clips').some(({ kind }) => kind === 'image')) {
		throw new Error('Selected V30 browser export refuses to omit a timeline image; image delivery is not yet available.');
	}
	return Object.freeze({
		canonicalProject: project,
		inheritedProject: framescaperProjectV28FoundationShapeV30(project),
	});
}

function currentAuthority(
	profile: unknown,
	request: Readonly<{
		readonly canonicalProject: Readonly<Record<string, unknown>>;
		readonly exportProject: Readonly<Record<string, unknown>>;
	}>,
	exports: WeakMap<object, ExportAuthorityV30>,
): ExportAuthorityV30 {
	const authority = exports.get(request.exportProject);
	if (!authority || authority.canonicalProject !== request.canonicalProject) {
		throw new TypeError('The browser export projection is not owned by this exact V30 project.');
	}
	const current = projectAuthority(profile, request.canonicalProject);
	if (!sameProjectSnapshot(current.inheritedProject, authority.inheritedProject)) {
		throw new Error('The selected V30 browser export projection is stale.');
	}
	return authority;
}

function ownedPlanAuthority(
	profile: unknown,
	request: ProductVideoExportStrategyEncodeRequest,
	exports: WeakMap<object, ExportAuthorityV30>,
	plans: WeakMap<object, ExportAuthorityV30>,
): ExportAuthorityV30 {
	const authority = currentAuthority(profile, request, exports);
	if (plans.get(request.plan) !== authority) {
		throw new TypeError('The V30 export plan is not owned by this exact project snapshot.');
	}
	return authority;
}

function records(value: unknown, name: string): readonly Readonly<Record<string, unknown>>[] {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
	return value.map((item, index) => {
		if (!item || typeof item !== 'object' || Array.isArray(item)) {
			throw new TypeError(`${name}[${String(index)}] must be an object.`);
		}
		return item as Readonly<Record<string, unknown>>;
	});
}
