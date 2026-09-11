# SPDX-License-Identifier: AGPL-3.0-only
cmake_minimum_required(VERSION 3.21)
cmake_policy(SET CMP0091 NEW)
project(soundscaper_sherpa_node_api LANGUAGES CXX)

if(NOT WIN32 OR NOT CMAKE_GENERATOR_PLATFORM STREQUAL "ARM64")
  message(FATAL_ERROR "The Sherpa package recipe requires the Windows ARM64 target")
endif()
foreach(required SHERPA_SOURCE SHERPA_NATIVE NODE_HEADERS NODE_ADDON_API NODE_LIBRARY NODE_DELAY_HOOK SCAPE_WORK_ROOT)
  if(NOT DEFINED ${required} OR NOT EXISTS "${${required}}")
    message(FATAL_ERROR "Missing authenticated ${required}")
  endif()
endforeach()

set(addon_source "${SHERPA_SOURCE}/harmony-os/SherpaOnnxHar/sherpa_onnx/src/main/cpp")
set(source_names
  audio-tagging.cc keyword-spotting.cc non-streaming-asr.cc
  non-streaming-speaker-diarization.cc non-streaming-speech-denoiser.cc
  non-streaming-tts.cc offline-punctuation.cc online-punctuation.cc
  streaming-speech-denoiser.cc sherpa-onnx-node-addon-api.cc
  speaker-identification.cc spoken-language-identification.cc streaming-asr.cc
  vad.cc version.cc wave-reader.cc wave-writer.cc resampler.cc)
list(TRANSFORM source_names PREPEND "${addon_source}/")
add_library(sherpa-onnx SHARED ${source_names} "${NODE_DELAY_HOOK}")
set_target_properties(sherpa-onnx PROPERTIES
  PREFIX "" SUFFIX ".node" CXX_STANDARD 17 CXX_STANDARD_REQUIRED ON
  MSVC_RUNTIME_LIBRARY MultiThreaded)
target_include_directories(sherpa-onnx PRIVATE
  "${addon_source}" "${SHERPA_SOURCE}" "${NODE_HEADERS}/include/node" "${NODE_ADDON_API}")
target_compile_definitions(sherpa-onnx PRIVATE
  NAPI_VERSION=8 NODE_GYP_MODULE_NAME=addon HOST_BINARY="node.exe")
target_compile_options(sherpa-onnx PRIVATE /Brepro "/pathmap:${SCAPE_WORK_ROOT}=/usr/src/sherpa-node-api")
target_link_libraries(sherpa-onnx PRIVATE
  "${SHERPA_NATIVE}/lib/sherpa-onnx-c-api.lib"
  "${SHERPA_NATIVE}/lib/onnxruntime.lib" "${NODE_LIBRARY}" delayimp)
# Resolve Node-API symbols from Electron's renamed utility-process executable.
target_link_options(sherpa-onnx PRIVATE /DELAYLOAD:node.exe /Brepro)
