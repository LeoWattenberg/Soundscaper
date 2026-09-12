---
license: gpl-3.0
---
A dereverb model specifically for mono vocal room reverb.

**Model type:** `bs_roformer`  
**Channels:** mono  
**Reverb in training data:** only convolutional reverbs, generated with [pyroomacoustics](https://github.com/LCAV/pyroomacoustics)  
**Example:**
- input.flac
<audio controls>
  <source src="https://huggingface.co/anvuew/dereverb_room/resolve/main/example/input.flac" type="audio/flac">
</audio>
- noreverb.flac
<audio controls>
  <source src="https://huggingface.co/anvuew/dereverb_room/resolve/main/example/noreverb.flac" type="audio/flac">
</audio>
- reverb.flac
<audio controls>
  <source src="https://huggingface.co/anvuew/dereverb_room/resolve/main/example/reverb.flac" type="audio/flac">
</audio>

for refercence [dereverb_mel_band_roformer_mono](https://huggingface.co/anvuew/dereverb_mel_band_roformer/blob/main/dereverb_mel_band_roformer_mono_anvuew_sdr_20.4029.ckpt) got SDR: 7.6685 on same valid set.