/* SPDX-License-Identifier: AGPL-3.0-only */

/** Every Scape reader recognizes this asset for opaque custody; only Lightscaper decodes it. */
export const PHOTO_DEVELOP_PRESET_PACK_ASSET_KIND = 'photo-develop-preset-pack' as const;
export const PHOTO_DEVELOP_PRESET_PACK_ENCODING = 'lightscaper-develop-presets-json-v1' as const;
