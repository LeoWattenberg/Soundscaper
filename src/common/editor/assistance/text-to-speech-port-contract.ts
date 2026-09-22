/* SPDX-License-Identifier: AGPL-3.0-only */

/** Shared source-free contract between the optional dialog and project controller. */
export interface TextToSpeechRequest {
	readonly text: string;
	readonly language: string;
	readonly voiceId: string;
	readonly speed: number;
}

export interface TextToSpeechVoice {
	readonly id: string;
	readonly language: string;
	readonly label: string;
}

export interface TextToSpeechLoaded {
	readonly installed: boolean;
	readonly voices: readonly TextToSpeechVoice[];
	readonly initial: TextToSpeechRequest | null;
	readonly placement: 'new-track' | 'regenerate-selected';
}

export interface TextToSpeechReviewed {
	readonly audio: Blob;
	readonly request: TextToSpeechRequest;
	readonly modelId: string;
	readonly modelVersion: string;
	readonly artifactSha256s: readonly string[];
}

export interface TextToSpeechPort {
	load(): Promise<TextToSpeechLoaded>;
	generate(request: TextToSpeechRequest, signal: AbortSignal): Promise<TextToSpeechReviewed>;
	accept(reviewed: TextToSpeechReviewed): Promise<void>;
}

export interface TextToSpeechProjectPort {
	loadInitial(): Promise<TextToSpeechRequest | null>;
	accept(reviewed: TextToSpeechReviewed): Promise<void>;
}
