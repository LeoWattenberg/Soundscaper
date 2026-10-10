/* SPDX-License-Identifier: AGPL-3.0-only */

// Product-neutral image kernels and inert still/effect/mask contracts serve
// Frame images and photo workflows. Their exact flat contracts share this
// owner so catalog validation does not load neighboring timeline domains.
/** @type {import('rolldown').CodeSplittingGroup[]} */
export const imagingChunkGroups = [{
	name: 'editor-imaging',
	test: /src[\\/]common[\\/]editor[\\/](?:imaging[\\/][^\\/]+\.ts|(?:image-import-admission|image-format-signature|image-decoder-routing|video-effects-v2|video-color-(?:cube-lut-v27|management-v27|byte-encoding)|video-global-develop-v1|video-color-wheels-(?:v1|scalar-v1)|video-chroma-develop-v1|video-black-white-mix-v1|video-hsl-mixer-v1|video-curves-v1|video-sharpen-(?:v1|ffmpeg-v1)|video-post-crop-vignette-(?:v1|ffmpeg-v1)|video-clarity-(?:v1|ffmpeg-v1)|video-noise-reduction-(?:v1|ffmpeg-v1)|video-grain-(?:v1|ffmpeg-v1)|video-texture-(?:v1|ffmpeg-v1)|video-dehaze-(?:v1|ffmpeg-v1)|video-original-alpha-ffmpeg-v1|video-effect-closed-(?:creation|families-v1)|video-curve-(?:types|transfer)-v1|video-image-geometry-(?:v1|ffmpeg-v1)|video-mask-matte-v24|video-visual-model-v24|video-visual-preset-v24|timeline-image-(?:model|frame-pack-v1(?:-layout)?|native-decode-v1|browser-native-port|conversion-receipt-v1))\.ts|video-effects\.js)$/,
	priority: 66,
	minSize: 0,
	maxSize: 400_000,
	includeDependenciesRecursively: false,
}];
