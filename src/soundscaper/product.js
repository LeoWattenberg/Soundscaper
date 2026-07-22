import { SHARED_CAPABILITIES } from '../common/product-capabilities.js';

export const SOUNDSCAPER_PROFILE = {
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
};
