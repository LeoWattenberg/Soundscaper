/* SPDX-License-Identifier: AGPL-3.0-only */

// Product-neutral image kernels and inert still/effect/mask contracts serve
// Frame images and photo workflows. Their exact flat contracts share this
// owner so catalog validation does not load neighboring timeline domains.
/** @type {import('rolldown').CodeSplittingGroup[]} */
export const imagingChunkGroups = [{
	// Native word/float processing is reached by opted-in Develop consumers.
	// Inert descriptors and scalar memory planning stay with image contracts.
	name: 'editor-native-image-develop',
	test: /src[\\/]common[\\/]editor[\\/]imaging[\\/](?:image-develop-linear-(?:frame|owner|current|lut-stage|plan)-v1|image-develop-raw-(?:request|source)-current-v1|native-develop-proxy-source-current-v1|image-repair-spots-native-current-v1|pixel-frame-linear-[^\\/]+-v1|linear-(?:kernel-planes|spatial-(?:noise|neighborhood)|output-sampling)-v1)\.ts$/,
	priority: 99,
	minSize: 0,
	maxSize: 400_000,
	includeDependenciesRecursively: false,
}, {
	// Native RAW Original proof opens only for an actual Source4 body consumer.
	// Scalar receipts and memory admission keep their existing startup owners.
	// Recovery runtime initialization and its pin cannot be co-owned by a Frame
	// consumer that already imports this proof owner.
	name: 'editor-raw-original-proof',
	test: /(?:src[\\/]common[\\/]editor[\\/](?:timeline-image-raw-(?:pack|encoded|derived)-current-v1|raw[\\/]libraw-runtime(?:-asset)?-v2)\.ts|(?:^|[\\/])config[\\/]lightscaper-libraw-recovery-runtime-manifest\.json)$/,
	priority: 99,
	minSize: 0,
	maxSize: 400_000,
	includeDependenciesRecursively: false,
}, {
	// Pinned font loading and real native glyph masks stay opt-in. Scalar text
	// admission remains independent of browser resources and existing kernels.
	name: 'editor-export-text',
	test: /src[\\/]common[\\/]editor[\\/]imaging[\\/]image-export-text-(?:font|frame)-v1\.ts$/,
	priority: 99,
	minSize: 0,
	maxSize: 400_000,
	includeDependenciesRecursively: false,
}, {
	// File/container parsing is shared by import and selected graphic delivery,
	// independently of the scalar metadata facts validated by catalog startup.
	name: 'editor-image-file-admission',
	test: /src[\\/]common[\\/]editor[\\/]imaging[\\/](?:static-image-(?:source-admission|native-port)-v1|image-metadata-reader-v1|exif-(?:metadata-reader|entry-traversal|color-admission)-v1|iptc-metadata-reader-v1)\.ts$/,
	priority: 99,
	minSize: 0,
	maxSize: 400_000,
	includeDependenciesRecursively: false,
}, {
	// Delivery sizing is opened by raster export or graphic placement. Existing
	// geometry and nearest sampling kernels retain their independent owner.
	name: 'editor-image-export-resize',
	test: /src[\\/]common[\\/]editor[\\/]imaging[\\/](?:image-export-size-v1|pixel-frame-export-resize-v1)\.ts$/,
	priority: 99,
	minSize: 0,
	maxSize: 400_000,
	includeDependenciesRecursively: false,
}, {
	// Natural-size recipe evaluation is opened by Develop/export and handoff
	// consumers, independently of the inert image contracts loaded at startup.
	name: 'editor-image-develop-recipe',
	test: /src[\\/]common[\\/]editor[\\/]imaging[\\/]image-develop-frame-(?:core|v2|v3|current-v1)\.ts$/,
	priority: 99,
	minSize: 0,
	maxSize: 400_000,
	includeDependenciesRecursively: false,
}, {
	// File decoding and watermark allocation belong only to an opted-in delivery.
	// Static file readers and delivery resize have their own optional owners;
	// the shared linear blend remains with the kernels below.
	name: 'editor-export-graphic',
	test: /src[\\/]common[\\/]editor[\\/]imaging[\\/](?:image-export-graphic-source-v1|pixel-frame-graphic-watermark-v1)\.ts$/,
	priority: 99,
	minSize: 0,
	maxSize: 400_000,
	includeDependenciesRecursively: false,
}, {
	name: 'editor-jpeg-bytes',
	test: /src[\\/]common[\\/]editor[\\/]imaging[\\/]pixel-frame-jpeg-v1\.ts$/,
	priority: 99,
	minSize: 0,
	maxSize: 400_000,
	includeDependenciesRecursively: false,
}, {
	// PNG bytes are needed only after export is opened. Existing image readers
	// keep their shared codec placement without acquiring this encoder body.
	name: 'editor-png-bytes',
	test: /src[\\/]common[\\/]editor[\\/]imaging[\\/]pixel-frame-png-v1\.ts$/,
	priority: 99,
	minSize: 0,
	maxSize: 400_000,
	includeDependenciesRecursively: false,
}, {
	name: 'editor-imaging',
	test: /src[\\/]common[\\/]editor[\\/](?:imaging[\\/][^\\/]+\.ts|raw[\\/]internal[\\/]raw-recovery-frame-authority-v1\.ts|(?:photo-library-develop-linear-port-v1|image-import-admission|image-format-signature|image-decoder-routing|video-effects-v2|video-color-(?:cube-lut-v27|management-v27|byte-encoding)|video-global-develop-v1|video-color-wheels-(?:v1|scalar-v1)|video-chroma-develop-v1|video-black-white-mix-v1|video-hsl-mixer-v1|video-curves-v1|video-lens-distortion-(?:v1|ffmpeg-v1)|video-chromatic-aberration-(?:v1|ffmpeg-v1)|video-defringe-(?:v1|ffmpeg-v1)|video-optical-vignette-(?:v1|ffmpeg-v1)|video-sharpen-(?:v1|ffmpeg-v1)|video-post-crop-vignette-(?:v1|ffmpeg-v1)|video-clarity-(?:v1|ffmpeg-v1)|video-noise-reduction-(?:v1|ffmpeg-v1)|video-grain-(?:v1|ffmpeg-v1)|video-texture-(?:v1|ffmpeg-v1)|video-dehaze-(?:v1|ffmpeg-v1)|video-original-alpha-ffmpeg-v1|video-effect-closed-(?:creation|families-v1)|video-curve-(?:types|transfer)-v1|video-image-geometry-(?:v1|ffmpeg-v1)|video-mask-matte-v24|video-visual-model-v24|video-visual-preset-v24|timeline-image-(?:model(?:-(?:v[234]|current-v1))?|pack-source-current-v1|raw-(?:receipt-v1|(?:original|encoded)-plan-current-v1)|frame-pack-v1(?:-layout)?|native-decode-v1|browser-native-port|conversion-receipt-v1))\.ts|(?:internal[\\/]timeline-image-model-(?:editable|raw)-kernel-v1|(?:internal[\\/])?image-develop-handoff-provenance-(?:v[12]|current-v1|kernel-v1))\.ts|video-effects\.js)$/,
	priority: 66,
	minSize: 0,
	maxSize: 400_000,
	includeDependenciesRecursively: false,
}];
