// SPDX-License-Identifier: AGPL-3.0-only

/// Inspect the audio payload rather than counting headers or metadata as sound.
pub fn inspect_wav(bytes: &[u8]) -> (bool, bool) {
    match inspect(bytes) {
        Some(non_silent) => (true, non_silent),
        None => (false, false),
    }
}

fn inspect(bytes: &[u8]) -> Option<bool> {
    if bytes.get(..4)? != b"RIFF" || bytes.get(8..12)? != b"WAVE" {
        return None;
    }
    let end = (read_u32(bytes, 4)? as usize).checked_add(8)?;
    if end != bytes.len() || end < 12 {
        return None;
    }

    let mut cursor = 12_usize;
    let mut format = None;
    let mut data = None;
    while cursor < end {
        let payload_start = cursor.checked_add(8)?;
        if payload_start > end {
            return None;
        }
        let length = read_u32(bytes, cursor + 4)? as usize;
        let payload_end = payload_start.checked_add(length)?;
        let next = payload_end.checked_add(length % 2)?;
        if next > end {
            return None;
        }
        let payload = bytes.get(payload_start..payload_end)?;
        match bytes.get(cursor..cursor + 4)? {
            b"fmt " => {
                if format.is_some() {
                    return None;
                }
                format = Some(parse_format(payload)?);
            }
            b"data" => {
                if data.is_some() {
                    return None;
                }
                data = Some(payload);
            }
            _ => {}
        }
        cursor = next;
    }

    let format = format?;
    let data = data?;
    if data.is_empty() || data.len() % format.block_align != 0 {
        return None;
    }
    match format.encoding {
        Encoding::UnsignedPcm => Some(data.iter().any(|&byte| byte != 0x80)),
        Encoding::SignedPcm => Some(data.iter().any(|&byte| byte != 0)),
        Encoding::Float => {
            let mut non_silent = false;
            for sample in data.as_chunks::<4>().0 {
                let value = f32::from_le_bytes(*sample);
                if !value.is_finite() {
                    return None;
                }
                non_silent |= value != 0.0;
            }
            Some(non_silent)
        }
    }
}

enum Encoding {
    UnsignedPcm,
    SignedPcm,
    Float,
}

struct Format {
    encoding: Encoding,
    block_align: usize,
}

fn parse_format(bytes: &[u8]) -> Option<Format> {
    let tag = read_u16(bytes, 0)?;
    let channels = read_u16(bytes, 2)?;
    let sample_rate = read_u32(bytes, 4)?;
    let byte_rate = read_u32(bytes, 8)?;
    let block_align = read_u16(bytes, 12)?;
    let bits = read_u16(bytes, 14)?;
    let extension_size = if bytes.len() == 16 {
        0
    } else {
        let size = usize::from(read_u16(bytes, 16)?);
        if size.checked_add(18)? > bytes.len() {
            return None;
        }
        size
    };
    let subformat = if tag == 0xfffe {
        const GUID_TAIL: &[u8] = &[0, 0, 0x10, 0, 0x80, 0, 0, 0xaa, 0, 0x38, 0x9b, 0x71];
        if extension_size < 22 || bytes.get(28..40)? != GUID_TAIL {
            return None;
        }
        let valid_bits = read_u16(bytes, 18)?;
        if valid_bits == 0 || valid_bits > bits {
            return None;
        }
        let code = read_u32(bytes, 24)?;
        if code == 3 && valid_bits != bits {
            return None;
        }
        code
    } else {
        u32::from(tag)
    };
    let encoding = match (subformat, bits) {
        (1, 8) => Encoding::UnsignedPcm,
        (1, 16 | 24 | 32) => Encoding::SignedPcm,
        (3, 32) => Encoding::Float,
        _ => return None,
    };
    let expected_align = u32::from(channels).checked_mul(u32::from(bits / 8))?;
    if channels == 0
        || sample_rate == 0
        || expected_align != u32::from(block_align)
        || sample_rate.checked_mul(expected_align)? != byte_rate
    {
        return None;
    }
    Some(Format {
        encoding,
        block_align: usize::from(block_align),
    })
}

