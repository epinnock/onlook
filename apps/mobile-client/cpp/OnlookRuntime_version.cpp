// Copyright Onlook 2026
//
// OnlookRuntime_version.cpp — single compilation unit that turns the
// build-time `ONLOOK_RUNTIME_VERSION_STRING` macro (written by
// apps/mobile-client/scripts/generate-version-header.ts from the
// `@onlook/mobile-client-protocol` TS constant) into a stable
// `const std::string&` the rest of the runtime can return without
// re-parsing. Isolating the macro in a .cpp keeps `OnlookRuntime.cpp`
// free of generated-header includes so its compile doesn't invalidate
// on every version bump.
//
// Wave 2 task MC2.12 of plans/onlook-mobile-client-task-queue.md.

#include "OnlookRuntime.h"
#include "OnlookRuntime_version.generated.h"

namespace onlook {

std::string getRuntimeVersion() {
  return std::string(ONLOOK_RUNTIME_VERSION_STRING);
}

}  // namespace onlook
