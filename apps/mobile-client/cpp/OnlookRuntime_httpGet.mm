// Copyright Onlook 2026
//
// OnlookRuntime::httpGet — synchronous HTTP GET via NSURLSession, bypassing
// RCTNetworking. Used to work around task #81: under bridgeless iOS 18.6
// React Native's fetch + XHR accept requests but never dispatch completion
// events back to JS. Since manifests and bundles are small (<100KB) and
// latency is typically <50ms, blocking the JS thread briefly is acceptable.
//
// Signature (JS-observable via `globalThis.OnlookRuntime.httpGet`):
//   httpGet(url: string, headers?: Record<string,string>)
//     → { ok: boolean, status: number, body: string,
//         contentType: string, error?: string }
//
// Thread-safety: NSURLSession's completion handler runs on a background
// delegate queue, so we can safely block the JS thread with a
// dispatch_semaphore without deadlocking on main. The session itself is
// `sharedSession` since we don't need per-request config.

#include "OnlookRuntime.h"

#import <Foundation/Foundation.h>

#include <jsi/jsi.h>

#include <string>

namespace onlook {

namespace jsi = facebook::jsi;

jsi::Value httpGetImpl(
    jsi::Runtime& rt,
    const jsi::Value* args,
    size_t count) {
  // ── arg validation ─────────────────────────────────────────────────
  if (count < 1 || !args[0].isString()) {
    throw jsi::JSError(rt, "OnlookRuntime.httpGet(url, headers?) requires url: string");
  }
  std::string urlCpp = args[0].asString(rt).utf8(rt);

  NSString* urlString = [NSString stringWithUTF8String:urlCpp.c_str()];
  NSURL* url = [NSURL URLWithString:urlString];
  if (!url) {
    jsi::Object err(rt);
    err.setProperty(rt, "ok", jsi::Value(false));
    err.setProperty(rt, "status", jsi::Value(0));
    err.setProperty(rt, "body", jsi::String::createFromUtf8(rt, ""));
    err.setProperty(rt, "contentType", jsi::String::createFromUtf8(rt, ""));
    err.setProperty(rt, "error", jsi::String::createFromUtf8(rt, "invalid url"));
    return jsi::Value(rt, err);
  }

  NSMutableURLRequest* req = [NSMutableURLRequest requestWithURL:url];
  req.HTTPMethod = @"GET";
  // 10-second upper bound on a single GET. Longer than any reasonable
  // manifest/bundle response; short enough that a stuck network doesn't
  // freeze the JS thread indefinitely.
  req.timeoutInterval = 10.0;

  // ── optional headers: { [string]: string } ─────────────────────────
  if (count >= 2 && args[1].isObject()) {
    jsi::Object headers = args[1].asObject(rt);
    jsi::Array names = headers.getPropertyNames(rt);
    size_t nameCount = names.size(rt);
    for (size_t i = 0; i < nameCount; ++i) {
      jsi::Value nameVal = names.getValueAtIndex(rt, i);
      if (!nameVal.isString()) continue;
      std::string name = nameVal.asString(rt).utf8(rt);
      jsi::Value val = headers.getProperty(rt, name.c_str());
      if (!val.isString()) continue;
      std::string v = val.asString(rt).utf8(rt);
      [req setValue:[NSString stringWithUTF8String:v.c_str()]
          forHTTPHeaderField:[NSString stringWithUTF8String:name.c_str()]];
    }
  }

  // ── synchronous GET via semaphore ──────────────────────────────────
  __block NSData* responseData = nil;
  __block NSHTTPURLResponse* httpResponse = nil;
  __block NSError* responseError = nil;
  dispatch_semaphore_t sem = dispatch_semaphore_create(0);

  NSURLSessionDataTask* task = [[NSURLSession sharedSession]
      dataTaskWithRequest:req
        completionHandler:^(NSData* data, NSURLResponse* resp, NSError* error) {
          responseData = data;
          if ([resp isKindOfClass:[NSHTTPURLResponse class]]) {
            httpResponse = (NSHTTPURLResponse*)resp;
          }
          responseError = error;
          dispatch_semaphore_signal(sem);
        }];
  [task resume];
  dispatch_semaphore_wait(sem, DISPATCH_TIME_FOREVER);

  // ── marshal result ─────────────────────────────────────────────────
  jsi::Object result(rt);

  if (responseError) {
    result.setProperty(rt, "ok", jsi::Value(false));
    result.setProperty(rt, "status", jsi::Value(0));
    result.setProperty(rt, "body", jsi::String::createFromUtf8(rt, ""));
    result.setProperty(rt, "contentType", jsi::String::createFromUtf8(rt, ""));
    NSString* desc = responseError.localizedDescription ?: @"network error";
    result.setProperty(
        rt, "error", jsi::String::createFromUtf8(rt, [desc UTF8String]));
    return jsi::Value(rt, result);
  }

  NSInteger status = httpResponse ? httpResponse.statusCode : 0;
  NSString* contentType = @"";
  if (httpResponse) {
    NSString* ct = httpResponse.allHeaderFields[@"Content-Type"];
    if (!ct) ct = httpResponse.allHeaderFields[@"content-type"];
    if (ct) contentType = ct;
  }

  std::string bodyStr;
  if (responseData && responseData.length > 0) {
    bodyStr.assign(
        static_cast<const char*>(responseData.bytes),
        static_cast<size_t>(responseData.length));
  }

  result.setProperty(rt, "ok", jsi::Value(status >= 200 && status < 300));
  result.setProperty(rt, "status", jsi::Value(static_cast<double>(status)));
  result.setProperty(rt, "body", jsi::String::createFromUtf8(rt, bodyStr));
  result.setProperty(
      rt,
      "contentType",
      jsi::String::createFromUtf8(rt, [contentType UTF8String]));
  return jsi::Value(rt, result);
}

}  // namespace onlook