fn read_u16(bytes: &[u8], offset: usize) -> Option<u16> {
    Some(u16::from_le_bytes(
        bytes.get(offset..offset.checked_add(2)?)?.try_into().ok()?,
    ))
}

fn read_u32(bytes: &[u8], offset: usize) -> Option<u32> {
    Some(u32::from_le_bytes(
        bytes.get(offset..offset.checked_add(4)?)?.try_into().ok()?,
    ))
}

#[cfg(test)]
mod tests {
    use super::inspect_wav;

    fn chunk(id: &[u8; 4], payload: &[u8]) -> Vec<u8> {
        let mut result = id.to_vec();
        result.extend((payload.len() as u32).to_le_bytes());
        result.extend(payload);
        if !payload.len().is_multiple_of(2) {
            result.push(0);
        }
        result
    }

    fn format(tag: u16, bits: u16, channels: u16) -> Vec<u8> {
        let align = channels * bits / 8;
        let mut result = tag.to_le_bytes().to_vec();
        result.extend(channels.to_le_bytes());
        result.extend(48_000_u32.to_le_bytes());
        result.extend((48_000_u32 * u32::from(align)).to_le_bytes());
        result.extend(align.to_le_bytes());
        result.extend(bits.to_le_bytes());
        result
    }

    fn wave(chunks: &[Vec<u8>]) -> Vec<u8> {
        let size = 4 + chunks.iter().map(Vec::len).sum::<usize>();
        let mut result = b"RIFF".to_vec();
        result.extend((size as u32).to_le_bytes());
        result.extend(b"WAVE");
        for part in chunks {
            result.extend(part);
        }
        result
    }

    fn samples(tag: u16, bits: u16, payload: &[u8]) -> Vec<u8> {
        wave(&[
            chunk(b"fmt ", &format(tag, bits, 1)),
            chunk(b"data", payload),
        ])
    }

    fn extensible_format(tag: u32, bits: u16) -> Vec<u8> {
        let mut result = format(0xfffe, bits, 1);
        result.extend(22_u16.to_le_bytes());
        result.extend(bits.to_le_bytes());
        result.extend(0_u32.to_le_bytes());
        result.extend(tag.to_le_bytes());
        result.extend([0, 0, 0x10, 0, 0x80, 0, 0, 0xaa, 0, 0x38, 0x9b, 0x71]);
        result
    }

    #[test]
    fn actual_pcm_tone_is_valid_and_non_silent() {
        let payload: Vec<u8> = (0..480)
            .flat_map(|frame| {
                let phase = f64::from(frame) * 440.0 * std::f64::consts::TAU / 48_000.0;
                ((phase.sin() * 8_000.0) as i16).to_le_bytes()
            })
            .collect();
        assert_eq!(inspect_wav(&samples(1, 16, &payload)), (true, true));
    }

    #[test]
    fn nonzero_metadata_and_padding_do_not_count_as_audio() {
        let mut metadata = chunk(b"LIST", b"INFOodd");
        *metadata.last_mut().unwrap() = 0xff;
        let bytes = wave(&[
            metadata,
            chunk(b"fmt ", &format(1, 16, 1)),
            chunk(b"data", &[0; 16]),
            chunk(b"LIST", b"INFOafter audio"),
        ]);
        assert_eq!(inspect_wav(&bytes), (true, false));
    }

    #[test]
    fn pcm_silence_is_checked_for_each_supported_container_width() {
        for bits in [16, 24, 32] {
            let silent = vec![0; usize::from(bits / 8) * 4];
            assert_eq!(inspect_wav(&samples(1, bits, &silent)), (true, false));
            let mut signal = silent;
            *signal.last_mut().unwrap() = 0x80;
            assert_eq!(inspect_wav(&samples(1, bits, &signal)), (true, true));
        }
    }

    #[test]
    fn eight_bit_pcm_uses_unsigned_midpoint_silence() {
        assert_eq!(inspect_wav(&samples(1, 8, &[0x80; 4])), (true, false));
        assert_eq!(inspect_wav(&samples(1, 8, &[0x80, 0])), (true, true));
        assert_eq!(inspect_wav(&samples(1, 8, &[0; 4])), (true, true));
    }

