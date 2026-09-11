/* SPDX-License-Identifier: AGPL-3.0-only */
const NAMES: Readonly<Record<string, string>> = {
	'deepfilternet3': 'DeepFilterNet 3',
	'dereverb-room': 'Room Dereverberation',
	'tiger-dnr': 'TIGER Dialogue / Music / Effects',
	'silero-vad-v6': 'Silero Voice Activity Detection',
	'parakeet-tdt-0.6b-v3': 'Parakeet TDT 0.6B v3',
	'whisper-large-v3-turbo-ggml': 'Whisper Large v3 Turbo',
	'wav2vec2-base-960h': 'Wav2Vec2 English Alignment',
	'pyannote-segmentation-3.0': 'Pyannote Speaker Segmentation',
	'speech-3d-speaker-eres2net': 'ERes2Net Speaker Embedding',
	'panns-cnn10': 'PANNs Audio Tagging',
	'beat-this-small0': 'Beat This!',
	'nomic-embed-text-v1.5': 'Nomic Text Embeddings',
	'transnetv2': 'TransNet V2',
	'siglip2-base-patch16-224': 'SigLIP 2 Visual Embeddings',
	'ppocr-v4-mobile': 'PP-OCR v4',
	'yunet-face-detection-2026may': 'YuNet Face Detection',
	'dfine-nano-coco': 'D-FINE Object Detection',
	'u2netp-saliency': 'U²-Net Saliency',
	'qwen3-4b-q4-k-m': 'Qwen 3 4B',
};
export function localModelDisplayName(modelId: string): string {
	return NAMES[modelId] ?? modelId.replaceAll('-', ' ').replace(/^./u, (first) => first.toUpperCase());
}
