export const PRODUCT_IDS = Object.freeze(['soundscaper', 'framescaper']);

const PRODUCT_ID_SET = new Set(PRODUCT_IDS);

const SHARED_CAPABILITIES = Object.freeze({
	project: true,
	projectBin: true,
	audioImport: true,
	audioPlayback: true,
	audioTimelineEditing: true,
	audioMixing: true,
	videoImport: true,
	videoPlayback: true,
	videoTimelineEditing: true,
	videoExport: true,
});

export const PRODUCT_PROFILES = deepFreeze({
	soundscaper: {
		id: 'soundscaper',
		name: 'Soundscaper',
		description: 'A local-first multitrack audio editor for the web and desktop.',
		basePath: '',
		defaultWorkspace: 'modern',
		enabledCommands: ['project', 'timeline', 'transport', 'audio-mix', 'audio-record', 'audio-generate', 'audio-effects', 'audio-spectral', 'audio-analysis', 'audio-macros', 'video-basic', 'export-audio', 'export-video'],
		panels: ['project-bin', 'track-list', 'mixer', 'effects', 'analysis', 'recording-meter', 'playback-meter'],
		importChoices: ['scape', 'aup4', 'aup3', 'audio', 'video', 'labels'],
		exportChoices: ['scape', 'aup4-audio-only', 'audio', 'video', 'labels', 'stems'],
		shortcuts: { disabledCommandIds: ['workspace-video-editor', 'video-effect-add'] },
		capabilities: {
			...SHARED_CAPABILITIES,
			audioRecording: true,
			audioGenerators: true,
			audioEffects: true,
			audioSpectralEditing: true,
			audioAnalysis: true,
			audioMacros: true,
			audioSampleEditing: true,
			videoEffects: false,
			videoCompositing: false,
		},
		desktop: {
			appId: 'org.soundscaper.desktop',
			scheme: 'soundscaper-app',
			sessionPartition: 'persist:soundscaper-v1',
			executableName: 'soundscaper',
			category: 'AudioVideo;Audio',
		},
	},
	framescaper: {
		id: 'framescaper',
		name: 'Framescaper',
		description: 'A local-first video editor for the web and desktop.',
		basePath: '/framescaper',
		defaultWorkspace: 'video-editor',
		enabledCommands: ['project', 'timeline', 'transport', 'audio-mix', 'video-basic', 'video-effects', 'video-compositing', 'export-audio', 'export-video'],
		panels: ['project-bin', 'track-list', 'mixer', 'video-preview', 'video-effects', 'playback-meter'],
		importChoices: ['scape', 'aup4', 'aup3', 'audio', 'video', 'labels'],
		exportChoices: ['scape', 'aup4-audio-only', 'audio', 'video', 'labels'],
		shortcuts: { disabledCommandIds: ['record', 'generate', 'selection-effect', 'spectral-edit', 'analyze', 'manage-macros', 'nyquist-prompt'] },
		capabilities: {
			...SHARED_CAPABILITIES,
			audioRecording: false,
			audioGenerators: false,
			audioEffects: false,
			audioSpectralEditing: false,
			audioAnalysis: false,
			audioMacros: false,
			audioSampleEditing: false,
			videoEffects: true,
			videoCompositing: true,
		},
		desktop: {
			appId: 'org.framescaper.desktop',
			scheme: 'framescaper-app',
			sessionPartition: 'persist:framescaper-v1',
			executableName: 'framescaper',
			category: 'AudioVideo;Video',
		},
	},
});

export function normalizeProductId(value = 'soundscaper') {
	const productId = String(value || 'soundscaper').toLowerCase();
	if (!PRODUCT_ID_SET.has(productId)) throw new RangeError(`Unsupported editor product: ${productId}.`);
	return productId;
}

export function productProfile(value = 'soundscaper') {
	return PRODUCT_PROFILES[normalizeProductId(value)];
}

export function productLocalePath(product, locale, options = {}) {
	const profile = productProfile(product);
	const localeSegment = encodeURIComponent(String(locale || 'en'));
	const embedSegment = options.embedded ? '/embed' : '';
	return `${profile.basePath}${embedSegment}/${localeSegment}/` || '/';
}

export function otherProductId(product) {
	return normalizeProductId(product) === 'framescaper' ? 'soundscaper' : 'framescaper';
}

function deepFreeze(value) {
	if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
	for (const child of Object.values(value)) deepFreeze(child);
	return Object.freeze(value);
}
