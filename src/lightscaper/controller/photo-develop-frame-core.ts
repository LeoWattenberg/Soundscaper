/* SPDX-License-Identifier: AGPL-3.0-only */

// Fixed product limits and compatibility names retain their existing callers;
// ordered recipe evaluation belongs to the shared imaging owner.
export { withImageDevelopFrameCore as withPhotoDevelopFrameCore } from '../../common/editor/imaging/image-develop-frame-core.ts';
export type {
	ImageDevelopFrameStageInput as PhotoDevelopFrameStageInput,
	ImageDevelopFramePixels as PhotoDevelopFramePixels,
	ImageDevelopFrameViewV1 as PhotoDevelopFrameViewV1,
	ImageDevelopFrameProfile as PhotoDevelopFrameProfile,
	ImageDevelopFrameStage as PhotoDevelopFrameStage,
	ImageDevelopFramePolicy as PhotoDevelopFramePolicy,
} from '../../common/editor/imaging/image-develop-frame-core.ts';

export const PHOTO_DEVELOP_PROXY_LIMITS_V1 = Object.freeze({
	source: Object.freeze({ maximumSidePixels: 2048, maximumPixels: 4_194_304, maximumBytes: 16_777_216 }),
	render: Object.freeze({ maximumSidePixels: 4096, maximumPixels: 8_388_608, maximumBytes: 33_554_432 }),
});
