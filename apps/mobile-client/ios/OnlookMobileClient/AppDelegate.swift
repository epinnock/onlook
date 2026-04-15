import Expo
import React
import ReactAppDependencyProvider

@UIApplicationMain
public class AppDelegate: ExpoAppDelegate {
  var window: UIWindow?

  var reactNativeDelegate: ExpoReactNativeFactoryDelegate?
  var reactNativeFactory: RCTReactNativeFactory?

  public override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    let delegate = ReactNativeDelegate()
    let factory = ExpoReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()

    reactNativeDelegate = delegate
    reactNativeFactory = factory
    bindReactNativeFactory(factory)

#if os(iOS) || os(tvOS)
    window = UIWindow(frame: UIScreen.main.bounds)
    factory.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: launchOptions)
#endif

    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  // Linking API
  public override func application(
    _ app: UIApplication,
    open url: URL,
    options: [UIApplication.OpenURLOptionsKey: Any] = [:]
  ) -> Bool {
    return super.application(app, open: url, options: options) || RCTLinkingManager.application(app, open: url, options: options)
  }

  // Universal Links
  public override func application(
    _ application: UIApplication,
    continue userActivity: NSUserActivity,
    restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void
  ) -> Bool {
    let result = RCTLinkingManager.application(application, continue: userActivity, restorationHandler: restorationHandler)
    return super.application(application, continue: userActivity, restorationHandler: restorationHandler) || result
  }
}

class ReactNativeDelegate: ExpoReactNativeFactoryDelegate {
  // Extension point for config-plugins

  override func sourceURL(for bridge: RCTBridge) -> URL? {
    // needed to return the correct URL for expo-dev-client.
    bridge.bundleURL ?? bundleURL()
  }

  override func bundleURL() -> URL? {
    // MC1.4: this is the single seam where we inject onlook-runtime.js into
    // the JS Hermes will evaluate. Under bridgeless / new-arch mode (which
    // our app.config enables via `newArchEnabled: true`), `RCTHost` loads
    // the bundle directly from the URL returned here and never consults
    // the delegate's `loadSource:` / `loadBundleAtURL:` hooks — verified by
    // adding `NSLog`s to both and observing only `bundleURL()` fires. So we
    // compose the combined bundle here as a file write and return its URL,
    // letting Hermes treat it as one ordinary JS bundle.
    //
    // Strategy: read the baked main.jsbundle (`expo export:embed` output
    // committed to OnlookMobileClient/Resources by run-build.ts) + the
    // baked onlook-runtime.js (MCF11 / 59fc46f3), concatenate with a
    // newline separator, write to NSTemporaryDirectory, return that URL.
    // If no baked main.jsbundle exists (typical dev workflow), fall
    // through to Metro for DEBUG and let the developer run a dev server
    // by hand.
    //
    // Metro path doesn't get the runtime injection yet — needs a Metro
    // serializer plugin to prepend at bundling time, which is a separate
    // task. The smoke-test simulator build always uses the baked path.
    guard let bakedUserBundle = Bundle.main.url(forResource: "main", withExtension: "jsbundle") else {
#if DEBUG
      NSLog("[onlook-runtime] no baked main.jsbundle — falling through to Metro (runtime injection skipped, dev only)")
      return RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: ".expo/.virtual-metro-entry")
#else
      NSLog("[onlook-runtime] no baked main.jsbundle in RELEASE — fatal")
      return nil
#endif
    }
    do {
      let userData = try Data(contentsOf: bakedUserBundle, options: .mappedIfSafe)
      let combined = HermesBootstrap.prepend(into: userData)
      let combinedURL = URL(fileURLWithPath: NSTemporaryDirectory())
        .appendingPathComponent("onlook-combined.jsbundle")
      try combined.write(to: combinedURL, options: .atomic)
      NSLog("[onlook-runtime] composed combined bundle (\(combined.count) bytes) at \(combinedURL.path)")
      return combinedURL
    } catch {
      NSLog("[onlook-runtime] failed to compose combined bundle: \(error.localizedDescription) — falling back to user bundle alone")
      return bakedUserBundle
    }
  }
}
