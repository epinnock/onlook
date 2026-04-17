#include "OnlookRuntime.h"
#include <jsi/jsi.h>
#include <exception>
#include <functional>

namespace onlook {
namespace jsi = facebook::jsi;

// Post {kind, message, stack} to globalThis.OnlookRuntime.dispatchEvent('onlook:error', payload).
// Used by MC2.7+ runApplication/reloadBundle/dispatchEvent to funnel unhandled
// errors through a single JS-observable event. Safe when OnlookRuntime isn't
// installed yet (benign no-op + nativeLoggingHook breadcrumb).
void reportRuntimeError(jsi::Runtime& rt, const std::string& kind,
                         const std::string& message, const std::string& stack) {
  try {
    jsi::Value runtimeVal = rt.global().getProperty(rt, "OnlookRuntime");
    if (!runtimeVal.isObject()) return;
    jsi::Object onlookRuntime = runtimeVal.getObject(rt);
    jsi::Value dispatchVal = onlookRuntime.getProperty(rt, "dispatchEvent");
    if (!dispatchVal.isObject() || !dispatchVal.getObject(rt).isFunction(rt)) return;
    jsi::Object payload(rt);
    payload.setProperty(rt, "kind", jsi::String::createFromUtf8(rt, kind));
    payload.setProperty(rt, "message", jsi::String::createFromUtf8(rt, message));
    payload.setProperty(rt, "stack", jsi::String::createFromUtf8(rt, stack));
    dispatchVal.getObject(rt).getFunction(rt).callWithThis(
      rt, onlookRuntime,
      jsi::String::createFromUtf8(rt, "onlook:error"),
      std::move(payload));
  } catch (...) { /* swallow — reportRuntimeError must not throw */ }
}

// Run fn and convert any thrown exception into reportRuntimeError.
void captureAndReport(jsi::Runtime& rt, const std::function<void()>& fn) {
  try {
    fn();
  } catch (const jsi::JSError& err) {
    reportRuntimeError(rt, "js", err.getMessage(), err.getStack());
  } catch (const std::exception& err) {
    reportRuntimeError(rt, "native", err.what(), "");
  } catch (...) {
    reportRuntimeError(rt, "unknown", "unknown exception", "");
  }
}

} // namespace onlook
