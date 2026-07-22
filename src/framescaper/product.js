import { SHARED_CAPABILITIES } from '../common/product-capabilities.js';

export const FRAMESCAPER_PROFILE = {
	id: 'framescaper',
	name: 'Framescaper',
	description: 'A local-first video editor for the web and desktop.',
	basePath: '/framescaper',
	defaultWorkspace: 'video-editor',
	enabledCommands: ['project', 'timeline', 'transport', 'audio-mix', 'video-basic', 'video-effects', 'video-compositing', 'export-audio', 'export-video'],
	panels: ['project-bin', 'track-list', 'mixer', 'video-preview', 'video-effects', 'playback-meter'],
	importChoices: ['scape', 'aup4', 'aup3', 'audio', 'video', 'labels'],
	exportChoices: ['scape', 'audio', 'video', 'labels'],
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
};
