/* SPDX-License-Identifier: AGPL-3.0-only */
import { readClosedDomainField as field, readClosedDomainRecord as record } from '../common/editor/closed-domain-value.ts';
import { captureRepairSignalV1, checkRepairSignalV1 } from '../common/editor/imaging/pixel-frame-repair-lifetime-v1.ts';
import type { ImageHdrMergeAuthoringPortCurrentV1, ImageHdrMergeAuthoringSelectionCurrentV1 } from '../common/editor/image-hdr-merge-authoring-port-current-v1.ts';
import type { ImageHdrRadianceDiagnosticsV1 } from '../common/editor/imaging/image-hdr-radiance-v1.ts';
import type { FramescaperTimelineImageCurrentProjectPublicationDependenciesTimelineImage } from './editor-timeline-image-current-project-publication-timeline-image.ts';
import type { FramescaperStoredImageAssetStoreTimelineImage } from './editor-selected-timeline-image-image-frame-source.ts';
import type { ImageHdrMergePortsCurrentV1 } from '../common/editor/controller/shared/image-hdr-merge-current-v1.ts';
import type { ImageHdrMergePreviewCurrentV1 } from '../common/editor/controller/shared/image-hdr-merge-preview-current-v1.ts';

export interface FramescaperImageHdrMergeAcknowledgementCurrentV1 {
	readonly schemaVersion: 1; readonly projectId: string; readonly revision: number; readonly sourceId: string; readonly clipId: string;
	readonly diagnostics: Readonly<ImageHdrRadianceDiagnosticsV1>; readonly notices: readonly string[];
	readonly retirementFailure?: unknown;
}
type PublicationDependencies = FramescaperTimelineImageCurrentProjectPublicationDependenciesTimelineImage;
type PublicationController = PublicationDependencies['controller'];
export interface FramescaperImageHdrMergeControllerCurrentV1 extends PublicationController {
	getSnapshot(): Readonly<{ readOnly?: unknown; importing?: unknown }>;
}
export interface BindFramescaperImageHdrMergeCurrentV1 extends Omit<PublicationDependencies, 'controller'> {
	readonly controller: FramescaperImageHdrMergeControllerCurrentV1;
	readonly store: FramescaperStoredImageAssetStoreTimelineImage;
	readonly prepareCurrentProject: () => PromiseLike<unknown> | unknown;
	readonly withStaging?: ImageHdrMergePortsCurrentV1['withStaging'];
	readonly createId?: (prefix: string) => string;
}
export interface FramescaperImageHdrMergeSessionCurrentV1 {
	readonly selection: Readonly<{ projectId: string; revision: number; inputs: ImageHdrMergeAuthoringSelectionCurrentV1['sources'] }>;
	readonly port: Readonly<ImageHdrMergeAuthoringPortCurrentV1<FramescaperImageHdrMergeAcknowledgementCurrentV1>>;
	isCurrent(): boolean;
	withPreview<Result>(value: unknown, consume: (view: Readonly<ImageHdrMergePreviewCurrentV1>) => Result | Promise<Result>, options?: Readonly<{ signal?: AbortSignal }>): Promise<Result>;
	merge(value: unknown, options?: Readonly<{ signal?: AbortSignal; onAcknowledged?: (ack: Readonly<FramescaperImageHdrMergeAcknowledgementCurrentV1>) => void }>): Promise<Readonly<FramescaperImageHdrMergeAcknowledgementCurrentV1>>;
	closeAndJoin(): Promise<void>;
}
export interface FramescaperImageHdrMergeRuntimeCurrentV1 {
	open(options?: Readonly<{ signal?: AbortSignal }>): Promise<Readonly<FramescaperImageHdrMergeSessionCurrentV1>>;
}
/** Private product composition captured before the optional session is loaded. */
export interface CapturedFramescaperImageHdrMergeBindingCurrentV1 {
	readonly controller: FramescaperImageHdrMergeControllerCurrentV1;
	readonly snapshot: FramescaperImageHdrMergeControllerCurrentV1['getSnapshot'];
	readonly store: FramescaperStoredImageAssetStoreTimelineImage;
	readonly publication: PublicationDependencies;
	readonly prepareCurrentProject: BindFramescaperImageHdrMergeCurrentV1['prepareCurrentProject'];
	readonly withStaging?: ImageHdrMergePortsCurrentV1['withStaging'];
	readonly createId?: (prefix: string) => string;
}
const RUNTIMES = new WeakMap<object, Readonly<FramescaperImageHdrMergeRuntimeCurrentV1>>();

export function framescaperImageHdrMergeForCurrentV1(controller: unknown): Readonly<FramescaperImageHdrMergeRuntimeCurrentV1> | null {
	return typeof controller === 'object' && controller !== null ? RUNTIMES.get(controller) ?? null : null;
}

/** Keep startup limited to owned scalar capabilities. The menu gesture captures
 * its complete selected project before the first lazy-loading await. */
