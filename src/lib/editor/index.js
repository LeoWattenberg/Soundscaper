/**
 * Product-neutral boundary for the shared mixed-media editor. The existing
 * audio-editor module paths remain compatibility aliases while the product
 * split is rolled out.
 */
export { createAudioEditorController as createEditorController } from '../tools/audio-editor/app.js';
export { createProjectStore as createEditorProjectStore } from '../tools/audio-editor/storage.js';
export {
	SCAPE_FILE_EXTENSION,
	SCAPE_FORMAT,
	SCAPE_FORMAT_VERSION,
	SCAPE_MIME_TYPE,
	exportScapeProject,
	importScapeProject,
	inspectScapeProject,
} from '../tools/audio-editor/scape-project.js';
export {
	PRODUCT_IDS,
	PRODUCT_PROFILES,
	normalizeProductId,
	otherProductId,
	productLocalePath,
	productProfile,
} from '../products.js';
