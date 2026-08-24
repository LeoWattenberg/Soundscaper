import { readFile } from 'node:fs/promises';

import { ModuleKind, ScriptTarget, transpileModule } from 'typescript';

const SOURCE_MODULES = new Map([
	['common/editor/closed-domain-value.ts', '../../src/common/editor/closed-domain-value.ts'],
	['common/editor/native-external-display.ts', '../../src/common/editor/native-external-display.ts'],
	['common/editor/native-validation.ts', '../../src/common/editor/native-validation.ts'],
	['common/editor/video-clip-composition.ts', '../../src/common/editor/video-clip-composition.ts'],
	['common/editor/video-delivery-color.ts', '../../src/common/editor/video-delivery-color.ts'],
	['common/editor/video-preview-render-description.ts', '../../src/common/editor/video-preview-render-description.ts'],
	['common/editor/ui/video-preview-composition-blend.ts', '../../src/common/editor/ui/video-preview-composition-blend.ts'],
	['common/editor/ui/video-preview-compositor.js', '../../src/common/editor/ui/video-preview-compositor.js'],
	['common/editor/ui/video-preview-compositor-size.js', '../../src/common/editor/ui/video-preview-compositor-size.js'],
	['common/editor/ui/video-preview-effects.js', '../../src/common/editor/ui/video-preview-effects.js'],
	['common/editor/ui/video-preview-geometry-shader.ts', '../../src/common/editor/ui/video-preview-geometry-shader.ts'],
	['common/editor/ui/video-preview-layer-effects.js', '../../src/common/editor/ui/video-preview-layer-effects.js'],
	['common/editor/ui/video-preview-render-description.ts', '../../src/common/editor/ui/video-preview-render-description.ts'],
	['common/editor/ui/video-preview-render-ledger.js', '../../src/common/editor/ui/video-preview-render-ledger.js'],
	['common/editor/ui/video-preview-render-size.js', '../../src/common/editor/ui/video-preview-render-size.js'],
	['common/editor/ui/video-preview-render-target.js', '../../src/common/editor/ui/video-preview-render-target.js'],
	['common/editor/ui/video-preview-viewports.js', '../../src/common/editor/ui/video-preview-viewports.js'],
	['common/editor/ui/video-preview-video-textures.js', '../../src/common/editor/ui/video-preview-video-textures.js'],
]);

/** Serve the production preview module graph with TypeScript erased for Chromium. */
export async function videoPreviewSourceResponse(pathname, routeRoot) {
	const prefix = `${routeRoot}/source/`;
	if (!pathname.startsWith(prefix)) return null;
	const modulePath = pathname.slice(prefix.length);
	const relativePath = SOURCE_MODULES.get(modulePath);
	if (!relativePath) throw new Error(`Unregistered video preview source module ${modulePath}.`);
	const source = await readFile(new URL(relativePath, import.meta.url), 'utf8');
	const body = modulePath.endsWith('.ts')
		? transpileModule(source, {
			compilerOptions: { module: ModuleKind.ESNext, target: ScriptTarget.ES2022 },
			fileName: modulePath,
		}).outputText
		: source;
	return { body, contentType: 'text/javascript' };
}
