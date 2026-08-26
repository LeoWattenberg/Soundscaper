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
import { FRAMESCAPER_V32_PROJECT_RUNTIME_PROFILE } from './editor-project-runtime-profile-v32.ts';
import { assertFramescaperProjectV31Profile } from './editor-project-runtime-profile-v31.ts';
import { framescaperProjectV32FoundationShapeV31 } from './editor-project-v31-foundation.ts';
import type { FramescaperVideoExportStrategyV27Dependencies } from './video-export-strategy-v27.ts';
import type { FramescaperVideoExportAssetStoreV32 } from './video-export-strategy-v32.ts';
import { createFramescaperVideoExportStrategyV32 } from './video-export-strategy-v32.ts';
import type { FramescaperSelectedOpenFxExecutionV28 } from './selected-v28-openfx-exact-planes.ts';

interface ExportAuthorityV31 {
	readonly canonicalProject: Readonly<Record<string, unknown>>;
	readonly foundation: Readonly<Record<string, unknown>>;
}

/** Execute the complete V28 export strategy over F31's immutable foundation. */
export function createFramescaperVideoExportStrategyV31(
	profile: unknown,
	dependencies?: FramescaperVideoExportStrategyV27Dependencies,
	assetStore?: FramescaperVideoExportAssetStoreV32,
	openFxExecute?: FramescaperSelectedOpenFxExecutionV28['execute'],
): ProductVideoExportStrategy {
	assertFramescaperProjectV31Profile(profile);
	const delegate = createFramescaperVideoExportStrategyV32(
		FRAMESCAPER_V32_PROJECT_RUNTIME_PROFILE, dependencies, assetStore, openFxExecute,
	);
	const exports = new WeakMap<object, ExportAuthorityV31>();
	const plans = new WeakMap<object, ExportAuthorityV31>();
	return Object.freeze({
		createExportProject(request: ProductVideoExportProjectRequest) {
			const authority = projectAuthority(request.canonicalProject);
			const exportProject = delegate.createExportProject({
				canonicalProject: authority.foundation,
				delivery: request.delivery,
			});
			exports.set(exportProject, authority);
			return exportProject;
		},
		hasPicture(exportProject: Readonly<Record<string, unknown>>) {
			if (!exports.has(exportProject)) {
				throw new TypeError('Selected F31 picture authority requires an owned export project.');
			}
			return delegate.hasPicture?.(exportProject) ?? false;
		},
		createPlan(request: ProductVideoExportStrategyPlanRequest) {
			const authority = currentAuthority(request, exports);
			const plan = delegate.createPlan({ ...request, canonicalProject: authority.foundation });
			if (plan) plans.set(plan, authority);
			return plan;
		},
		encode(request: ProductVideoExportStrategyEncodeRequest): Promise<ProductVideoExportEncodedOutput> {
			const authority = ownedPlanAuthority(request, exports, plans);
			return delegate.encode({ ...request, canonicalProject: authority.foundation });
		},
		encodeToSink<Output>(
			request: ProductVideoExportStrategyEncodeRequest,
			sink: FfmpegOutputSink<Output>,
		): Promise<ProductVideoExportSinkOutput<Output>> {
			const authority = ownedPlanAuthority(request, exports, plans);
			return delegate.encodeToSink({ ...request, canonicalProject: authority.foundation }, sink);
		},
		captureTimingSourceIds(plan: ProductVideoExportPlan) {
			if (!plans.has(plan)) throw new TypeError('Selected F31 timing closure requires an owned plan.');
			return delegate.captureTimingSourceIds?.(plan) ?? plan.activeSourceIds;
		},
	});
}

function projectAuthority(project: Readonly<Record<string, unknown>>): ExportAuthorityV31 {
	return Object.freeze({
		canonicalProject: project,
		foundation: framescaperProjectV32FoundationShapeV31(project),
	});
}

function currentAuthority(
	request: Readonly<{
		readonly canonicalProject: Readonly<Record<string, unknown>>;
		readonly exportProject: Readonly<Record<string, unknown>>;
	}>,
	exports: WeakMap<object, ExportAuthorityV31>,
): ExportAuthorityV31 {
	const authority = exports.get(request.exportProject);
	if (!authority || authority.canonicalProject !== request.canonicalProject) {
		throw new TypeError('The browser export projection is not owned by this exact F31 project.');
	}
	const current = framescaperProjectV32FoundationShapeV31(request.canonicalProject);
	if (!sameProjectSnapshot(current, authority.foundation)) {
		throw new Error('The selected F31 browser export projection is stale.');
	}
	return authority;
}
function ownedPlanAuthority(
	request: ProductVideoExportStrategyEncodeRequest,
	exports: WeakMap<object, ExportAuthorityV31>,
	plans: WeakMap<object, ExportAuthorityV31>,
): ExportAuthorityV31 {
	const authority = currentAuthority(request, exports);
	if (plans.get(request.plan) !== authority) {
		throw new TypeError('The F31 export plan is not owned by this exact project snapshot.');
	}
	return authority;
}
