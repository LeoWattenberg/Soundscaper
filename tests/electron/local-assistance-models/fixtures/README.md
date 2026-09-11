# Real inference fixtures

These small fixtures ship with the nightly test payload. Model weights are downloaded separately through the production installer. `model-inputs.js` verifies the SHA-256 of every committed media file before use.

| File | Source | SHA-256 | Rights |
| --- | --- | --- | --- |
| `jfk.wav` | [whisper.cpp v1.7.6 speech sample](https://github.com/ggml-org/whisper.cpp/blob/v1.7.6/samples/jfk.wav) | `59dfb9a4acb36fe2a2affc14bacbee2920ff435cb13cc314a08c13f66ba7860e` | Excerpt of John F. Kennedy's 1961 inaugural address; US federal government recording, public domain. |
| `astronaut.png` | [scikit-image v0.20.0 NASA astronaut sample](https://github.com/scikit-image/scikit-image/blob/v0.20.0/skimage/data/astronaut.png) | `88431cd9653ccd539741b555fb0a46b61558b301d4110412b5bc28b5e3ea6cb5` | NASA photograph of Eileen Collins, public domain, as documented by [scikit-image](https://scikit-image.org/docs/stable/api/skimage.data.html#skimage.data.astronaut). |
| `chelsea.png` | [scikit-image v0.20.0 Chelsea sample](https://github.com/scikit-image/scikit-image/blob/v0.20.0/skimage/data/chelsea.png) | `596aa1e7cb875eb79f437e310381d26b338a81c2da23439704a73c4651e8c4bb` | Photograph by Stefan van der Walt, released under CC0, as documented by [scikit-image](https://scikit-image.org/docs/0.20.x/api/skimage.data.html#skimage.data.chelsea). |

Speech preparation converts the original 16-bit, 16 kHz mono recording into float32 and adds one second of silence at either end. DeepFilterNet receives a linearly resampled 48 kHz version with reproducible low-level hiss. The astronaut and cat photographs become two 512 × 512 RGBA frames, fitted without distortion on a white canvas and retaining distinct source-frame timing. The astronaut supplies a visible human face and Chelsea supplies a clear object, so the subject test can require results from both networks at the production confidence thresholds. The OCR input is generated locally on a white canvas with black `LOCAL MODEL` and `TEST` text; it contains no third-party media.

The tests require real voiced or visual content so that an empty result cannot pass. They do not compare transcripts, boxes, or audio against golden model predictions, and do not measure restoration or recognition quality.