    #[test]
    fn float_samples_use_values_and_reject_non_finite_audio() {
        let silence = [0.0_f32.to_le_bytes(), (-0.0_f32).to_le_bytes()].concat();
        assert_eq!(inspect_wav(&samples(3, 32, &silence)), (true, false));
        assert_eq!(
            inspect_wav(&samples(3, 32, &0.25_f32.to_le_bytes())),
            (true, true)
        );
        for invalid in [f32::NAN, f32::INFINITY, f32::NEG_INFINITY] {
            let payload = [0.25_f32.to_le_bytes(), invalid.to_le_bytes()].concat();
            assert_eq!(inspect_wav(&samples(3, 32, &payload)), (false, false));
        }
    }

    #[test]
    fn extensible_pcm_and_float_subformats_are_supported() {
        for (tag, bits, payload) in [
            (1, 24, vec![1, 0, 0]),
            (3, 32, 0.25_f32.to_le_bytes().to_vec()),
        ] {
            let bytes = wave(&[
                chunk(b"fmt ", &extensible_format(tag, bits)),
                chunk(b"data", &payload),
            ]);
            assert_eq!(inspect_wav(&bytes), (true, true));
        }
        let mut invalid = extensible_format(1, 24);
        invalid[39] = 0;
        assert_eq!(
            inspect_wav(&wave(&[chunk(b"fmt ", &invalid), chunk(b"data", &[0; 3])])),
            (false, false)
        );
    }

    #[test]
    fn truncated_chunks_and_headers_are_rejected_without_panicking() {
        let bytes = samples(1, 16, &[0, 1, 0, 0]);
        for length in 0..bytes.len() {
            assert_eq!(inspect_wav(&bytes[..length]), (false, false));
        }
        let mut oversized = bytes.clone();
        oversized[40..44].copy_from_slice(&u32::MAX.to_le_bytes());
        assert_eq!(inspect_wav(&oversized), (false, false));
        let mut extra = bytes;
        extra.push(0);
        assert_eq!(inspect_wav(&extra), (false, false));
        let mut missing_pad = samples(1, 8, &[0x80]);
        missing_pad.pop();
        let size = (missing_pad.len() - 8) as u32;
        missing_pad[4..8].copy_from_slice(&size.to_le_bytes());
        assert_eq!(inspect_wav(&missing_pad), (false, false));
    }

    #[test]
    fn malformed_format_geometry_and_partial_frames_are_rejected() {
        for (tag, bits) in [(2, 16), (1, 12), (3, 64)] {
            assert_eq!(inspect_wav(&samples(tag, bits, &[0; 8])), (false, false));
        }
        assert_eq!(inspect_wav(&samples(1, 16, &[0])), (false, false));
        assert_eq!(inspect_wav(&samples(1, 16, &[])), (false, false));
        let valid = format(1, 16, 2);
        for length in 0..valid.len() {
            let bytes = wave(&[chunk(b"fmt ", &valid[..length]), chunk(b"data", &[0; 4])]);
            assert_eq!(inspect_wav(&bytes), (false, false));
        }
        for offset in [2, 4, 8, 12] {
            let mut invalid = valid.clone();
            invalid[offset] = 0;
            invalid[offset + 1] = 0;
            let bytes = wave(&[chunk(b"fmt ", &invalid), chunk(b"data", &[0; 4])]);
            assert_eq!(inspect_wav(&bytes), (false, false));
        }
    }

    #[test]
    fn format_and_data_are_required_and_duplicates_are_rejected() {
        let fmt = chunk(b"fmt ", &format(1, 16, 1));
        let data = chunk(b"data", &[0; 4]);
        assert_eq!(inspect_wav(&wave(&[])), (false, false));
        assert_eq!(
            inspect_wav(&wave(std::slice::from_ref(&fmt))),
            (false, false)
        );
        assert_eq!(
            inspect_wav(&wave(std::slice::from_ref(&data))),
            (false, false)
        );
        assert_eq!(
            inspect_wav(&wave(&[fmt.clone(), fmt.clone(), data.clone()])),
            (false, false)
        );
        assert_eq!(
            inspect_wav(&wave(&[fmt, data.clone(), data])),
            (false, false)
        );
    }
}