export function bindFramescaperImageHdrMergeCurrentV1(options: BindFramescaperImageHdrMergeCurrentV1): void {
	const input = record(options, 'Frame HDR binding', ['controller', 'store', 'session', 'executeCommand', 'publishIfCurrent', 'prepareCurrentProject', 'withStaging', 'createId', 'now'],
		['controller', 'store', 'session', 'executeCommand', 'publishIfCurrent', 'prepareCurrentProject']);
	const controller = field(input, 'controller', 'Frame HDR binding') as FramescaperImageHdrMergeControllerCurrentV1;
	const snapshot = pin<FramescaperImageHdrMergeControllerCurrentV1['getSnapshot']>(controller, 'getSnapshot');
	const media = field(input, 'store', 'Frame HDR binding') as FramescaperStoredImageAssetStoreTimelineImage;
	const store = Object.freeze({ loadMediaAsset: pin<FramescaperStoredImageAssetStoreTimelineImage['loadMediaAsset']>(media, 'loadMediaAsset') });
	const history = field(input, 'session', 'Frame HDR binding') as PublicationDependencies['session'];
	const session = Object.freeze({
		captureProjectHistory: pin<PublicationDependencies['session']['captureProjectHistory']>(history, 'captureProjectHistory'),
		assertProjectHistoryToken: pin<PublicationDependencies['session']['assertProjectHistoryToken']>(history, 'assertProjectHistoryToken'),
		updateProjectHistory: pin<PublicationDependencies['session']['updateProjectHistory']>(history, 'updateProjectHistory'),
		markProjectSaved: pin<PublicationDependencies['session']['markProjectSaved']>(history, 'markProjectSaved'),
		getProjectHistory: pin<PublicationDependencies['session']['getProjectHistory']>(history, 'getProjectHistory'),
	});
	const openById = pin<PublicationController['actions']['project']['openById']>(controller.actions.project, 'openById');
	const now = Object.hasOwn(input, 'now') ? field(input, 'now', 'Frame HDR binding') : undefined;
	const createId = Object.hasOwn(input, 'createId') ? field(input, 'createId', 'Frame HDR binding') : undefined;
	const withStaging = Object.hasOwn(input, 'withStaging') ? field(input, 'withStaging', 'Frame HDR binding') : undefined;
	const publication: PublicationDependencies = Object.freeze({
		controller: Object.freeze({ get project() { return controller.project; }, actions: Object.freeze({ project: Object.freeze({ openById }) }) }), session,
		executeCommand: pin<PublicationDependencies['executeCommand']>(options, 'executeCommand'),
		publishIfCurrent: pin<PublicationDependencies['publishIfCurrent']>(options, 'publishIfCurrent'),
		...(now !== undefined ? { now: pin<() => Date | string>(options, 'now') } : {}),
	});
	const captured: Readonly<CapturedFramescaperImageHdrMergeBindingCurrentV1> = Object.freeze({ controller, snapshot, store, publication,
		prepareCurrentProject: pin<BindFramescaperImageHdrMergeCurrentV1['prepareCurrentProject']>(options, 'prepareCurrentProject'),
		...(createId !== undefined ? { createId: pin<(prefix: string) => string>(options, 'createId') } : {}),
		...(withStaging !== undefined ? { withStaging: pin<NonNullable<ImageHdrMergePortsCurrentV1['withStaging']>>(options, 'withStaging') } : {}),
	});
	RUNTIMES.set(controller, Object.freeze({ async open(openOptions: Readonly<{ signal?: AbortSignal }> = {}) {
		const descriptor = Object.getOwnPropertyDescriptor(openOptions, 'signal');
		if (descriptor && !Object.hasOwn(descriptor, 'value')) throw new TypeError('Frame HDR signal must be own data.');
		const signal = captureRepairSignalV1(descriptor?.value); checkRepairSignalV1(signal); record(openOptions, 'Frame HDR operation options', ['signal'], []);
		const project = structuredClone(controller.project);
		const { openFramescaperImageHdrMergeSessionCurrentV1 } = await import('./internal/selected-image-hdr-merge-session-current-v1.ts');
		return openFramescaperImageHdrMergeSessionCurrentV1(captured, { project, ...(signal ? { signal } : {}) });
	} }));
}

function pin<Method extends (...args: never[]) => unknown>(receiver: object, key: string): Method {
	let owner: object | null = receiver;
	for (let depth = 0; owner && depth < 32; depth++) {
		const descriptor = Object.getOwnPropertyDescriptor(owner, key);
		if (descriptor) {
			if (!Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'function') throw new TypeError(`Frame HDR requires data method ${key}.`);
			const method = descriptor.value as Method; return ((...args: Parameters<Method>) => Reflect.apply(method, receiver, args)) as Method;
		}
		owner = Object.getPrototypeOf(owner) as object | null;
	}
	throw new TypeError(`Frame HDR requires ${key}.`);
}
