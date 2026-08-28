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
import { FRAMESCAPER_TIMELINE_IMAGE_PROJECT_RUNTIME_PROFILE } from './editor-domain-runtime-profile.ts';
import { assertFramescaperProjectAssistanceProfile } from './editor-domain-runtime-profile.ts';
import { framescaperProjectTimelineImageFoundationShapeAssistance } from './editor-project-assistance-foundation.ts';
import type { FramescaperVideoExportStrategyFinishingDependencies } from './video-export-strategy-finishing.ts';
import type { FramescaperVideoExportAssetStoreTimelineImage } from './video-export-strategy-timeline-image.ts';
import { createFramescaperVideoExportStrategyTimelineImage } from './video-export-strategy-timeline-image.ts';
import type { FramescaperSelectedOpenFxExecutionNativeMedia } from './selected-native-media-openfx-exact-planes.ts';

interface ExportAuthorityAssistance {
	readonly canonicalProject: Readonly<Record<string, unknown>>;
	readonly foundation: Readonly<Record<string, unknown>>;
}

/** Execute the complete nativeMedia export strategy over assistance's immutable foundation. */
export function createFramescaperVideoExportStrategyAssistance(
	profile: unknown,
	dependencies?: FramescaperVideoExportStrategyFinishingDependencies,
	assetStore?: FramescaperVideoExportAssetStoreTimelineImage,
	openFxExecute?: FramescaperSelectedOpenFxExecutionNativeMedia['execute'],
): ProductVideoExportStrategy {
	assertFramescaperProjectAssistanceProfile(profile);
	const delegate = createFramescaperVideoExportStrategyTimelineImage(
		FRAMESCAPER_TIMELINE_IMAGE_PROJECT_RUNTIME_PROFILE, dependencies, assetStore, openFxExecute,
	);
	const exports = new WeakMap<object, ExportAuthorityAssistance>();
	const plans = new WeakMap<object, ExportAuthorityAssistance>();
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
				throw new TypeError('Selected assistance picture authority requires an owned export project.');
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
			if (!plans.has(plan)) throw new TypeError('Selected assistance timing closure requires an owned plan.');
			return delegate.captureTimingSourceIds?.(plan) ?? plan.activeSourceIds;
		},
	});
}

function projectAuthority(project: Readonly<Record<string, unknown>>): ExportAuthorityAssistance {
	return Object.freeze({
		canonicalProject: project,
		foundation: framescaperProjectTimelineImageFoundationShapeAssistance(foundationInput(project)),
	});
}

function currentAuthority(
	request: Readonly<{
		readonly canonicalProject: Readonly<Record<string, unknown>>;
		readonly exportProject: Readonly<Record<string, unknown>>;
	}>,
	exports: WeakMap<object, ExportAuthorityAssistance>,
): ExportAuthorityAssistance {
	const authority = exports.get(request.exportProject);
	if (!authority || authority.canonicalProject !== request.canonicalProject) {
		throw new TypeError('The browser export projection is not owned by this exact assistance project.');
	}
	const current = framescaperProjectTimelineImageFoundationShapeAssistance(foundationInput(request.canonicalProject));
	if (!sameProjectSnapshot(current, authority.foundation)) {
		throw new Error('The selected assistance browser export projection is stale.');
	}
	return authority;
}

function foundationInput(value: unknown): unknown {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
	const family = Object.getOwnPropertyDescriptor(value, 'schemaFamily');
	return family?.enumerable && Object.hasOwn(family, 'value') && family.value === 'framescaper'
		? value
		: value;
}
function ownedPlanAuthority(
	request: ProductVideoExportStrategyEncodeRequest,
	exports: WeakMap<object, ExportAuthorityAssistance>,
	plans: WeakMap<object, ExportAuthorityAssistance>,
): ExportAuthorityAssistance {
	const authority = currentAuthority(request, exports);
	if (plans.get(request.plan) !== authority) {
		throw new TypeError('The assistance export plan is not owned by this exact project snapshot.');
	}
	return authority;
}
