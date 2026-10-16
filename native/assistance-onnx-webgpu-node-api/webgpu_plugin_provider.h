/* SPDX-License-Identifier: AGPL-3.0-only */
#pragma once

#include "onnxruntime_cxx_api.h"
#include <string>
#include <unordered_map>

void ScapeAppendWebGpuPlugin(Ort::SessionOptions& options,
	const std::unordered_map<std::string, std::string>& provider_options);
