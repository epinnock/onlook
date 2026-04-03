var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// ../../node_modules/unenv/dist/runtime/_internal/utils.mjs
// @__NO_SIDE_EFFECTS__
function createNotImplementedError(name) {
  return new Error(`[unenv] ${name} is not implemented yet!`);
}
__name(createNotImplementedError, "createNotImplementedError");
// @__NO_SIDE_EFFECTS__
function notImplemented(name) {
  const fn = /* @__PURE__ */ __name(() => {
    throw /* @__PURE__ */ createNotImplementedError(name);
  }, "fn");
  return Object.assign(fn, { __unenv__: true });
}
__name(notImplemented, "notImplemented");
// @__NO_SIDE_EFFECTS__
function notImplementedClass(name) {
  return class {
    __unenv__ = true;
    constructor() {
      throw new Error(`[unenv] ${name} is not implemented yet!`);
    }
  };
}
__name(notImplementedClass, "notImplementedClass");

// ../../node_modules/unenv/dist/runtime/node/internal/perf_hooks/performance.mjs
var _timeOrigin = globalThis.performance?.timeOrigin ?? Date.now();
var _performanceNow = globalThis.performance?.now ? globalThis.performance.now.bind(globalThis.performance) : () => Date.now() - _timeOrigin;
var nodeTiming = {
  name: "node",
  entryType: "node",
  startTime: 0,
  duration: 0,
  nodeStart: 0,
  v8Start: 0,
  bootstrapComplete: 0,
  environment: 0,
  loopStart: 0,
  loopExit: 0,
  idleTime: 0,
  uvMetricsInfo: {
    loopCount: 0,
    events: 0,
    eventsWaiting: 0
  },
  detail: void 0,
  toJSON() {
    return this;
  }
};
var PerformanceEntry = class {
  static {
    __name(this, "PerformanceEntry");
  }
  __unenv__ = true;
  detail;
  entryType = "event";
  name;
  startTime;
  constructor(name, options) {
    this.name = name;
    this.startTime = options?.startTime || _performanceNow();
    this.detail = options?.detail;
  }
  get duration() {
    return _performanceNow() - this.startTime;
  }
  toJSON() {
    return {
      name: this.name,
      entryType: this.entryType,
      startTime: this.startTime,
      duration: this.duration,
      detail: this.detail
    };
  }
};
var PerformanceMark = class PerformanceMark2 extends PerformanceEntry {
  static {
    __name(this, "PerformanceMark");
  }
  entryType = "mark";
  constructor() {
    super(...arguments);
  }
  get duration() {
    return 0;
  }
};
var PerformanceMeasure = class extends PerformanceEntry {
  static {
    __name(this, "PerformanceMeasure");
  }
  entryType = "measure";
};
var PerformanceResourceTiming = class extends PerformanceEntry {
  static {
    __name(this, "PerformanceResourceTiming");
  }
  entryType = "resource";
  serverTiming = [];
  connectEnd = 0;
  connectStart = 0;
  decodedBodySize = 0;
  domainLookupEnd = 0;
  domainLookupStart = 0;
  encodedBodySize = 0;
  fetchStart = 0;
  initiatorType = "";
  name = "";
  nextHopProtocol = "";
  redirectEnd = 0;
  redirectStart = 0;
  requestStart = 0;
  responseEnd = 0;
  responseStart = 0;
  secureConnectionStart = 0;
  startTime = 0;
  transferSize = 0;
  workerStart = 0;
  responseStatus = 0;
};
var PerformanceObserverEntryList = class {
  static {
    __name(this, "PerformanceObserverEntryList");
  }
  __unenv__ = true;
  getEntries() {
    return [];
  }
  getEntriesByName(_name, _type) {
    return [];
  }
  getEntriesByType(type) {
    return [];
  }
};
var Performance = class {
  static {
    __name(this, "Performance");
  }
  __unenv__ = true;
  timeOrigin = _timeOrigin;
  eventCounts = /* @__PURE__ */ new Map();
  _entries = [];
  _resourceTimingBufferSize = 0;
  navigation = void 0;
  timing = void 0;
  timerify(_fn, _options) {
    throw createNotImplementedError("Performance.timerify");
  }
  get nodeTiming() {
    return nodeTiming;
  }
  eventLoopUtilization() {
    return {};
  }
  markResourceTiming() {
    return new PerformanceResourceTiming("");
  }
  onresourcetimingbufferfull = null;
  now() {
    if (this.timeOrigin === _timeOrigin) {
      return _performanceNow();
    }
    return Date.now() - this.timeOrigin;
  }
  clearMarks(markName) {
    this._entries = markName ? this._entries.filter((e) => e.name !== markName) : this._entries.filter((e) => e.entryType !== "mark");
  }
  clearMeasures(measureName) {
    this._entries = measureName ? this._entries.filter((e) => e.name !== measureName) : this._entries.filter((e) => e.entryType !== "measure");
  }
  clearResourceTimings() {
    this._entries = this._entries.filter((e) => e.entryType !== "resource" || e.entryType !== "navigation");
  }
  getEntries() {
    return this._entries;
  }
  getEntriesByName(name, type) {
    return this._entries.filter((e) => e.name === name && (!type || e.entryType === type));
  }
  getEntriesByType(type) {
    return this._entries.filter((e) => e.entryType === type);
  }
  mark(name, options) {
    const entry = new PerformanceMark(name, options);
    this._entries.push(entry);
    return entry;
  }
  measure(measureName, startOrMeasureOptions, endMark) {
    let start;
    let end;
    if (typeof startOrMeasureOptions === "string") {
      start = this.getEntriesByName(startOrMeasureOptions, "mark")[0]?.startTime;
      end = this.getEntriesByName(endMark, "mark")[0]?.startTime;
    } else {
      start = Number.parseFloat(startOrMeasureOptions?.start) || this.now();
      end = Number.parseFloat(startOrMeasureOptions?.end) || this.now();
    }
    const entry = new PerformanceMeasure(measureName, {
      startTime: start,
      detail: {
        start,
        end
      }
    });
    this._entries.push(entry);
    return entry;
  }
  setResourceTimingBufferSize(maxSize) {
    this._resourceTimingBufferSize = maxSize;
  }
  addEventListener(type, listener, options) {
    throw createNotImplementedError("Performance.addEventListener");
  }
  removeEventListener(type, listener, options) {
    throw createNotImplementedError("Performance.removeEventListener");
  }
  dispatchEvent(event) {
    throw createNotImplementedError("Performance.dispatchEvent");
  }
  toJSON() {
    return this;
  }
};
var PerformanceObserver = class {
  static {
    __name(this, "PerformanceObserver");
  }
  __unenv__ = true;
  static supportedEntryTypes = [];
  _callback = null;
  constructor(callback) {
    this._callback = callback;
  }
  takeRecords() {
    return [];
  }
  disconnect() {
    throw createNotImplementedError("PerformanceObserver.disconnect");
  }
  observe(options) {
    throw createNotImplementedError("PerformanceObserver.observe");
  }
  bind(fn) {
    return fn;
  }
  runInAsyncScope(fn, thisArg, ...args) {
    return fn.call(thisArg, ...args);
  }
  asyncId() {
    return 0;
  }
  triggerAsyncId() {
    return 0;
  }
  emitDestroy() {
    return this;
  }
};
var performance = globalThis.performance && "addEventListener" in globalThis.performance ? globalThis.performance : new Performance();

// ../../node_modules/@cloudflare/unenv-preset/dist/runtime/polyfill/performance.mjs
if (!("__unenv__" in performance)) {
  const proto = Performance.prototype;
  for (const key of Object.getOwnPropertyNames(proto)) {
    if (key !== "constructor" && !(key in performance)) {
      const desc = Object.getOwnPropertyDescriptor(proto, key);
      if (desc) {
        Object.defineProperty(performance, key, desc);
      }
    }
  }
}
globalThis.performance = performance;
globalThis.Performance = Performance;
globalThis.PerformanceEntry = PerformanceEntry;
globalThis.PerformanceMark = PerformanceMark;
globalThis.PerformanceMeasure = PerformanceMeasure;
globalThis.PerformanceObserver = PerformanceObserver;
globalThis.PerformanceObserverEntryList = PerformanceObserverEntryList;
globalThis.PerformanceResourceTiming = PerformanceResourceTiming;

// ../../node_modules/unenv/dist/runtime/node/console.mjs
import { Writable } from "node:stream";

// ../../node_modules/unenv/dist/runtime/mock/noop.mjs
var noop_default = Object.assign(() => {
}, { __unenv__: true });

// ../../node_modules/unenv/dist/runtime/node/console.mjs
var _console = globalThis.console;
var _ignoreErrors = true;
var _stderr = new Writable();
var _stdout = new Writable();
var log = _console?.log ?? noop_default;
var info = _console?.info ?? log;
var trace = _console?.trace ?? info;
var debug = _console?.debug ?? log;
var table = _console?.table ?? log;
var error = _console?.error ?? log;
var warn = _console?.warn ?? error;
var createTask = _console?.createTask ?? /* @__PURE__ */ notImplemented("console.createTask");
var clear = _console?.clear ?? noop_default;
var count = _console?.count ?? noop_default;
var countReset = _console?.countReset ?? noop_default;
var dir = _console?.dir ?? noop_default;
var dirxml = _console?.dirxml ?? noop_default;
var group = _console?.group ?? noop_default;
var groupEnd = _console?.groupEnd ?? noop_default;
var groupCollapsed = _console?.groupCollapsed ?? noop_default;
var profile = _console?.profile ?? noop_default;
var profileEnd = _console?.profileEnd ?? noop_default;
var time = _console?.time ?? noop_default;
var timeEnd = _console?.timeEnd ?? noop_default;
var timeLog = _console?.timeLog ?? noop_default;
var timeStamp = _console?.timeStamp ?? noop_default;
var Console = _console?.Console ?? /* @__PURE__ */ notImplementedClass("console.Console");
var _times = /* @__PURE__ */ new Map();
var _stdoutErrorHandler = noop_default;
var _stderrErrorHandler = noop_default;

// ../../node_modules/@cloudflare/unenv-preset/dist/runtime/node/console.mjs
var workerdConsole = globalThis["console"];
var {
  assert,
  clear: clear2,
  // @ts-expect-error undocumented public API
  context,
  count: count2,
  countReset: countReset2,
  // @ts-expect-error undocumented public API
  createTask: createTask2,
  debug: debug2,
  dir: dir2,
  dirxml: dirxml2,
  error: error2,
  group: group2,
  groupCollapsed: groupCollapsed2,
  groupEnd: groupEnd2,
  info: info2,
  log: log2,
  profile: profile2,
  profileEnd: profileEnd2,
  table: table2,
  time: time2,
  timeEnd: timeEnd2,
  timeLog: timeLog2,
  timeStamp: timeStamp2,
  trace: trace2,
  warn: warn2
} = workerdConsole;
Object.assign(workerdConsole, {
  Console,
  _ignoreErrors,
  _stderr,
  _stderrErrorHandler,
  _stdout,
  _stdoutErrorHandler,
  _times
});
var console_default = workerdConsole;

// ../../node_modules/wrangler/_virtual_unenv_global_polyfill-@cloudflare-unenv-preset-node-console
globalThis.console = console_default;

// ../../node_modules/unenv/dist/runtime/node/internal/process/hrtime.mjs
var hrtime = /* @__PURE__ */ Object.assign(/* @__PURE__ */ __name(function hrtime2(startTime) {
  const now = Date.now();
  const seconds = Math.trunc(now / 1e3);
  const nanos = now % 1e3 * 1e6;
  if (startTime) {
    let diffSeconds = seconds - startTime[0];
    let diffNanos = nanos - startTime[0];
    if (diffNanos < 0) {
      diffSeconds = diffSeconds - 1;
      diffNanos = 1e9 + diffNanos;
    }
    return [diffSeconds, diffNanos];
  }
  return [seconds, nanos];
}, "hrtime"), { bigint: /* @__PURE__ */ __name(function bigint() {
  return BigInt(Date.now() * 1e6);
}, "bigint") });

// ../../node_modules/unenv/dist/runtime/node/internal/process/process.mjs
import { EventEmitter } from "node:events";

// ../../node_modules/unenv/dist/runtime/node/internal/tty/read-stream.mjs
var ReadStream = class {
  static {
    __name(this, "ReadStream");
  }
  fd;
  isRaw = false;
  isTTY = false;
  constructor(fd) {
    this.fd = fd;
  }
  setRawMode(mode) {
    this.isRaw = mode;
    return this;
  }
};

// ../../node_modules/unenv/dist/runtime/node/internal/tty/write-stream.mjs
var WriteStream = class {
  static {
    __name(this, "WriteStream");
  }
  fd;
  columns = 80;
  rows = 24;
  isTTY = false;
  constructor(fd) {
    this.fd = fd;
  }
  clearLine(dir3, callback) {
    callback && callback();
    return false;
  }
  clearScreenDown(callback) {
    callback && callback();
    return false;
  }
  cursorTo(x, y, callback) {
    callback && typeof callback === "function" && callback();
    return false;
  }
  moveCursor(dx, dy, callback) {
    callback && callback();
    return false;
  }
  getColorDepth(env2) {
    return 1;
  }
  hasColors(count3, env2) {
    return false;
  }
  getWindowSize() {
    return [this.columns, this.rows];
  }
  write(str, encoding, cb) {
    if (str instanceof Uint8Array) {
      str = new TextDecoder().decode(str);
    }
    try {
      console.log(str);
    } catch {
    }
    cb && typeof cb === "function" && cb();
    return false;
  }
};

// ../../node_modules/unenv/dist/runtime/node/internal/process/node-version.mjs
var NODE_VERSION = "22.14.0";

// ../../node_modules/unenv/dist/runtime/node/internal/process/process.mjs
var Process = class _Process extends EventEmitter {
  static {
    __name(this, "Process");
  }
  env;
  hrtime;
  nextTick;
  constructor(impl) {
    super();
    this.env = impl.env;
    this.hrtime = impl.hrtime;
    this.nextTick = impl.nextTick;
    for (const prop of [...Object.getOwnPropertyNames(_Process.prototype), ...Object.getOwnPropertyNames(EventEmitter.prototype)]) {
      const value = this[prop];
      if (typeof value === "function") {
        this[prop] = value.bind(this);
      }
    }
  }
  // --- event emitter ---
  emitWarning(warning, type, code) {
    console.warn(`${code ? `[${code}] ` : ""}${type ? `${type}: ` : ""}${warning}`);
  }
  emit(...args) {
    return super.emit(...args);
  }
  listeners(eventName) {
    return super.listeners(eventName);
  }
  // --- stdio (lazy initializers) ---
  #stdin;
  #stdout;
  #stderr;
  get stdin() {
    return this.#stdin ??= new ReadStream(0);
  }
  get stdout() {
    return this.#stdout ??= new WriteStream(1);
  }
  get stderr() {
    return this.#stderr ??= new WriteStream(2);
  }
  // --- cwd ---
  #cwd = "/";
  chdir(cwd2) {
    this.#cwd = cwd2;
  }
  cwd() {
    return this.#cwd;
  }
  // --- dummy props and getters ---
  arch = "";
  platform = "";
  argv = [];
  argv0 = "";
  execArgv = [];
  execPath = "";
  title = "";
  pid = 200;
  ppid = 100;
  get version() {
    return `v${NODE_VERSION}`;
  }
  get versions() {
    return { node: NODE_VERSION };
  }
  get allowedNodeEnvironmentFlags() {
    return /* @__PURE__ */ new Set();
  }
  get sourceMapsEnabled() {
    return false;
  }
  get debugPort() {
    return 0;
  }
  get throwDeprecation() {
    return false;
  }
  get traceDeprecation() {
    return false;
  }
  get features() {
    return {};
  }
  get release() {
    return {};
  }
  get connected() {
    return false;
  }
  get config() {
    return {};
  }
  get moduleLoadList() {
    return [];
  }
  constrainedMemory() {
    return 0;
  }
  availableMemory() {
    return 0;
  }
  uptime() {
    return 0;
  }
  resourceUsage() {
    return {};
  }
  // --- noop methods ---
  ref() {
  }
  unref() {
  }
  // --- unimplemented methods ---
  umask() {
    throw createNotImplementedError("process.umask");
  }
  getBuiltinModule() {
    return void 0;
  }
  getActiveResourcesInfo() {
    throw createNotImplementedError("process.getActiveResourcesInfo");
  }
  exit() {
    throw createNotImplementedError("process.exit");
  }
  reallyExit() {
    throw createNotImplementedError("process.reallyExit");
  }
  kill() {
    throw createNotImplementedError("process.kill");
  }
  abort() {
    throw createNotImplementedError("process.abort");
  }
  dlopen() {
    throw createNotImplementedError("process.dlopen");
  }
  setSourceMapsEnabled() {
    throw createNotImplementedError("process.setSourceMapsEnabled");
  }
  loadEnvFile() {
    throw createNotImplementedError("process.loadEnvFile");
  }
  disconnect() {
    throw createNotImplementedError("process.disconnect");
  }
  cpuUsage() {
    throw createNotImplementedError("process.cpuUsage");
  }
  setUncaughtExceptionCaptureCallback() {
    throw createNotImplementedError("process.setUncaughtExceptionCaptureCallback");
  }
  hasUncaughtExceptionCaptureCallback() {
    throw createNotImplementedError("process.hasUncaughtExceptionCaptureCallback");
  }
  initgroups() {
    throw createNotImplementedError("process.initgroups");
  }
  openStdin() {
    throw createNotImplementedError("process.openStdin");
  }
  assert() {
    throw createNotImplementedError("process.assert");
  }
  binding() {
    throw createNotImplementedError("process.binding");
  }
  // --- attached interfaces ---
  permission = { has: /* @__PURE__ */ notImplemented("process.permission.has") };
  report = {
    directory: "",
    filename: "",
    signal: "SIGUSR2",
    compact: false,
    reportOnFatalError: false,
    reportOnSignal: false,
    reportOnUncaughtException: false,
    getReport: /* @__PURE__ */ notImplemented("process.report.getReport"),
    writeReport: /* @__PURE__ */ notImplemented("process.report.writeReport")
  };
  finalization = {
    register: /* @__PURE__ */ notImplemented("process.finalization.register"),
    unregister: /* @__PURE__ */ notImplemented("process.finalization.unregister"),
    registerBeforeExit: /* @__PURE__ */ notImplemented("process.finalization.registerBeforeExit")
  };
  memoryUsage = Object.assign(() => ({
    arrayBuffers: 0,
    rss: 0,
    external: 0,
    heapTotal: 0,
    heapUsed: 0
  }), { rss: /* @__PURE__ */ __name(() => 0, "rss") });
  // --- undefined props ---
  mainModule = void 0;
  domain = void 0;
  // optional
  send = void 0;
  exitCode = void 0;
  channel = void 0;
  getegid = void 0;
  geteuid = void 0;
  getgid = void 0;
  getgroups = void 0;
  getuid = void 0;
  setegid = void 0;
  seteuid = void 0;
  setgid = void 0;
  setgroups = void 0;
  setuid = void 0;
  // internals
  _events = void 0;
  _eventsCount = void 0;
  _exiting = void 0;
  _maxListeners = void 0;
  _debugEnd = void 0;
  _debugProcess = void 0;
  _fatalException = void 0;
  _getActiveHandles = void 0;
  _getActiveRequests = void 0;
  _kill = void 0;
  _preload_modules = void 0;
  _rawDebug = void 0;
  _startProfilerIdleNotifier = void 0;
  _stopProfilerIdleNotifier = void 0;
  _tickCallback = void 0;
  _disconnect = void 0;
  _handleQueue = void 0;
  _pendingMessage = void 0;
  _channel = void 0;
  _send = void 0;
  _linkedBinding = void 0;
};

// ../../node_modules/@cloudflare/unenv-preset/dist/runtime/node/process.mjs
var globalProcess = globalThis["process"];
var getBuiltinModule = globalProcess.getBuiltinModule;
var workerdProcess = getBuiltinModule("node:process");
var unenvProcess = new Process({
  env: globalProcess.env,
  hrtime,
  // `nextTick` is available from workerd process v1
  nextTick: workerdProcess.nextTick
});
var { exit, features, platform } = workerdProcess;
var {
  _channel,
  _debugEnd,
  _debugProcess,
  _disconnect,
  _events,
  _eventsCount,
  _exiting,
  _fatalException,
  _getActiveHandles,
  _getActiveRequests,
  _handleQueue,
  _kill,
  _linkedBinding,
  _maxListeners,
  _pendingMessage,
  _preload_modules,
  _rawDebug,
  _send,
  _startProfilerIdleNotifier,
  _stopProfilerIdleNotifier,
  _tickCallback,
  abort,
  addListener,
  allowedNodeEnvironmentFlags,
  arch,
  argv,
  argv0,
  assert: assert2,
  availableMemory,
  binding,
  channel,
  chdir,
  config,
  connected,
  constrainedMemory,
  cpuUsage,
  cwd,
  debugPort,
  disconnect,
  dlopen,
  domain,
  emit,
  emitWarning,
  env,
  eventNames,
  execArgv,
  execPath,
  exitCode,
  finalization,
  getActiveResourcesInfo,
  getegid,
  geteuid,
  getgid,
  getgroups,
  getMaxListeners,
  getuid,
  hasUncaughtExceptionCaptureCallback,
  hrtime: hrtime3,
  initgroups,
  kill,
  listenerCount,
  listeners,
  loadEnvFile,
  mainModule,
  memoryUsage,
  moduleLoadList,
  nextTick,
  off,
  on,
  once,
  openStdin,
  permission,
  pid,
  ppid,
  prependListener,
  prependOnceListener,
  rawListeners,
  reallyExit,
  ref,
  release,
  removeAllListeners,
  removeListener,
  report,
  resourceUsage,
  send,
  setegid,
  seteuid,
  setgid,
  setgroups,
  setMaxListeners,
  setSourceMapsEnabled,
  setuid,
  setUncaughtExceptionCaptureCallback,
  sourceMapsEnabled,
  stderr,
  stdin,
  stdout,
  throwDeprecation,
  title,
  traceDeprecation,
  umask,
  unref,
  uptime,
  version,
  versions
} = unenvProcess;
var _process = {
  abort,
  addListener,
  allowedNodeEnvironmentFlags,
  hasUncaughtExceptionCaptureCallback,
  setUncaughtExceptionCaptureCallback,
  loadEnvFile,
  sourceMapsEnabled,
  arch,
  argv,
  argv0,
  chdir,
  config,
  connected,
  constrainedMemory,
  availableMemory,
  cpuUsage,
  cwd,
  debugPort,
  dlopen,
  disconnect,
  emit,
  emitWarning,
  env,
  eventNames,
  execArgv,
  execPath,
  exit,
  finalization,
  features,
  getBuiltinModule,
  getActiveResourcesInfo,
  getMaxListeners,
  hrtime: hrtime3,
  kill,
  listeners,
  listenerCount,
  memoryUsage,
  nextTick,
  on,
  off,
  once,
  pid,
  platform,
  ppid,
  prependListener,
  prependOnceListener,
  rawListeners,
  release,
  removeAllListeners,
  removeListener,
  report,
  resourceUsage,
  setMaxListeners,
  setSourceMapsEnabled,
  stderr,
  stdin,
  stdout,
  title,
  throwDeprecation,
  traceDeprecation,
  umask,
  uptime,
  version,
  versions,
  // @ts-expect-error old API
  domain,
  initgroups,
  moduleLoadList,
  reallyExit,
  openStdin,
  assert: assert2,
  binding,
  send,
  exitCode,
  channel,
  getegid,
  geteuid,
  getgid,
  getgroups,
  getuid,
  setegid,
  seteuid,
  setgid,
  setgroups,
  setuid,
  permission,
  mainModule,
  _events,
  _eventsCount,
  _exiting,
  _maxListeners,
  _debugEnd,
  _debugProcess,
  _fatalException,
  _getActiveHandles,
  _getActiveRequests,
  _kill,
  _preload_modules,
  _rawDebug,
  _startProfilerIdleNotifier,
  _stopProfilerIdleNotifier,
  _tickCallback,
  _disconnect,
  _handleQueue,
  _pendingMessage,
  _channel,
  _send,
  _linkedBinding
};
var process_default = _process;

// ../../node_modules/wrangler/_virtual_unenv_global_polyfill-@cloudflare-unenv-preset-node-process
globalThis.process = process_default;

// ../../node_modules/@cloudflare/sandbox/dist/dist-CmfvOT-w.js
function getEnvString(env2, key) {
  const value = env2?.[key];
  return typeof value === "string" ? value : void 0;
}
__name(getEnvString, "getEnvString");
function filterEnvVars(envVars) {
  const filtered = {};
  for (const [key, value] of Object.entries(envVars)) if (value != null && typeof value === "string") filtered[key] = value;
  return filtered;
}
__name(filterEnvVars, "filterEnvVars");
function partitionEnvVars(envVars) {
  const toSet = {};
  const toUnset = [];
  for (const [key, value] of Object.entries(envVars)) if (value != null && typeof value === "string") toSet[key] = value;
  else toUnset.push(key);
  return {
    toSet,
    toUnset
  };
}
__name(partitionEnvVars, "partitionEnvVars");
var SENSITIVE_PARAMS = /([?&])(X-Amz-Credential|X-Amz-Signature|X-Amz-Security-Token|token|secret|password)=[^&\s"'`<>]*/gi;
function redactCredentials(text) {
  let result = text;
  let pos = 0;
  while (pos < result.length) {
    const httpPos = result.indexOf("http://", pos);
    const httpsPos = result.indexOf("https://", pos);
    let protocolPos = -1;
    let protocolLen = 0;
    if (httpPos === -1 && httpsPos === -1) break;
    if (httpPos !== -1 && (httpsPos === -1 || httpPos < httpsPos)) {
      protocolPos = httpPos;
      protocolLen = 7;
    } else {
      protocolPos = httpsPos;
      protocolLen = 8;
    }
    const searchStart = protocolPos + protocolLen;
    const atPos = result.indexOf("@", searchStart);
    let urlEnd = searchStart;
    while (urlEnd < result.length) {
      const char = result[urlEnd];
      if (/[\s"'`<>,;{}[\]]/.test(char)) break;
      urlEnd++;
    }
    if (atPos !== -1 && atPos < urlEnd) {
      result = `${result.substring(0, searchStart)}******${result.substring(atPos)}`;
      pos = searchStart + 6;
    } else pos = protocolPos + protocolLen;
  }
  return result;
}
__name(redactCredentials, "redactCredentials");
function redactSensitiveParams(input) {
  if (!input.includes("?") || !input.includes("=")) return input;
  return input.replace(SENSITIVE_PARAMS, "$1$2=REDACTED");
}
__name(redactSensitiveParams, "redactSensitiveParams");
function redactCommand(command) {
  return redactSensitiveParams(redactCredentials(command));
}
__name(redactCommand, "redactCommand");
function truncateForLog(value, maxLen = 120) {
  if (value.length <= maxLen) return {
    value,
    truncated: false
  };
  const cutoff = Math.max(0, maxLen - 3);
  return {
    value: `${value.substring(0, cutoff)}...`,
    truncated: true
  };
}
__name(truncateForLog, "truncateForLog");
var FALLBACK_REPO_NAME = "repository";
function extractRepoName(repoUrl) {
  try {
    const pathParts = new URL(repoUrl).pathname.split("/");
    const lastPart = pathParts[pathParts.length - 1];
    if (lastPart) return lastPart.replace(/\.git$/, "");
  } catch {
  }
  if (repoUrl.includes(":") || repoUrl.includes("/")) {
    const segments = repoUrl.split(/[:/]/).filter(Boolean);
    const lastSegment = segments[segments.length - 1];
    if (lastSegment) return lastSegment.replace(/\.git$/, "");
  }
  return FALLBACK_REPO_NAME;
}
__name(extractRepoName, "extractRepoName");
function sanitizeGitData(data) {
  if (typeof data === "string") return redactCommand(data);
  if (data === null || data === void 0) return data;
  if (Array.isArray(data)) return data.map((item) => sanitizeGitData(item));
  if (typeof data === "object") {
    const result = {};
    for (const [key, value] of Object.entries(data)) result[key] = sanitizeGitData(value);
    return result;
  }
  return data;
}
__name(sanitizeGitData, "sanitizeGitData");
var GitLogger = class GitLogger2 {
  static {
    __name(this, "GitLogger");
  }
  baseLogger;
  constructor(baseLogger) {
    this.baseLogger = baseLogger;
  }
  sanitizeContext(context2) {
    return context2 ? sanitizeGitData(context2) : context2;
  }
  sanitizeError(error3) {
    if (!error3) return error3;
    const sanitized = new Error(redactCommand(error3.message));
    sanitized.name = error3.name;
    if (error3.stack) sanitized.stack = redactCommand(error3.stack);
    const sanitizedRecord = sanitized;
    const errorRecord = error3;
    for (const key of Object.keys(error3)) if (key !== "message" && key !== "stack" && key !== "name") sanitizedRecord[key] = sanitizeGitData(errorRecord[key]);
    return sanitized;
  }
  debug(message, context2) {
    this.baseLogger.debug(message, this.sanitizeContext(context2));
  }
  info(message, context2) {
    this.baseLogger.info(message, this.sanitizeContext(context2));
  }
  warn(message, context2) {
    this.baseLogger.warn(message, this.sanitizeContext(context2));
  }
  error(message, error3, context2) {
    this.baseLogger.error(message, this.sanitizeError(error3), this.sanitizeContext(context2));
  }
  child(context2) {
    const sanitized = sanitizeGitData(context2);
    return new GitLogger2(this.baseLogger.child(sanitized));
  }
};
var Execution = class {
  static {
    __name(this, "Execution");
  }
  code;
  context;
  /**
  * All results from the execution
  */
  results = [];
  /**
  * Accumulated stdout and stderr
  */
  logs = {
    stdout: [],
    stderr: []
  };
  /**
  * Execution error if any
  */
  error;
  /**
  * Execution count (for interpreter)
  */
  executionCount;
  constructor(code, context2) {
    this.code = code;
    this.context = context2;
  }
  /**
  * Convert to a plain object for serialization
  */
  toJSON() {
    return {
      code: this.code,
      logs: this.logs,
      error: this.error,
      executionCount: this.executionCount,
      results: this.results.map((result) => ({
        text: result.text,
        html: result.html,
        png: result.png,
        jpeg: result.jpeg,
        svg: result.svg,
        latex: result.latex,
        markdown: result.markdown,
        javascript: result.javascript,
        json: result.json,
        chart: result.chart,
        data: result.data
      }))
    };
  }
};
var ResultImpl = class {
  static {
    __name(this, "ResultImpl");
  }
  raw;
  constructor(raw) {
    this.raw = raw;
  }
  get text() {
    return this.raw.text || this.raw.data?.["text/plain"];
  }
  get html() {
    return this.raw.html || this.raw.data?.["text/html"];
  }
  get png() {
    return this.raw.png || this.raw.data?.["image/png"];
  }
  get jpeg() {
    return this.raw.jpeg || this.raw.data?.["image/jpeg"];
  }
  get svg() {
    return this.raw.svg || this.raw.data?.["image/svg+xml"];
  }
  get latex() {
    return this.raw.latex || this.raw.data?.["text/latex"];
  }
  get markdown() {
    return this.raw.markdown || this.raw.data?.["text/markdown"];
  }
  get javascript() {
    return this.raw.javascript || this.raw.data?.["application/javascript"];
  }
  get json() {
    return this.raw.json || this.raw.data?.["application/json"];
  }
  get chart() {
    return this.raw.chart;
  }
  get data() {
    return this.raw.data;
  }
  formats() {
    const formats = [];
    if (this.text) formats.push("text");
    if (this.html) formats.push("html");
    if (this.png) formats.push("png");
    if (this.jpeg) formats.push("jpeg");
    if (this.svg) formats.push("svg");
    if (this.latex) formats.push("latex");
    if (this.markdown) formats.push("markdown");
    if (this.javascript) formats.push("javascript");
    if (this.json) formats.push("json");
    if (this.chart) formats.push("chart");
    return formats;
  }
};
var DEBUG_ON_SUCCESS = /* @__PURE__ */ new Set([
  "session.create",
  "session.destroy",
  "file.read",
  "file.write",
  "file.delete",
  "file.mkdir"
]);
function resolveLogLevel(payload, options) {
  if (payload.outcome === "error") return "error";
  if (options?.successLevel) return options.successLevel;
  if (payload.origin === "internal") return "debug";
  if (DEBUG_ON_SUCCESS.has(payload.event)) return "debug";
  return "info";
}
__name(resolveLogLevel, "resolveLogLevel");
function sanitizeError(error3) {
  if (!error3) return void 0;
  const sanitized = new Error(redactCommand(error3.message));
  sanitized.name = error3.name;
  sanitized.stack = error3.stack ? redactCommand(error3.stack) : void 0;
  return sanitized;
}
__name(sanitizeError, "sanitizeError");
function sanitizePayload(payload) {
  if (payload.command === void 0) return { commandTruncated: false };
  const { value, truncated } = truncateForLog(redactCommand(payload.command));
  return {
    sanitizedCommand: value,
    commandTruncated: truncated
  };
}
__name(sanitizePayload, "sanitizePayload");
function buildMessage(payload, sanitizedCommand) {
  const { event } = payload;
  if (event === "version.check") {
    const parts$1 = ["version.check"];
    if (payload.sdkVersion) parts$1.push(`sdk=${payload.sdkVersion}`);
    if (payload.containerVersion) parts$1.push(`container=${payload.containerVersion}`);
    if (payload.versionOutcome && payload.versionOutcome !== "compatible") parts$1.push(`(${payload.versionOutcome})`);
    return parts$1.join(" ");
  }
  const parts = [event, payload.outcome];
  if (sanitizedCommand !== void 0) parts.push(sanitizedCommand);
  else if (payload.command !== void 0) {
    const { value } = truncateForLog(redactCommand(payload.command));
    parts.push(value);
  } else if (payload.path !== void 0) parts.push(payload.path);
  else if (event.includes("session") && payload.sessionId !== void 0) parts.push(payload.sessionId);
  else if (payload.port !== void 0) parts.push(String(payload.port));
  else if (payload.repoUrl !== void 0) {
    let gitContext = payload.repoUrl;
    if (payload.branch !== void 0) gitContext += ` ${payload.branch}`;
    parts.push(gitContext);
  } else if (payload.pid !== void 0) parts.push(String(payload.pid));
  else if (payload.backupId !== void 0) parts.push(payload.backupId);
  else if (payload.repoPath !== void 0) {
    let gitContext = payload.repoPath;
    if (payload.branch !== void 0) gitContext += ` branch=${payload.branch}`;
    parts.push(gitContext);
  } else if (payload.mountsProcessed !== void 0) {
    let destroyContext = `${payload.mountsProcessed} mounts`;
    if (payload.mountFailures) destroyContext += `, ${payload.mountFailures} failed`;
    parts.push(destroyContext);
  } else if (payload.mountPath !== void 0) parts.push(payload.mountPath);
  if (payload.outcome === "error") {
    if (payload.errorMessage !== void 0) parts.push(`\u2014 ${payload.errorMessage}`);
    else if (payload.exitCode !== void 0) parts.push(`\u2014 exitCode=${payload.exitCode}`);
  }
  const durationSuffix = payload.sizeBytes !== void 0 ? `(${payload.durationMs}ms, ${payload.sizeBytes}B)` : `(${payload.durationMs}ms)`;
  parts.push(durationSuffix);
  return parts.join(" ");
}
__name(buildMessage, "buildMessage");
function logCanonicalEvent(logger, payload, options) {
  const resolvedErrorMessage = payload.errorMessage ?? payload.error?.message;
  const sanitizedErrorMessage = resolvedErrorMessage ? redactCommand(resolvedErrorMessage) : void 0;
  const enrichedPayload = sanitizedErrorMessage !== void 0 ? {
    ...payload,
    errorMessage: sanitizedErrorMessage
  } : payload;
  const { sanitizedCommand, commandTruncated } = sanitizePayload(enrichedPayload);
  const message = buildMessage(enrichedPayload, sanitizedCommand);
  const context2 = {};
  for (const [key, value] of Object.entries(enrichedPayload)) {
    if (key === "error") continue;
    context2[key] = value;
  }
  if (sanitizedCommand !== void 0) {
    context2.command = sanitizedCommand;
    if (commandTruncated) context2.commandTruncated = true;
  }
  const level = resolveLogLevel(enrichedPayload, options);
  if (level === "error") logger.error(message, sanitizeError(payload.error), context2);
  else if (level === "warn") logger.warn(message, context2);
  else if (level === "debug") logger.debug(message, context2);
  else logger.info(message, context2);
}
__name(logCanonicalEvent, "logCanonicalEvent");
var LogLevel;
(function(LogLevel$1) {
  LogLevel$1[LogLevel$1["DEBUG"] = 0] = "DEBUG";
  LogLevel$1[LogLevel$1["INFO"] = 1] = "INFO";
  LogLevel$1[LogLevel$1["WARN"] = 2] = "WARN";
  LogLevel$1[LogLevel$1["ERROR"] = 3] = "ERROR";
})(LogLevel || (LogLevel = {}));
var COLORS = {
  reset: "\x1B[0m",
  debug: "\x1B[36m",
  info: "\x1B[32m",
  warn: "\x1B[33m",
  error: "\x1B[31m",
  dim: "\x1B[2m"
};
var CloudflareLogger = class CloudflareLogger2 {
  static {
    __name(this, "CloudflareLogger");
  }
  baseContext;
  minLevel;
  outputMode;
  /**
  * Create a new CloudflareLogger
  *
  * @param baseContext Base context included in all log entries
  * @param minLevel Minimum log level to output (default: INFO)
  * @param outputMode How log entries are formatted and emitted (default: 'structured')
  */
  constructor(baseContext, minLevel = LogLevel.INFO, outputMode = "structured") {
    this.baseContext = baseContext;
    this.minLevel = minLevel;
    this.outputMode = outputMode;
  }
  /**
  * Log debug-level message
  */
  debug(message, context2) {
    if (this.shouldLog(LogLevel.DEBUG)) {
      const logData = this.buildLogData("debug", message, context2);
      this.output(console.log, logData);
    }
  }
  /**
  * Log info-level message
  */
  info(message, context2) {
    if (this.shouldLog(LogLevel.INFO)) {
      const logData = this.buildLogData("info", message, context2);
      this.output(console.log, logData);
    }
  }
  /**
  * Log warning-level message
  */
  warn(message, context2) {
    if (this.shouldLog(LogLevel.WARN)) {
      const logData = this.buildLogData("warn", message, context2);
      this.output(console.warn, logData);
    }
  }
  /**
  * Log error-level message
  */
  error(message, error3, context2) {
    if (this.shouldLog(LogLevel.ERROR)) {
      const logData = this.buildLogData("error", message, context2, error3);
      this.output(console.error, logData);
    }
  }
  /**
  * Create a child logger with additional context
  */
  child(context2) {
    return new CloudflareLogger2({
      ...this.baseContext,
      ...context2
    }, this.minLevel, this.outputMode);
  }
  /**
  * Check if a log level should be output
  */
  shouldLog(level) {
    return level >= this.minLevel;
  }
  /**
  * Build log data object
  */
  buildLogData(level, message, context2, error3) {
    const logData = {
      level,
      message,
      ...this.baseContext,
      ...context2,
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    };
    if (error3) logData.error = {
      message: error3.message,
      stack: error3.stack,
      name: error3.name
    };
    return logData;
  }
  /**
  * Output log data using the configured output mode
  */
  output(consoleFn, data) {
    switch (this.outputMode) {
      case "pretty":
        this.outputPretty(consoleFn, data);
        break;
      case "json-line":
        this.outputJsonLine(consoleFn, data);
        break;
      case "structured":
        this.outputStructured(consoleFn, data);
        break;
    }
  }
  /**
  * Output as JSON string (container stdout — parsed by Containers pipeline)
  */
  outputJsonLine(consoleFn, data) {
    consoleFn(JSON.stringify(data));
  }
  /**
  * Output as raw object (Workers/DOs — Workers Logs auto-indexes fields)
  */
  outputStructured(consoleFn, data) {
    consoleFn(data);
  }
  /**
  * Output as pretty-printed, colored text (development)
  *
  * Each log event is a single consoleFn() call so it appears as one entry
  * in the Cloudflare dashboard. Context is rendered inline as compact key=value pairs.
  *
  * Format: LEVEL [component] message trace=tr_... key=value key=value
  */
  outputPretty(consoleFn, data) {
    const { level, message: msg, timestamp, traceId, component, sandboxId, sessionId, processId, commandId, durationMs, serviceVersion, instanceId, error: error3, ...rest } = data;
    const levelStr = String(level || "INFO").toUpperCase();
    const levelColor = this.getLevelColor(levelStr);
    const componentBadge = component ? `[${component}]` : "";
    let logLine = `${timestamp ? `${COLORS.dim}${new Date(timestamp).toISOString().substring(11, 23)}${COLORS.reset} ` : ""}${levelColor}${levelStr.padEnd(5)}${COLORS.reset} ${componentBadge} ${msg}`;
    const pairs = [];
    if (traceId) pairs.push(`trace=${String(traceId).substring(0, 12)}`);
    if (commandId) pairs.push(`cmd=${String(commandId).substring(0, 12)}`);
    if (sandboxId) pairs.push(`sandbox=${sandboxId}`);
    if (sessionId) pairs.push(`session=${String(sessionId).substring(0, 12)}`);
    if (processId) pairs.push(`proc=${processId}`);
    if (durationMs !== void 0) pairs.push(`dur=${durationMs}ms`);
    for (const [key, value] of Object.entries(rest)) {
      if (value === void 0 || value === null) continue;
      const v = typeof value === "object" ? JSON.stringify(value) : this.sanitizePrettyValue(String(value));
      pairs.push(`${key}=${v}`);
    }
    if (error3 && typeof error3 === "object") {
      const errorObj = error3;
      if (errorObj.name) pairs.push(`err.name=${this.sanitizePrettyValue(errorObj.name)}`);
      if (errorObj.message) pairs.push(`err.msg=${this.sanitizePrettyValue(errorObj.message)}`);
      if (errorObj.stack) pairs.push(`err.stack=${this.sanitizePrettyValue(errorObj.stack)}`);
    }
    if (pairs.length > 0) logLine += ` ${COLORS.dim}${pairs.join(" ")}${COLORS.reset}`;
    consoleFn(logLine);
  }
  /**
  * Collapse newlines so a single consoleFn() call stays on one line.
  * Cloudflare's log pipeline splits on literal newlines, which fragments
  * stack traces and multi-line error messages into separate entries.
  */
  sanitizePrettyValue(value) {
    return value.replace(/\r/g, "\\r").replace(/\n/g, "\\n");
  }
  /**
  * Get ANSI color code for log level
  */
  getLevelColor(level) {
    switch (level.toLowerCase()) {
      case "debug":
        return COLORS.debug;
      case "info":
        return COLORS.info;
      case "warn":
        return COLORS.warn;
      case "error":
        return COLORS.error;
      default:
        return COLORS.reset;
    }
  }
};
var TraceContext = class TraceContext2 {
  static {
    __name(this, "TraceContext");
  }
  /**
  * HTTP header name for trace ID propagation
  */
  static TRACE_HEADER = "X-Trace-Id";
  /**
  * Generate a new trace ID
  *
  * Format: "tr_" + 16 random hex characters
  * Example: "tr_7f3a9b2c4e5d6f1a"
  *
  * @returns Newly generated trace ID
  */
  static generate() {
    return `tr_${crypto.randomUUID().replace(/-/g, "").substring(0, 16)}`;
  }
  /**
  * Extract trace ID from HTTP request headers
  *
  * @param headers Request headers
  * @returns Trace ID if present, null otherwise
  */
  static fromHeaders(headers) {
    return headers.get(TraceContext2.TRACE_HEADER);
  }
  /**
  * Create headers object with trace ID for outgoing requests
  *
  * @param traceId Trace ID to include
  * @returns Headers object with X-Trace-Id set
  */
  static toHeaders(traceId) {
    return { [TraceContext2.TRACE_HEADER]: traceId };
  }
  /**
  * Get the header name used for trace ID propagation
  *
  * @returns Header name ("X-Trace-Id")
  */
  static getHeaderName() {
    return TraceContext2.TRACE_HEADER;
  }
};
function createNoOpLogger() {
  return {
    debug: /* @__PURE__ */ __name(() => {
    }, "debug"),
    info: /* @__PURE__ */ __name(() => {
    }, "info"),
    warn: /* @__PURE__ */ __name(() => {
    }, "warn"),
    error: /* @__PURE__ */ __name(() => {
    }, "error"),
    child: /* @__PURE__ */ __name(() => createNoOpLogger(), "child")
  };
}
__name(createNoOpLogger, "createNoOpLogger");
function createLogger(context2) {
  const minLevel = getLogLevelFromEnv();
  const outputMode = getOutputMode(context2.component);
  return new CloudflareLogger({
    ...context2,
    traceId: context2.traceId || TraceContext.generate(),
    component: context2.component,
    serviceVersion: context2.serviceVersion || getEnvVar("SANDBOX_VERSION") || void 0,
    instanceId: context2.instanceId || getEnvVar("HOSTNAME") || getEnvVar("SANDBOX_INSTANCE_ID") || void 0
  }, minLevel, outputMode);
}
__name(createLogger, "createLogger");
function getLogLevelFromEnv() {
  switch ((getEnvVar("SANDBOX_LOG_LEVEL") || "info").toLowerCase()) {
    case "debug":
      return LogLevel.DEBUG;
    case "info":
      return LogLevel.INFO;
    case "warn":
      return LogLevel.WARN;
    case "error":
      return LogLevel.ERROR;
    default:
      return LogLevel.INFO;
  }
}
__name(getLogLevelFromEnv, "getLogLevelFromEnv");
function getOutputMode(component) {
  if (getEnvVar("SANDBOX_LOG_FORMAT")?.toLowerCase() === "pretty") return "pretty";
  if (component === "container" || component === "executor") return "json-line";
  return "structured";
}
__name(getOutputMode, "getOutputMode");
function getEnvVar(name) {
  if (typeof process !== "undefined" && process.env) return process.env[name];
  if (typeof Bun !== "undefined") {
    const bunEnv = Bun.env;
    if (bunEnv) return bunEnv[name];
  }
}
__name(getEnvVar, "getEnvVar");
function shellEscape(str) {
  return `'${str.replace(/'/g, "'\\''")}'`;
}
__name(shellEscape, "shellEscape");
function parseSSEFrames(buffer, currentEvent = { data: [] }) {
  const events = [];
  let i = 0;
  while (i < buffer.length) {
    const newlineIndex = buffer.indexOf("\n", i);
    if (newlineIndex === -1) break;
    const rawLine = buffer.substring(i, newlineIndex);
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    i = newlineIndex + 1;
    if (line === "" && currentEvent.data.length > 0) {
      events.push({
        event: currentEvent.event,
        data: currentEvent.data.join("\n")
      });
      currentEvent = { data: [] };
      continue;
    }
    if (line.startsWith("event:")) {
      currentEvent.event = line.startsWith("event: ") ? line.substring(7) : line.substring(6);
      continue;
    }
    if (line.startsWith("data:")) {
      const value = line.startsWith("data: ") ? line.substring(6) : line.substring(5);
      currentEvent.data.push(value);
    }
  }
  return {
    events,
    remaining: buffer.substring(i),
    currentEvent
  };
}
__name(parseSSEFrames, "parseSSEFrames");
function isWSResponse(msg) {
  return typeof msg === "object" && msg !== null && "type" in msg && msg.type === "response";
}
__name(isWSResponse, "isWSResponse");
function isWSStreamChunk(msg) {
  return typeof msg === "object" && msg !== null && "type" in msg && msg.type === "stream";
}
__name(isWSStreamChunk, "isWSStreamChunk");
function isWSError(msg) {
  return typeof msg === "object" && msg !== null && "type" in msg && msg.type === "error";
}
__name(isWSError, "isWSError");
function generateRequestId() {
  return `ws_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
}
__name(generateRequestId, "generateRequestId");

// ../../node_modules/@cloudflare/sandbox/dist/errors-CaSfB5Bm.js
var ErrorCode = {
  FILE_NOT_FOUND: "FILE_NOT_FOUND",
  PERMISSION_DENIED: "PERMISSION_DENIED",
  FILE_EXISTS: "FILE_EXISTS",
  IS_DIRECTORY: "IS_DIRECTORY",
  NOT_DIRECTORY: "NOT_DIRECTORY",
  FILE_TOO_LARGE: "FILE_TOO_LARGE",
  NO_SPACE: "NO_SPACE",
  TOO_MANY_FILES: "TOO_MANY_FILES",
  RESOURCE_BUSY: "RESOURCE_BUSY",
  READ_ONLY: "READ_ONLY",
  NAME_TOO_LONG: "NAME_TOO_LONG",
  TOO_MANY_LINKS: "TOO_MANY_LINKS",
  FILESYSTEM_ERROR: "FILESYSTEM_ERROR",
  COMMAND_NOT_FOUND: "COMMAND_NOT_FOUND",
  COMMAND_PERMISSION_DENIED: "COMMAND_PERMISSION_DENIED",
  INVALID_COMMAND: "INVALID_COMMAND",
  COMMAND_EXECUTION_ERROR: "COMMAND_EXECUTION_ERROR",
  STREAM_START_ERROR: "STREAM_START_ERROR",
  PROCESS_NOT_FOUND: "PROCESS_NOT_FOUND",
  PROCESS_PERMISSION_DENIED: "PROCESS_PERMISSION_DENIED",
  PROCESS_ERROR: "PROCESS_ERROR",
  SESSION_ALREADY_EXISTS: "SESSION_ALREADY_EXISTS",
  SESSION_DESTROYED: "SESSION_DESTROYED",
  PORT_ALREADY_EXPOSED: "PORT_ALREADY_EXPOSED",
  PORT_IN_USE: "PORT_IN_USE",
  PORT_NOT_EXPOSED: "PORT_NOT_EXPOSED",
  INVALID_PORT_NUMBER: "INVALID_PORT_NUMBER",
  INVALID_PORT: "INVALID_PORT",
  SERVICE_NOT_RESPONDING: "SERVICE_NOT_RESPONDING",
  PORT_OPERATION_ERROR: "PORT_OPERATION_ERROR",
  CUSTOM_DOMAIN_REQUIRED: "CUSTOM_DOMAIN_REQUIRED",
  GIT_REPOSITORY_NOT_FOUND: "GIT_REPOSITORY_NOT_FOUND",
  GIT_BRANCH_NOT_FOUND: "GIT_BRANCH_NOT_FOUND",
  GIT_AUTH_FAILED: "GIT_AUTH_FAILED",
  GIT_NETWORK_ERROR: "GIT_NETWORK_ERROR",
  INVALID_GIT_URL: "INVALID_GIT_URL",
  GIT_CLONE_FAILED: "GIT_CLONE_FAILED",
  GIT_CHECKOUT_FAILED: "GIT_CHECKOUT_FAILED",
  GIT_OPERATION_FAILED: "GIT_OPERATION_FAILED",
  BUCKET_MOUNT_ERROR: "BUCKET_MOUNT_ERROR",
  S3FS_MOUNT_ERROR: "S3FS_MOUNT_ERROR",
  MISSING_CREDENTIALS: "MISSING_CREDENTIALS",
  INVALID_MOUNT_CONFIG: "INVALID_MOUNT_CONFIG",
  BACKUP_CREATE_FAILED: "BACKUP_CREATE_FAILED",
  BACKUP_RESTORE_FAILED: "BACKUP_RESTORE_FAILED",
  BACKUP_NOT_FOUND: "BACKUP_NOT_FOUND",
  BACKUP_EXPIRED: "BACKUP_EXPIRED",
  INVALID_BACKUP_CONFIG: "INVALID_BACKUP_CONFIG",
  INTERPRETER_NOT_READY: "INTERPRETER_NOT_READY",
  CONTEXT_NOT_FOUND: "CONTEXT_NOT_FOUND",
  CODE_EXECUTION_ERROR: "CODE_EXECUTION_ERROR",
  PYTHON_NOT_AVAILABLE: "PYTHON_NOT_AVAILABLE",
  JAVASCRIPT_NOT_AVAILABLE: "JAVASCRIPT_NOT_AVAILABLE",
  OPENCODE_STARTUP_FAILED: "OPENCODE_STARTUP_FAILED",
  PROCESS_READY_TIMEOUT: "PROCESS_READY_TIMEOUT",
  PROCESS_EXITED_BEFORE_READY: "PROCESS_EXITED_BEFORE_READY",
  DESKTOP_NOT_STARTED: "DESKTOP_NOT_STARTED",
  DESKTOP_START_FAILED: "DESKTOP_START_FAILED",
  DESKTOP_UNAVAILABLE: "DESKTOP_UNAVAILABLE",
  DESKTOP_PROCESS_CRASHED: "DESKTOP_PROCESS_CRASHED",
  DESKTOP_INVALID_OPTIONS: "DESKTOP_INVALID_OPTIONS",
  DESKTOP_INVALID_COORDINATES: "DESKTOP_INVALID_COORDINATES",
  WATCH_NOT_FOUND: "WATCH_NOT_FOUND",
  WATCH_START_ERROR: "WATCH_START_ERROR",
  WATCH_STOP_ERROR: "WATCH_STOP_ERROR",
  VALIDATION_FAILED: "VALIDATION_FAILED",
  INVALID_JSON_RESPONSE: "INVALID_JSON_RESPONSE",
  UNKNOWN_ERROR: "UNKNOWN_ERROR",
  INTERNAL_ERROR: "INTERNAL_ERROR"
};
var ERROR_STATUS_MAP = {
  [ErrorCode.FILE_NOT_FOUND]: 404,
  [ErrorCode.COMMAND_NOT_FOUND]: 404,
  [ErrorCode.PROCESS_NOT_FOUND]: 404,
  [ErrorCode.PORT_NOT_EXPOSED]: 404,
  [ErrorCode.GIT_REPOSITORY_NOT_FOUND]: 404,
  [ErrorCode.GIT_BRANCH_NOT_FOUND]: 404,
  [ErrorCode.CONTEXT_NOT_FOUND]: 404,
  [ErrorCode.WATCH_NOT_FOUND]: 404,
  [ErrorCode.IS_DIRECTORY]: 400,
  [ErrorCode.NOT_DIRECTORY]: 400,
  [ErrorCode.INVALID_COMMAND]: 400,
  [ErrorCode.INVALID_PORT_NUMBER]: 400,
  [ErrorCode.INVALID_PORT]: 400,
  [ErrorCode.INVALID_GIT_URL]: 400,
  [ErrorCode.CUSTOM_DOMAIN_REQUIRED]: 400,
  [ErrorCode.INVALID_JSON_RESPONSE]: 400,
  [ErrorCode.NAME_TOO_LONG]: 400,
  [ErrorCode.VALIDATION_FAILED]: 400,
  [ErrorCode.MISSING_CREDENTIALS]: 400,
  [ErrorCode.INVALID_MOUNT_CONFIG]: 400,
  [ErrorCode.GIT_AUTH_FAILED]: 401,
  [ErrorCode.PERMISSION_DENIED]: 403,
  [ErrorCode.COMMAND_PERMISSION_DENIED]: 403,
  [ErrorCode.PROCESS_PERMISSION_DENIED]: 403,
  [ErrorCode.READ_ONLY]: 403,
  [ErrorCode.FILE_EXISTS]: 409,
  [ErrorCode.PORT_ALREADY_EXPOSED]: 409,
  [ErrorCode.PORT_IN_USE]: 409,
  [ErrorCode.RESOURCE_BUSY]: 409,
  [ErrorCode.SESSION_ALREADY_EXISTS]: 409,
  [ErrorCode.SESSION_DESTROYED]: 410,
  [ErrorCode.FILE_TOO_LARGE]: 413,
  [ErrorCode.SERVICE_NOT_RESPONDING]: 502,
  [ErrorCode.GIT_NETWORK_ERROR]: 502,
  [ErrorCode.BACKUP_NOT_FOUND]: 404,
  [ErrorCode.BACKUP_EXPIRED]: 400,
  [ErrorCode.INVALID_BACKUP_CONFIG]: 400,
  [ErrorCode.BACKUP_CREATE_FAILED]: 500,
  [ErrorCode.BACKUP_RESTORE_FAILED]: 500,
  [ErrorCode.PYTHON_NOT_AVAILABLE]: 501,
  [ErrorCode.JAVASCRIPT_NOT_AVAILABLE]: 501,
  [ErrorCode.DESKTOP_NOT_STARTED]: 409,
  [ErrorCode.DESKTOP_START_FAILED]: 500,
  [ErrorCode.DESKTOP_UNAVAILABLE]: 503,
  [ErrorCode.DESKTOP_PROCESS_CRASHED]: 500,
  [ErrorCode.DESKTOP_INVALID_OPTIONS]: 400,
  [ErrorCode.DESKTOP_INVALID_COORDINATES]: 400,
  [ErrorCode.INTERPRETER_NOT_READY]: 503,
  [ErrorCode.OPENCODE_STARTUP_FAILED]: 503,
  [ErrorCode.PROCESS_READY_TIMEOUT]: 408,
  [ErrorCode.PROCESS_EXITED_BEFORE_READY]: 500,
  [ErrorCode.NO_SPACE]: 500,
  [ErrorCode.TOO_MANY_FILES]: 500,
  [ErrorCode.TOO_MANY_LINKS]: 500,
  [ErrorCode.FILESYSTEM_ERROR]: 500,
  [ErrorCode.COMMAND_EXECUTION_ERROR]: 500,
  [ErrorCode.STREAM_START_ERROR]: 500,
  [ErrorCode.PROCESS_ERROR]: 500,
  [ErrorCode.PORT_OPERATION_ERROR]: 500,
  [ErrorCode.GIT_CLONE_FAILED]: 500,
  [ErrorCode.GIT_CHECKOUT_FAILED]: 500,
  [ErrorCode.GIT_OPERATION_FAILED]: 500,
  [ErrorCode.CODE_EXECUTION_ERROR]: 500,
  [ErrorCode.BUCKET_MOUNT_ERROR]: 500,
  [ErrorCode.S3FS_MOUNT_ERROR]: 500,
  [ErrorCode.WATCH_START_ERROR]: 500,
  [ErrorCode.WATCH_STOP_ERROR]: 500,
  [ErrorCode.UNKNOWN_ERROR]: 500,
  [ErrorCode.INTERNAL_ERROR]: 500
};

// ../../node_modules/@cloudflare/containers/dist/lib/helpers.js
function generateId(length = 9) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let result = "";
  for (let i = 0; i < length; i++) {
    result += alphabet[bytes[i] % alphabet.length];
  }
  return result;
}
__name(generateId, "generateId");
function parseTimeExpression(timeExpression) {
  if (typeof timeExpression === "number") {
    return timeExpression;
  }
  if (typeof timeExpression === "string") {
    const match = timeExpression.match(/^(\d+)([smh])$/);
    if (!match) {
      throw new Error(`invalid time expression ${timeExpression}`);
    }
    const value = parseInt(match[1]);
    const unit = match[2];
    switch (unit) {
      case "s":
        return value;
      case "m":
        return value * 60;
      case "h":
        return value * 60 * 60;
      default:
        throw new Error(`unknown time unit ${unit}`);
    }
  }
  throw new Error(`invalid type for a time expression: ${typeof timeExpression}`);
}
__name(parseTimeExpression, "parseTimeExpression");

// ../../node_modules/@cloudflare/containers/dist/lib/container.js
import { DurableObject, WorkerEntrypoint } from "cloudflare:workers";
var NO_CONTAINER_INSTANCE_ERROR = "there is no container instance that can be provided to this durable object";
var RUNTIME_SIGNALLED_ERROR = "runtime signalled the container to exit:";
var UNEXPECTED_EXIT_ERROR = "container exited with unexpected exit code:";
var NOT_LISTENING_ERROR = "the container is not listening";
var CONTAINER_STATE_KEY = "__CF_CONTAINER_STATE";
var OUTBOUND_CONFIGURATION_KEY = "OUTBOUND_CONFIGURATION";
var MAX_ALARM_RETRIES = 3;
var PING_TIMEOUT_MS = 5e3;
var DEFAULT_SLEEP_AFTER = "10m";
var INSTANCE_POLL_INTERVAL_MS = 300;
var TIMEOUT_TO_GET_CONTAINER_MS = 8e3;
var TIMEOUT_TO_GET_PORTS_MS = 2e4;
var FALLBACK_PORT_TO_CHECK = 33;
var outboundHandlersRegistry = /* @__PURE__ */ new Map();
var defaultOutboundHandlerNameRegistry = /* @__PURE__ */ new Map();
var outboundByHostRegistry = /* @__PURE__ */ new Map();
var signalToNumbers = {
  SIGINT: 2,
  SIGTERM: 15,
  SIGKILL: 9
};
function isErrorOfType(e, matchingString) {
  const errorString = e instanceof Error ? e.message : String(e);
  return errorString.toLowerCase().includes(matchingString);
}
__name(isErrorOfType, "isErrorOfType");
var isNoInstanceError = /* @__PURE__ */ __name((error3) => isErrorOfType(error3, NO_CONTAINER_INSTANCE_ERROR), "isNoInstanceError");
var isRuntimeSignalledError = /* @__PURE__ */ __name((error3) => isErrorOfType(error3, RUNTIME_SIGNALLED_ERROR), "isRuntimeSignalledError");
var isNotListeningError = /* @__PURE__ */ __name((error3) => isErrorOfType(error3, NOT_LISTENING_ERROR), "isNotListeningError");
var isContainerExitNonZeroError = /* @__PURE__ */ __name((error3) => isErrorOfType(error3, UNEXPECTED_EXIT_ERROR), "isContainerExitNonZeroError");
function getExitCodeFromError(error3) {
  if (!(error3 instanceof Error)) {
    return null;
  }
  if (isRuntimeSignalledError(error3)) {
    return +error3.message.toLowerCase().slice(error3.message.toLowerCase().indexOf(RUNTIME_SIGNALLED_ERROR) + RUNTIME_SIGNALLED_ERROR.length + 1);
  }
  if (isContainerExitNonZeroError(error3)) {
    return +error3.message.toLowerCase().slice(error3.message.toLowerCase().indexOf(UNEXPECTED_EXIT_ERROR) + UNEXPECTED_EXIT_ERROR.length + 1);
  }
  return null;
}
__name(getExitCodeFromError, "getExitCodeFromError");
function addTimeoutSignal(existingSignal, timeoutMs) {
  const controller = new AbortController();
  if (existingSignal?.aborted) {
    controller.abort();
    return controller.signal;
  }
  existingSignal?.addEventListener("abort", () => controller.abort());
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  controller.signal.addEventListener("abort", () => clearTimeout(timeoutId));
  return controller.signal;
}
__name(addTimeoutSignal, "addTimeoutSignal");
var ContainerState = class {
  static {
    __name(this, "ContainerState");
  }
  storage;
  status;
  constructor(storage) {
    this.storage = storage;
  }
  async setRunning() {
    await this.setStatusAndupdate("running");
  }
  async setHealthy() {
    await this.setStatusAndupdate("healthy");
  }
  async setStopping() {
    await this.setStatusAndupdate("stopping");
  }
  async setStopped() {
    await this.setStatusAndupdate("stopped");
  }
  async setStoppedWithCode(exitCode2) {
    this.status = { status: "stopped_with_code", lastChange: Date.now(), exitCode: exitCode2 };
    await this.update();
  }
  async getState() {
    if (!this.status) {
      const state = await this.storage.get(CONTAINER_STATE_KEY);
      if (!state) {
        this.status = {
          status: "stopped",
          lastChange: Date.now()
        };
        await this.update();
      } else {
        this.status = state;
      }
    }
    return this.status;
  }
  async setStatusAndupdate(status) {
    this.status = { status, lastChange: Date.now() };
    await this.update();
  }
  async update() {
    if (!this.status)
      throw new Error("status should be init");
    await this.storage.put(CONTAINER_STATE_KEY, this.status);
  }
};
var Container = class extends DurableObject {
  static {
    __name(this, "Container");
  }
  static get outboundByHost() {
    return outboundByHostRegistry.get(this.name);
  }
  static set outboundByHost(handlers) {
    outboundByHostRegistry.set(this.name, handlers);
  }
  static get outboundHandlers() {
    return outboundHandlersRegistry.get(this.name);
  }
  static set outboundHandlers(handlers) {
    const existing = outboundHandlersRegistry.get(this.name) ?? {};
    outboundHandlersRegistry.set(this.name, { ...existing, ...handlers });
  }
  static get outbound() {
    const handlerName = defaultOutboundHandlerNameRegistry.get(this.name);
    if (!handlerName)
      return void 0;
    return outboundHandlersRegistry.get(this.name)?.[handlerName];
  }
  static set outbound(handler) {
    const key = "__outbound__";
    const existing = outboundHandlersRegistry.get(this.name) ?? {};
    outboundHandlersRegistry.set(this.name, { ...existing, [key]: handler });
    defaultOutboundHandlerNameRegistry.set(this.name, key);
  }
  static get outboundProxies() {
    return this.outboundHandlers;
  }
  static set outboundProxies(handlers) {
    this.outboundHandlers = handlers;
  }
  static get outboundProxy() {
    return this.outbound;
  }
  static set outboundProxy(handler) {
    this.outbound = handler;
  }
  // =========================
  //     Public Attributes
  // =========================
  // Default port for the container (undefined means no default port)
  defaultPort;
  // Required ports that should be checked for availability during container startup
  // Override this in your subclass to specify ports that must be ready
  requiredPorts;
  // Timeout after which the container will sleep if no activity
  // The signal sent to the container by default is a SIGTERM.
  // The container won't get a SIGKILL if this threshold is triggered.
  sleepAfter = DEFAULT_SLEEP_AFTER;
  // Container configuration properties
  // Set these properties directly in your container instance
  envVars = {};
  entrypoint;
  enableInternet = true;
  // pingEndpoint is the host and path value that the class will use to send a request to the container and check if the
  // instance is ready.
  //
  // The user does not have to implement this route by any means,
  // but it's still useful if you want to control the path that
  // the Container class uses to send HTTP requests to.
  pingEndpoint = "ping";
  applyOutboundInterceptionPromise = Promise.resolve();
  usingInterception = false;
  // =========================
  //     PUBLIC INTERFACE
  // =========================
  constructor(ctx, env2, options) {
    super(ctx, env2);
    if (ctx.container === void 0) {
      throw new Error("Containers have not been enabled for this Durable Object class. Have you correctly setup your Wrangler config? More info: https://developers.cloudflare.com/containers/get-started/#configuration");
    }
    this.state = new ContainerState(this.ctx.storage);
    this.ctx.blockConcurrencyWhile(async () => {
      this.renewActivityTimeout();
      await this.scheduleNextAlarm();
    });
    this.container = ctx.container;
    const persistedOutboundConfiguration = this.restoreOutboundConfiguration();
    const ctor = this.constructor;
    if (persistedOutboundConfiguration !== void 0 || ctor.outboundByHost !== void 0 || ctor.outbound !== void 0 || ctor.outboundHandlers !== void 0) {
      this.usingInterception = true;
      this.applyOutboundInterceptionPromise = this.applyOutboundInterception();
    }
    if (options) {
      if (options.defaultPort !== void 0)
        this.defaultPort = options.defaultPort;
      if (options.sleepAfter !== void 0)
        this.sleepAfter = options.sleepAfter;
    }
    this.sql`
      CREATE TABLE IF NOT EXISTS container_schedules (
        id TEXT PRIMARY KEY NOT NULL DEFAULT (randomblob(9)),
        callback TEXT NOT NULL,
        payload TEXT,
        type TEXT NOT NULL CHECK(type IN ('scheduled', 'delayed')),
        time INTEGER NOT NULL,
        delayInSeconds INTEGER,
        created_at INTEGER DEFAULT (unixepoch())
      )
    `;
    if (this.container.running) {
      this.monitor = this.container.monitor();
      this.setupMonitorCallbacks();
    }
  }
  /**
   * Gets the current state of the container
   * @returns Promise<State>
   */
  async getState() {
    return { ...await this.state.getState() };
  }
  // ====================================
  //     OUTBOUND INTERCEPTION CONFIG
  // ====================================
  /**
   * Set the catch-all outbound handler to a named method from `outboundHandlers`.
   * Overrides the default `outbound` at runtime via ContainerProxy props.
   *
   * @param methodName - Name of a method defined in `static outboundHandlers`
   * @param params - Optional params passed to the handler as `ctx.params`
   * @throws Error if the method name is not found in `outboundHandlers`
   */
  async setOutboundHandler(methodName, ...paramsArg) {
    this.validateOutboundHandlerMethodName(methodName);
    this.outboundHandlerOverride = paramsArg.length === 0 ? { method: methodName } : { method: methodName, params: paramsArg[0] };
    await this.refreshOutboundInterception();
  }
  /**
   * Add or override a hostname-specific outbound handler at runtime,
   * referencing a named method from `outboundHandlers`.
   * Overrides any matching entry in `static outboundByHost` for this hostname.
   *
   * @param hostname - The hostname or ip:port to intercept (e.g. `'google.com'`)
   * @param methodName - Name of a method defined in `static outboundHandlers`
   * @param params - Optional params passed to the handler as `ctx.params`
   * @throws Error if the method name is not found in `outboundHandlers`
   */
  async setOutboundByHost(hostname, methodName, ...paramsArg) {
    this.validateOutboundHandlerMethodName(methodName);
    this.outboundByHostOverrides[hostname] = paramsArg.length === 0 ? { method: methodName } : { method: methodName, params: paramsArg[0] };
    await this.refreshOutboundInterception();
  }
  /**
   * Remove a runtime hostname override added via `setOutboundByHost`.
   * The default handler from `static outboundByHost` (if any) will be used again.
   *
   * @param hostname - The hostname or ip:port to stop overriding
   */
  async removeOutboundByHost(hostname) {
    delete this.outboundByHostOverrides[hostname];
    await this.refreshOutboundInterception();
  }
  /**
   * Replace all runtime hostname overrides at once.
   * Each value may be either a method name or an object with `method` and `params`.
   *
   * @param handlers - Record mapping hostnames to handler configs in `outboundHandlers`
   * @throws Error if any method name is not found in `outboundHandlers`
   */
  async setOutboundByHosts(handlers) {
    for (const handler of Object.values(handlers)) {
      const methodName = typeof handler === "string" ? handler : handler.method;
      this.validateOutboundHandlerMethodName(methodName);
    }
    this.outboundByHostOverrides = Object.fromEntries(Object.entries(handlers).map(([hostname, handler]) => [
      hostname,
      typeof handler === "string" ? { method: handler } : handler
    ]));
    await this.refreshOutboundInterception();
  }
  // ==========================
  //     CONTAINER STARTING
  // ==========================
  /**
   * Start the container if it's not running and set up monitoring and lifecycle hooks,
   * without waiting for ports to be ready.
   *
   * It will automatically retry if the container fails to start, using the specified waitOptions
   *
   *
   * @example
   * await this.start({
   *   envVars: { DEBUG: 'true', NODE_ENV: 'development' },
   *   entrypoint: ['npm', 'run', 'dev'],
   *   enableInternet: false
   * });
   *
   * @param startOptions - Override `envVars`, `entrypoint` and `enableInternet` on a per-instance basis
   * @param waitOptions - Optional wait configuration with abort signal for cancellation. Default ~8s timeout.
   * @returns A promise that resolves when the container start command has been issued
   * @throws Error if no container context is available or if all start attempts fail
   */
  async start(startOptions, waitOptions) {
    const portToCheck = waitOptions?.portToCheck ?? this.defaultPort ?? (this.requiredPorts ? this.requiredPorts[0] : FALLBACK_PORT_TO_CHECK);
    const pollInterval = waitOptions?.waitInterval ?? INSTANCE_POLL_INTERVAL_MS;
    await this.startContainerIfNotRunning({
      signal: waitOptions?.signal,
      waitInterval: pollInterval,
      retries: waitOptions?.retries ?? Math.ceil(TIMEOUT_TO_GET_CONTAINER_MS / pollInterval),
      portToCheck
    }, startOptions);
    this.setupMonitorCallbacks();
    await this.ctx.blockConcurrencyWhile(async () => {
      await this.onStart();
    });
  }
  async startAndWaitForPorts(portsOrArgs, cancellationOptions, startOptions) {
    let ports;
    let resolvedCancellationOptions = {};
    let resolvedStartOptions = {};
    if (typeof portsOrArgs === "object" && portsOrArgs !== null && !Array.isArray(portsOrArgs)) {
      ports = portsOrArgs.ports;
      resolvedCancellationOptions = portsOrArgs.cancellationOptions;
      resolvedStartOptions = portsOrArgs.startOptions;
    } else {
      ports = portsOrArgs;
      resolvedCancellationOptions = cancellationOptions;
      resolvedStartOptions = startOptions;
    }
    const portsToCheck = await this.getPortsToCheck(ports);
    await this.syncPendingStoppedEvents();
    resolvedCancellationOptions ??= {};
    const containerGetTimeout = resolvedCancellationOptions.instanceGetTimeoutMS ?? TIMEOUT_TO_GET_CONTAINER_MS;
    const pollInterval = resolvedCancellationOptions.waitInterval ?? INSTANCE_POLL_INTERVAL_MS;
    let containerGetRetries = Math.ceil(containerGetTimeout / pollInterval);
    const waitOptions = {
      signal: resolvedCancellationOptions.abort,
      retries: containerGetRetries,
      waitInterval: pollInterval,
      portToCheck: portsToCheck[0]
    };
    const triesUsed = await this.startContainerIfNotRunning(waitOptions, resolvedStartOptions);
    const totalPortReadyTries = Math.ceil((resolvedCancellationOptions.portReadyTimeoutMS ?? TIMEOUT_TO_GET_PORTS_MS) / pollInterval);
    let triesLeft = totalPortReadyTries - triesUsed;
    for (const port of portsToCheck) {
      triesLeft = await this.waitForPort({
        signal: resolvedCancellationOptions.abort,
        waitInterval: pollInterval,
        retries: triesLeft,
        portToCheck: port
      });
    }
    this.setupMonitorCallbacks();
    await this.ctx.blockConcurrencyWhile(async () => {
      await this.state.setHealthy();
      await this.onStart();
    });
  }
  /**
   *
   * Waits for a specified port to be ready
   *
   * Returns the number of tries used to get the port, or throws if it couldn't get the port within the specified retry limits.
   *
   * @param waitOptions -
   * - `portToCheck`: The port number to check
   * - `abort`: Optional AbortSignal to cancel waiting
   * - `retries`: Number of retries before giving up (default: TRIES_TO_GET_PORTS)
   * - `waitInterval`: Interval between retries in milliseconds (default: INSTANCE_POLL_INTERVAL_MS)
   */
  async waitForPort(waitOptions) {
    const port = waitOptions.portToCheck;
    const tcpPort = this.container.getTcpPort(port);
    const abortedSignal = new Promise((res) => {
      waitOptions.signal?.addEventListener("abort", () => {
        res(true);
      });
    });
    const pollInterval = waitOptions.waitInterval ?? INSTANCE_POLL_INTERVAL_MS;
    let tries = waitOptions.retries ?? Math.ceil(TIMEOUT_TO_GET_PORTS_MS / pollInterval);
    for (let i = 0; i < tries; i++) {
      try {
        const combinedSignal = addTimeoutSignal(waitOptions.signal, PING_TIMEOUT_MS);
        await tcpPort.fetch(`http://${this.pingEndpoint}`, { signal: combinedSignal });
        console.log(`Port ${port} is ready`);
        break;
      } catch (e) {
        const errorMessage = e instanceof Error ? e.message : String(e);
        console.debug(`Error checking ${port}: ${errorMessage}`);
        if (!this.container.running) {
          try {
            await this.onError(new Error(`Container crashed while checking for ports, did you start the container and setup the entrypoint correctly?`));
          } catch {
          }
          throw e;
        }
        if (i === tries - 1) {
          try {
            await this.onError(`Failed to verify port ${port} is available after ${(i + 1) * pollInterval}ms, last error: ${errorMessage}`);
          } catch {
          }
          throw e;
        }
        await Promise.any([
          new Promise((resolve) => setTimeout(resolve, pollInterval)),
          abortedSignal
        ]);
        if (waitOptions.signal?.aborted) {
          throw new Error("Container request aborted.");
        }
      }
    }
    return tries;
  }
  // =======================
  //     LIFECYCLE HOOKS
  // =======================
  /**
   * Send a signal to the container.
   * @param signal - The signal to send to the container (default: 15 for SIGTERM)
   */
  async stop(signal = "SIGTERM") {
    if (this.container.running) {
      this.container.signal(typeof signal === "string" ? signalToNumbers[signal] : signal);
    }
    await this.syncPendingStoppedEvents();
  }
  /**
   * Destroys the container with a SIGKILL. Triggers onStop.
   */
  async destroy() {
    await this.container.destroy();
  }
  /**
   * Lifecycle method called when container starts successfully
   * Override this method in subclasses to handle container start events
   */
  onStart() {
  }
  /**
   * Lifecycle method called when container shuts down
   * Override this method in subclasses to handle Container stopped events
   * @param params - Object containing exitCode and reason for the stop
   */
  onStop(_) {
  }
  /**
   * Lifecycle method called when the container is running, and the activity timeout
   * expiration (set by `sleepAfter`) has been reached.
   *
   * If you want to shutdown the container, you should call this.stop() here
   *
   * By default, this method calls `this.stop()`
   */
  async onActivityExpired() {
    console.log("Activity expired, signalling container to stop");
    if (!this.container.running) {
      return;
    }
    await this.stop();
  }
  /**
   * Error handler for container errors
   * Override this method in subclasses to handle container errors
   * @param error - The error that occurred
   * @returns Can return any value or throw the error
   */
  onError(error3) {
    console.error("Container error:", error3);
    throw error3;
  }
  /**
   * Renew the container's activity timeout
   *
   * Call this method whenever there is activity on the container
   */
  renewActivityTimeout() {
    const timeoutInMs = parseTimeExpression(this.sleepAfter) * 1e3;
    this.sleepAfterMs = Date.now() + timeoutInMs;
  }
  /**
   * Decrement the inflight request counter.
   * When the counter transitions to 0, renew the activity timeout so the
   * inactivity window starts fresh from the moment the last request completes.
   */
  decrementInflight() {
    this.inflightRequests = Math.max(0, this.inflightRequests - 1);
    if (this.inflightRequests === 0) {
      this.renewActivityTimeout();
    }
  }
  // ==================
  //     SCHEDULING
  // ==================
  /**
   * Schedule a task to be executed in the future.
   *
   * We strongly recommend using this instead of the `alarm` handler.
   *
   * @template T Type of the payload data
   * @param when When to execute the task (Date object or number of seconds delay)
   * @param callback Name of the method to call
   * @param payload Data to pass to the callback
   * @returns Schedule object representing the scheduled task
   */
  async schedule(when, callback, payload) {
    const id = generateId(9);
    if (typeof callback !== "string") {
      throw new Error("Callback must be a string (method name)");
    }
    if (typeof this[callback] !== "function") {
      throw new Error(`this.${callback} is not a function`);
    }
    if (when instanceof Date) {
      const timestamp = Math.floor(when.getTime() / 1e3);
      this.sql`
        INSERT OR REPLACE INTO container_schedules (id, callback, payload, type, time)
        VALUES (${id}, ${callback}, ${JSON.stringify(payload)}, 'scheduled', ${timestamp})
      `;
      await this.scheduleNextAlarm();
      return {
        taskId: id,
        callback,
        payload,
        time: timestamp,
        type: "scheduled"
      };
    }
    if (typeof when === "number") {
      const time3 = Math.floor(Date.now() / 1e3 + when);
      this.sql`
        INSERT OR REPLACE INTO container_schedules (id, callback, payload, type, delayInSeconds, time)
        VALUES (${id}, ${callback}, ${JSON.stringify(payload)}, 'delayed', ${when}, ${time3})
      `;
      await this.scheduleNextAlarm();
      return {
        taskId: id,
        callback,
        payload,
        delayInSeconds: when,
        time: time3,
        type: "delayed"
      };
    }
    throw new Error("Invalid schedule type. 'when' must be a Date or number of seconds");
  }
  // ============
  //     HTTP
  // ============
  /**
   * Send a request to the container (HTTP or WebSocket) using standard fetch API signature
   *
   * This method handles HTTP requests to the container.
   *
   * WebSocket requests done outside the DO won't work until https://github.com/cloudflare/workerd/issues/2319 is addressed.
   * Until then, please use `switchPort` + `fetch()`.
   *
   * Method supports multiple signatures to match standard fetch API:
   * - containerFetch(request: Request, port?: number)
   * - containerFetch(url: string | URL, init?: RequestInit, port?: number)
   *
   * Starts the container if not already running, and waits for the target port to be ready.
   *
   * @returns A Response from the container
   */
  async containerFetch(requestOrUrl, portOrInit, portParam) {
    let { request, port } = this.requestAndPortFromContainerFetchArgs(requestOrUrl, portOrInit, portParam);
    const state = await this.state.getState();
    if (!this.container.running || state.status !== "healthy") {
      try {
        await this.startAndWaitForPorts(port, { abort: request.signal });
      } catch (e) {
        if (isNoInstanceError(e)) {
          return new Response("There is no Container instance available at this time.\nThis is likely because you have reached your max concurrent instance count (set in wrangler config) or are you currently provisioning the Container.\nIf you are deploying your Container for the first time, check your dashboard to see provisioning status, this may take a few minutes.", { status: 503 });
        } else {
          return new Response(`Failed to start container: ${e instanceof Error ? e.message : String(e)}`, { status: 500 });
        }
      }
    }
    const tcpPort = this.container.getTcpPort(port);
    const containerUrl = request.url.replace("https:", "http:");
    this.inflightRequests++;
    try {
      this.renewActivityTimeout();
      const res = await tcpPort.fetch(containerUrl, request);
      if (res.webSocket !== null) {
        const containerWs = res.webSocket;
        const [client, server] = Object.values(new WebSocketPair());
        let settled = false;
        const settleInflight = /* @__PURE__ */ __name(() => {
          if (!settled) {
            settled = true;
            this.decrementInflight();
          }
        }, "settleInflight");
        containerWs.accept();
        server.accept();
        server.addEventListener("message", (event) => {
          this.renewActivityTimeout();
          try {
            containerWs.send(event.data);
          } catch {
            server.close(1011, "Failed to forward message to container");
          }
        });
        containerWs.addEventListener("message", (event) => {
          this.renewActivityTimeout();
          try {
            server.send(event.data);
          } catch {
            containerWs.close(1011, "Failed to forward message to client");
          }
        });
        server.addEventListener("close", (event) => {
          settleInflight();
          const code = event.code === 1005 || event.code === 1006 ? 1e3 : event.code;
          containerWs.close(code, event.reason);
        });
        containerWs.addEventListener("close", (event) => {
          settleInflight();
          const code = event.code === 1005 || event.code === 1006 ? 1e3 : event.code;
          server.close(code, event.reason);
        });
        server.addEventListener("error", () => {
          settleInflight();
          containerWs.close(1011, "Client WebSocket error");
        });
        containerWs.addEventListener("error", () => {
          settleInflight();
          server.close(1011, "Container WebSocket error");
        });
        return new Response(null, { status: 101, webSocket: client });
      }
      if (res.body !== void 0) {
        let { readable, writable } = new TransformStream();
        res.body?.pipeTo(writable).finally(() => {
          this.decrementInflight();
        });
        return new Response(readable, res);
      }
      this.decrementInflight();
      return res;
    } catch (e) {
      this.decrementInflight();
      if (!(e instanceof Error)) {
        throw e;
      }
      if (e.message.includes("Network connection lost.")) {
        return new Response("Container suddenly disconnected, try again", { status: 500 });
      }
      console.error(`Error proxying request to container ${this.ctx.id}:`, e);
      return new Response(`Error proxying request to container: ${e instanceof Error ? e.message : String(e)}`, { status: 500 });
    }
  }
  /**
   *
   * Fetch handler on the Container class.
   * By default this forwards all requests to the container by calling `containerFetch`.
   * Use `switchPort` to specify which port on the container to target, or this will use `defaultPort`.
   * @param request The request to handle
   */
  async fetch(request) {
    if (this.defaultPort === void 0 && !request.headers.has("cf-container-target-port")) {
      throw new Error("No port configured for this container. Set the `defaultPort` in your Container subclass, or specify a port with `container.fetch(switchPort(request, port))`.");
    }
    let portValue = this.defaultPort;
    if (request.headers.has("cf-container-target-port")) {
      const portFromHeaders = parseInt(request.headers.get("cf-container-target-port") ?? "");
      if (isNaN(portFromHeaders)) {
        throw new Error("port value from switchPort is not a number");
      } else {
        portValue = portFromHeaders;
      }
    }
    return await this.containerFetch(request, portValue);
  }
  // ===============================
  // ===============================
  //     PRIVATE METHODS & ATTRS
  // ===============================
  // ===============================
  // ==========================
  //     PRIVATE ATTRIBUTES
  // ==========================
  container;
  // onStopCalled will be true when we are in the middle of an onStop call
  onStopCalled = false;
  state;
  monitor;
  monitorSetup = false;
  sleepAfterMs = 0;
  inflightRequests = 0;
  // Outbound interception runtime overrides (passed through ContainerProxy props)
  outboundByHostOverrides = {};
  outboundHandlerOverride;
  // ==========================
  //     GENERAL HELPERS
  // ==========================
  /**
   * Validates that a method name exists in the outboundHandlers registry for this class.
   * @throws Error if the method name is not found
   */
  validateOutboundHandlerMethodName(methodName) {
    const handlers = outboundHandlersRegistry.get(this.constructor.name);
    if (!handlers || !(methodName in handlers)) {
      throw new Error(`Outbound handler method '${methodName}' not found in outboundHandlers for ${this.constructor.name}`);
    }
  }
  getOutboundConfiguration() {
    return {
      enableInternet: this.enableInternet,
      outboundByHostOverrides: Object.keys(this.outboundByHostOverrides).length > 0 ? this.outboundByHostOverrides : void 0,
      outboundHandlerOverride: this.outboundHandlerOverride
    };
  }
  persistOutboundConfiguration(configuration) {
    this.ctx.storage.kv.put(OUTBOUND_CONFIGURATION_KEY, configuration);
  }
  restoreOutboundConfiguration() {
    const configuration = this.ctx.storage.kv.get(OUTBOUND_CONFIGURATION_KEY);
    if (!configuration) {
      return void 0;
    }
    if (configuration.enableInternet !== void 0) {
      this.enableInternet = configuration.enableInternet;
    }
    this.outboundHandlerOverride = void 0;
    if (configuration.outboundHandlerOverride !== void 0) {
      try {
        this.validateOutboundHandlerMethodName(configuration.outboundHandlerOverride.method);
        this.outboundHandlerOverride = configuration.outboundHandlerOverride;
      } catch (error3) {
        console.warn("Ignoring invalid persisted outbound handler override:", error3);
      }
    }
    this.outboundByHostOverrides = {};
    for (const [hostname, override] of Object.entries(configuration.outboundByHostOverrides ?? {})) {
      try {
        this.validateOutboundHandlerMethodName(override.method);
        this.outboundByHostOverrides[hostname] = override;
      } catch (error3) {
        console.warn(`Ignoring invalid persisted outbound override for ${hostname}:`, error3);
      }
    }
    return this.getOutboundConfiguration();
  }
  async refreshOutboundInterception() {
    if (!this.usingInterception) {
      return;
    }
    this.applyOutboundInterceptionPromise = this.applyOutboundInterception();
    await this.applyOutboundInterceptionPromise;
  }
  /**
   * Applies (or re-applies) outbound HTTP interception with the current
   * default registries + runtime overrides passed through ContainerProxy props.
   */
  async applyOutboundInterception() {
    const ctx = this.ctx;
    if (ctx.exports === void 0) {
      throw new Error("ctx.exports is undefined, please try to update your compatibility date or export ContainerProxy from the containers package in your worker entrypoint");
    }
    if (ctx.exports.ContainerProxy === void 0) {
      throw new Error("ctx.exports.ContainerProxy is undefined, export ContainerProxy from the containers package in your worker entrypoint");
    }
    const outboundConfiguration = this.getOutboundConfiguration();
    this.persistOutboundConfiguration(outboundConfiguration);
    await this.container.interceptAllOutboundHttp(ctx.exports.ContainerProxy({
      props: {
        enableInternet: outboundConfiguration.enableInternet,
        containerId: this.ctx.id.toString(),
        className: this.constructor.name,
        outboundByHostOverrides: outboundConfiguration.outboundByHostOverrides,
        outboundHandlerOverride: outboundConfiguration.outboundHandlerOverride
      }
    }));
  }
  /**
   * Execute SQL queries against the Container's database
   */
  sql(strings, ...values) {
    let query = "";
    query = strings.reduce((acc, str, i) => acc + str + (i < values.length ? "?" : ""), "");
    return [...this.ctx.storage.sql.exec(query, ...values)];
  }
  requestAndPortFromContainerFetchArgs(requestOrUrl, portOrInit, portParam) {
    let request;
    let port;
    if (requestOrUrl instanceof Request) {
      request = requestOrUrl;
      port = typeof portOrInit === "number" ? portOrInit : void 0;
    } else {
      const url = typeof requestOrUrl === "string" ? requestOrUrl : requestOrUrl.toString();
      const init = typeof portOrInit === "number" ? {} : portOrInit || {};
      port = typeof portOrInit === "number" ? portOrInit : typeof portParam === "number" ? portParam : void 0;
      request = new Request(url, init);
    }
    port ??= this.defaultPort;
    if (port === void 0) {
      throw new Error("No port specified for container fetch. Set defaultPort or specify a port parameter.");
    }
    return { request, port };
  }
  /**
   *
   * The method prioritizes port sources in this order:
   * 1. Ports specified directly in the method call
   * 2. `requiredPorts` class property (if set)
   * 3. `defaultPort` (if neither of the above is specified)
   * 4. Falls back to port 33 if none of the above are set
   */
  async getPortsToCheck(overridePorts) {
    let portsToCheck = [];
    if (overridePorts !== void 0) {
      portsToCheck = Array.isArray(overridePorts) ? overridePorts : [overridePorts];
    } else if (this.requiredPorts && this.requiredPorts.length > 0) {
      portsToCheck = [...this.requiredPorts];
    } else {
      portsToCheck = [this.defaultPort ?? FALLBACK_PORT_TO_CHECK];
    }
    return portsToCheck;
  }
  // ===========================================
  //     CONTAINER INTERACTION & MONITORING
  // ===========================================
  /**
   * Tries to start a container if it's not already running
   * Returns the number of tries used
   */
  async startContainerIfNotRunning(waitOptions, options) {
    if (this.container.running) {
      if (!this.monitor) {
        this.monitor = this.container.monitor();
      }
      return 0;
    }
    const abortedSignal = new Promise((res) => {
      waitOptions.signal?.addEventListener("abort", () => {
        res(true);
      });
    });
    const pollInterval = waitOptions.waitInterval ?? INSTANCE_POLL_INTERVAL_MS;
    const totalTries = waitOptions.retries ?? Math.ceil(TIMEOUT_TO_GET_CONTAINER_MS / pollInterval);
    await this.state.setRunning();
    for (let tries = 0; tries < totalTries; tries++) {
      const envVars = options?.envVars ?? this.envVars;
      const entrypoint = options?.entrypoint ?? this.entrypoint;
      const enableInternet = options?.enableInternet ?? this.enableInternet;
      const startConfig = {
        enableInternet
      };
      if (envVars && Object.keys(envVars).length > 0)
        startConfig.env = envVars;
      if (entrypoint)
        startConfig.entrypoint = entrypoint;
      this.renewActivityTimeout();
      const handleError = /* @__PURE__ */ __name(async () => {
        const err = await this.monitor?.catch((err2) => err2);
        if (typeof err === "number") {
          const toThrow = new Error(`Container exited before we could determine the container health, exit code: ${err}`);
          try {
            await this.onError(toThrow);
          } catch {
          }
          throw toThrow;
        } else if (!isNoInstanceError(err)) {
          try {
            await this.onError(err);
          } catch {
          }
          throw err;
        }
      }, "handleError");
      if (tries > 0 && !this.container.running) {
        await handleError();
      }
      await this.scheduleNextAlarm();
      if (!this.container.running) {
        await this.refreshOutboundInterception();
        this.container.start(startConfig);
        this.monitor = this.container.monitor();
      } else {
        await this.scheduleNextAlarm();
      }
      this.renewActivityTimeout();
      const port = this.container.getTcpPort(waitOptions.portToCheck);
      try {
        const combinedSignal = addTimeoutSignal(waitOptions.signal, PING_TIMEOUT_MS);
        await port.fetch("http://containerstarthealthcheck", { signal: combinedSignal });
        return tries;
      } catch (error3) {
        if (isNotListeningError(error3) && this.container.running) {
          return tries;
        }
        if (!this.container.running && isNotListeningError(error3)) {
          await handleError();
        }
        console.debug("Error checking if container is ready:", error3 instanceof Error ? error3.message : String(error3));
        await Promise.any([
          new Promise((res) => setTimeout(res, waitOptions.waitInterval)),
          abortedSignal
        ]);
        if (waitOptions.signal?.aborted) {
          throw new Error("Aborted waiting for container to start as we received a cancellation signal");
        }
        if (totalTries === tries + 1) {
          if (error3 instanceof Error && error3.message.includes("Network connection lost")) {
            this.ctx.abort();
          }
          throw new Error(NO_CONTAINER_INSTANCE_ERROR);
        }
        continue;
      }
    }
    throw new Error(`Container did not start after ${totalTries * pollInterval}ms`);
  }
  setupMonitorCallbacks() {
    if (this.monitorSetup) {
      return;
    }
    this.monitorSetup = true;
    this.monitor?.then(async () => {
      await this.ctx.blockConcurrencyWhile(async () => {
        await this.state.setStoppedWithCode(0);
      });
    }).catch(async (error3) => {
      if (isNoInstanceError(error3)) {
        return;
      }
      const exitCode2 = getExitCodeFromError(error3);
      if (exitCode2 !== null) {
        await this.state.setStoppedWithCode(exitCode2);
        this.monitorSetup = false;
        this.monitor = void 0;
        return;
      }
      try {
        await this.onError(error3);
      } catch {
      }
    }).finally(() => {
      this.monitorSetup = false;
      if (this.timeout) {
        if (this.resolve)
          this.resolve();
        clearTimeout(this.timeout);
      }
    });
  }
  deleteSchedules(name) {
    this.sql`DELETE FROM container_schedules WHERE callback = ${name}`;
  }
  // ============================
  //     ALARMS AND SCHEDULES
  // ============================
  /**
   * Method called when an alarm fires
   * Executes any scheduled tasks that are due
   */
  async alarm(alarmProps) {
    if (alarmProps.isRetry && alarmProps.retryCount > MAX_ALARM_RETRIES) {
      const scheduleCount = Number(this.sql`SELECT COUNT(*) as count FROM container_schedules`[0]?.count) || 0;
      const hasScheduledTasks = scheduleCount > 0;
      if (hasScheduledTasks || this.container.running) {
        await this.scheduleNextAlarm();
      }
      return;
    }
    const prevAlarm = Date.now();
    await this.ctx.storage.setAlarm(prevAlarm);
    await this.ctx.storage.sync();
    const result = this.sql`
         SELECT * FROM container_schedules;
       `;
    let minTime = Date.now() + 3 * 60 * 1e3;
    const now = Date.now() / 1e3;
    for (const row of result) {
      if (row.time > now) {
        continue;
      }
      const callback = this[row.callback];
      if (!callback || typeof callback !== "function") {
        console.error(`Callback ${row.callback} not found or is not a function`);
        continue;
      }
      const schedule = this.getSchedule(row.id);
      try {
        const payload = row.payload ? JSON.parse(row.payload) : void 0;
        await callback.call(this, payload, await schedule);
      } catch (e) {
        console.error(`Error executing scheduled callback "${row.callback}":`, e);
      }
      this.sql`DELETE FROM container_schedules WHERE id = ${row.id}`;
    }
    const resultForMinTime = this.sql`
         SELECT * FROM container_schedules;
       `;
    const minTimeFromSchedules = Math.min(...resultForMinTime.map((r) => r.time * 1e3));
    if (!this.container.running) {
      await this.syncPendingStoppedEvents();
      if (resultForMinTime.length == 0) {
        await this.ctx.storage.deleteAlarm();
      } else {
        await this.ctx.storage.setAlarm(minTimeFromSchedules);
      }
      return;
    }
    if (this.isActivityExpired()) {
      await this.onActivityExpired();
      this.renewActivityTimeout();
      return;
    }
    minTime = Math.min(minTimeFromSchedules, minTime, this.sleepAfterMs);
    const timeout = Math.max(0, minTime - Date.now());
    await new Promise((resolve) => {
      this.resolve = resolve;
      if (!this.container.running) {
        resolve();
        return;
      }
      this.timeout = setTimeout(() => {
        resolve();
      }, timeout);
    });
    await this.ctx.storage.setAlarm(Date.now());
  }
  timeout;
  resolve;
  // synchronises container state with the container source of truth to process events
  async syncPendingStoppedEvents() {
    const state = await this.state.getState();
    if (!this.container.running && state.status === "healthy") {
      await this.callOnStop({ exitCode: 0, reason: "exit" });
      return;
    }
    if (!this.container.running && state.status === "stopped_with_code") {
      await this.callOnStop({ exitCode: state.exitCode ?? 0, reason: "exit" });
      return;
    }
  }
  async callOnStop(onStopParams) {
    if (this.onStopCalled) {
      return;
    }
    this.onStopCalled = true;
    const promise = this.onStop(onStopParams);
    if (promise instanceof Promise) {
      await promise.finally(() => {
        this.onStopCalled = false;
      });
    } else {
      this.onStopCalled = false;
    }
    await this.state.setStopped();
  }
  /**
   * Schedule the next alarm based on upcoming tasks
   */
  async scheduleNextAlarm(ms = 1e3) {
    const nextTime = ms + Date.now();
    if (this.timeout) {
      if (this.resolve)
        this.resolve();
      clearTimeout(this.timeout);
    }
    await this.ctx.storage.setAlarm(nextTime);
    await this.ctx.storage.sync();
  }
  async listSchedules(name) {
    const result = this.sql`
      SELECT * FROM container_schedules WHERE callback = ${name} LIMIT 1
    `;
    if (!result || result.length === 0) {
      return [];
    }
    return result.map(this.toSchedule);
  }
  toSchedule(schedule) {
    let payload;
    try {
      payload = JSON.parse(schedule.payload);
    } catch (e) {
      console.error(`Error parsing payload for schedule ${schedule.id}:`, e);
      payload = void 0;
    }
    if (schedule.type === "delayed") {
      return {
        taskId: schedule.id,
        callback: schedule.callback,
        payload,
        type: "delayed",
        time: schedule.time,
        delayInSeconds: schedule.delayInSeconds
      };
    }
    return {
      taskId: schedule.id,
      callback: schedule.callback,
      payload,
      type: "scheduled",
      time: schedule.time
    };
  }
  /**
   * Get a scheduled task by ID
   * @template T Type of the payload data
   * @param id ID of the scheduled task
   * @returns The Schedule object or undefined if not found
   */
  async getSchedule(id) {
    const result = this.sql`
      SELECT * FROM container_schedules WHERE id = ${id} LIMIT 1
    `;
    if (!result || result.length === 0) {
      return void 0;
    }
    const schedule = result[0];
    return this.toSchedule(schedule);
  }
  isActivityExpired() {
    if (this.inflightRequests > 0) {
      this.renewActivityTimeout();
      return false;
    }
    return this.sleepAfterMs <= Date.now();
  }
};

// ../../node_modules/@cloudflare/containers/dist/lib/utils.js
var singletonContainerId = "cf-singleton-container";
function getContainer(binding2, name = singletonContainerId) {
  const objectId = binding2.idFromName(name);
  return binding2.get(objectId);
}
__name(getContainer, "getContainer");
function switchPort(request, port) {
  const headers = new Headers(request.headers);
  headers.set("cf-container-target-port", port.toString());
  return new Request(request, { headers });
}
__name(switchPort, "switchPort");

// ../../node_modules/aws4fetch/dist/aws4fetch.esm.mjs
var encoder = new TextEncoder();
var HOST_SERVICES = {
  appstream2: "appstream",
  cloudhsmv2: "cloudhsm",
  email: "ses",
  marketplace: "aws-marketplace",
  mobile: "AWSMobileHubService",
  pinpoint: "mobiletargeting",
  queue: "sqs",
  "git-codecommit": "codecommit",
  "mturk-requester-sandbox": "mturk-requester",
  "personalize-runtime": "personalize"
};
var UNSIGNABLE_HEADERS = /* @__PURE__ */ new Set([
  "authorization",
  "content-type",
  "content-length",
  "user-agent",
  "presigned-expires",
  "expect",
  "x-amzn-trace-id",
  "range",
  "connection"
]);
var AwsClient = class {
  static {
    __name(this, "AwsClient");
  }
  constructor({ accessKeyId, secretAccessKey, sessionToken, service, region, cache, retries, initRetryMs }) {
    if (accessKeyId == null) throw new TypeError("accessKeyId is a required option");
    if (secretAccessKey == null) throw new TypeError("secretAccessKey is a required option");
    this.accessKeyId = accessKeyId;
    this.secretAccessKey = secretAccessKey;
    this.sessionToken = sessionToken;
    this.service = service;
    this.region = region;
    this.cache = cache || /* @__PURE__ */ new Map();
    this.retries = retries != null ? retries : 10;
    this.initRetryMs = initRetryMs || 50;
  }
  async sign(input, init) {
    if (input instanceof Request) {
      const { method, url, headers, body } = input;
      init = Object.assign({ method, url, headers }, init);
      if (init.body == null && headers.has("Content-Type")) {
        init.body = body != null && headers.has("X-Amz-Content-Sha256") ? body : await input.clone().arrayBuffer();
      }
      input = url;
    }
    const signer = new AwsV4Signer(Object.assign({ url: input.toString() }, init, this, init && init.aws));
    const signed = Object.assign({}, init, await signer.sign());
    delete signed.aws;
    try {
      return new Request(signed.url.toString(), signed);
    } catch (e) {
      if (e instanceof TypeError) {
        return new Request(signed.url.toString(), Object.assign({ duplex: "half" }, signed));
      }
      throw e;
    }
  }
  async fetch(input, init) {
    for (let i = 0; i <= this.retries; i++) {
      const fetched = fetch(await this.sign(input, init));
      if (i === this.retries) {
        return fetched;
      }
      const res = await fetched;
      if (res.status < 500 && res.status !== 429) {
        return res;
      }
      await new Promise((resolve) => setTimeout(resolve, Math.random() * this.initRetryMs * Math.pow(2, i)));
    }
    throw new Error("An unknown error occurred, ensure retries is not negative");
  }
};
var AwsV4Signer = class {
  static {
    __name(this, "AwsV4Signer");
  }
  constructor({ method, url, headers, body, accessKeyId, secretAccessKey, sessionToken, service, region, cache, datetime, signQuery, appendSessionToken, allHeaders, singleEncode }) {
    if (url == null) throw new TypeError("url is a required option");
    if (accessKeyId == null) throw new TypeError("accessKeyId is a required option");
    if (secretAccessKey == null) throw new TypeError("secretAccessKey is a required option");
    this.method = method || (body ? "POST" : "GET");
    this.url = new URL(url);
    this.headers = new Headers(headers || {});
    this.body = body;
    this.accessKeyId = accessKeyId;
    this.secretAccessKey = secretAccessKey;
    this.sessionToken = sessionToken;
    let guessedService, guessedRegion;
    if (!service || !region) {
      [guessedService, guessedRegion] = guessServiceRegion(this.url, this.headers);
    }
    this.service = service || guessedService || "";
    this.region = region || guessedRegion || "us-east-1";
    this.cache = cache || /* @__PURE__ */ new Map();
    this.datetime = datetime || (/* @__PURE__ */ new Date()).toISOString().replace(/[:-]|\.\d{3}/g, "");
    this.signQuery = signQuery;
    this.appendSessionToken = appendSessionToken || this.service === "iotdevicegateway";
    this.headers.delete("Host");
    if (this.service === "s3" && !this.signQuery && !this.headers.has("X-Amz-Content-Sha256")) {
      this.headers.set("X-Amz-Content-Sha256", "UNSIGNED-PAYLOAD");
    }
    const params = this.signQuery ? this.url.searchParams : this.headers;
    params.set("X-Amz-Date", this.datetime);
    if (this.sessionToken && !this.appendSessionToken) {
      params.set("X-Amz-Security-Token", this.sessionToken);
    }
    this.signableHeaders = ["host", ...this.headers.keys()].filter((header) => allHeaders || !UNSIGNABLE_HEADERS.has(header)).sort();
    this.signedHeaders = this.signableHeaders.join(";");
    this.canonicalHeaders = this.signableHeaders.map((header) => header + ":" + (header === "host" ? this.url.host : (this.headers.get(header) || "").replace(/\s+/g, " "))).join("\n");
    this.credentialString = [this.datetime.slice(0, 8), this.region, this.service, "aws4_request"].join("/");
    if (this.signQuery) {
      if (this.service === "s3" && !params.has("X-Amz-Expires")) {
        params.set("X-Amz-Expires", "86400");
      }
      params.set("X-Amz-Algorithm", "AWS4-HMAC-SHA256");
      params.set("X-Amz-Credential", this.accessKeyId + "/" + this.credentialString);
      params.set("X-Amz-SignedHeaders", this.signedHeaders);
    }
    if (this.service === "s3") {
      try {
        this.encodedPath = decodeURIComponent(this.url.pathname.replace(/\+/g, " "));
      } catch (e) {
        this.encodedPath = this.url.pathname;
      }
    } else {
      this.encodedPath = this.url.pathname.replace(/\/+/g, "/");
    }
    if (!singleEncode) {
      this.encodedPath = encodeURIComponent(this.encodedPath).replace(/%2F/g, "/");
    }
    this.encodedPath = encodeRfc3986(this.encodedPath);
    const seenKeys = /* @__PURE__ */ new Set();
    this.encodedSearch = [...this.url.searchParams].filter(([k]) => {
      if (!k) return false;
      if (this.service === "s3") {
        if (seenKeys.has(k)) return false;
        seenKeys.add(k);
      }
      return true;
    }).map((pair) => pair.map((p) => encodeRfc3986(encodeURIComponent(p)))).sort(([k1, v1], [k2, v2]) => k1 < k2 ? -1 : k1 > k2 ? 1 : v1 < v2 ? -1 : v1 > v2 ? 1 : 0).map((pair) => pair.join("=")).join("&");
  }
  async sign() {
    if (this.signQuery) {
      this.url.searchParams.set("X-Amz-Signature", await this.signature());
      if (this.sessionToken && this.appendSessionToken) {
        this.url.searchParams.set("X-Amz-Security-Token", this.sessionToken);
      }
    } else {
      this.headers.set("Authorization", await this.authHeader());
    }
    return {
      method: this.method,
      url: this.url,
      headers: this.headers,
      body: this.body
    };
  }
  async authHeader() {
    return [
      "AWS4-HMAC-SHA256 Credential=" + this.accessKeyId + "/" + this.credentialString,
      "SignedHeaders=" + this.signedHeaders,
      "Signature=" + await this.signature()
    ].join(", ");
  }
  async signature() {
    const date = this.datetime.slice(0, 8);
    const cacheKey = [this.secretAccessKey, date, this.region, this.service].join();
    let kCredentials = this.cache.get(cacheKey);
    if (!kCredentials) {
      const kDate = await hmac("AWS4" + this.secretAccessKey, date);
      const kRegion = await hmac(kDate, this.region);
      const kService = await hmac(kRegion, this.service);
      kCredentials = await hmac(kService, "aws4_request");
      this.cache.set(cacheKey, kCredentials);
    }
    return buf2hex(await hmac(kCredentials, await this.stringToSign()));
  }
  async stringToSign() {
    return [
      "AWS4-HMAC-SHA256",
      this.datetime,
      this.credentialString,
      buf2hex(await hash(await this.canonicalString()))
    ].join("\n");
  }
  async canonicalString() {
    return [
      this.method.toUpperCase(),
      this.encodedPath,
      this.encodedSearch,
      this.canonicalHeaders + "\n",
      this.signedHeaders,
      await this.hexBodyHash()
    ].join("\n");
  }
  async hexBodyHash() {
    let hashHeader = this.headers.get("X-Amz-Content-Sha256") || (this.service === "s3" && this.signQuery ? "UNSIGNED-PAYLOAD" : null);
    if (hashHeader == null) {
      if (this.body && typeof this.body !== "string" && !("byteLength" in this.body)) {
        throw new Error("body must be a string, ArrayBuffer or ArrayBufferView, unless you include the X-Amz-Content-Sha256 header");
      }
      hashHeader = buf2hex(await hash(this.body || ""));
    }
    return hashHeader;
  }
};
async function hmac(key, string) {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    typeof key === "string" ? encoder.encode(key) : key,
    { name: "HMAC", hash: { name: "SHA-256" } },
    false,
    ["sign"]
  );
  return crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(string));
}
__name(hmac, "hmac");
async function hash(content) {
  return crypto.subtle.digest("SHA-256", typeof content === "string" ? encoder.encode(content) : content);
}
__name(hash, "hash");
var HEX_CHARS = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "a", "b", "c", "d", "e", "f"];
function buf2hex(arrayBuffer) {
  const buffer = new Uint8Array(arrayBuffer);
  let out = "";
  for (let idx = 0; idx < buffer.length; idx++) {
    const n = buffer[idx];
    out += HEX_CHARS[n >>> 4 & 15];
    out += HEX_CHARS[n & 15];
  }
  return out;
}
__name(buf2hex, "buf2hex");
function encodeRfc3986(urlEncodedStr) {
  return urlEncodedStr.replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}
__name(encodeRfc3986, "encodeRfc3986");
function guessServiceRegion(url, headers) {
  const { hostname, pathname } = url;
  if (hostname.endsWith(".on.aws")) {
    const match2 = hostname.match(/^[^.]{1,63}\.lambda-url\.([^.]{1,63})\.on\.aws$/);
    return match2 != null ? ["lambda", match2[1] || ""] : ["", ""];
  }
  if (hostname.endsWith(".r2.cloudflarestorage.com")) {
    return ["s3", "auto"];
  }
  if (hostname.endsWith(".backblazeb2.com")) {
    const match2 = hostname.match(/^(?:[^.]{1,63}\.)?s3\.([^.]{1,63})\.backblazeb2\.com$/);
    return match2 != null ? ["s3", match2[1] || ""] : ["", ""];
  }
  const match = hostname.replace("dualstack.", "").match(/([^.]{1,63})\.(?:([^.]{0,63})\.)?amazonaws\.com(?:\.cn)?$/);
  let service = match && match[1] || "";
  let region = match && match[2];
  if (region === "us-gov") {
    region = "us-gov-west-1";
  } else if (region === "s3" || region === "s3-accelerate") {
    region = "us-east-1";
    service = "s3";
  } else if (service === "iot") {
    if (hostname.startsWith("iot.")) {
      service = "execute-api";
    } else if (hostname.startsWith("data.jobs.iot.")) {
      service = "iot-jobs-data";
    } else {
      service = pathname === "/mqtt" ? "iotdevicegateway" : "iotdata";
    }
  } else if (service === "autoscaling") {
    const targetPrefix = (headers.get("X-Amz-Target") || "").split(".")[0];
    if (targetPrefix === "AnyScaleFrontendService") {
      service = "application-autoscaling";
    } else if (targetPrefix === "AnyScaleScalingPlannerFrontendService") {
      service = "autoscaling-plans";
    }
  } else if (region == null && service.startsWith("s3-")) {
    region = service.slice(3).replace(/^fips-|^external-1/, "");
    service = "s3";
  } else if (service.endsWith("-fips")) {
    service = service.slice(0, -5);
  } else if (region && /-\d$/.test(service) && !/-\d$/.test(region)) {
    [service, region] = [region, service];
  }
  return [HOST_SERVICES[service] || service, region || ""];
}
__name(guessServiceRegion, "guessServiceRegion");

// ../../node_modules/@cloudflare/sandbox/dist/index.js
import path from "node:path/posix";
var SandboxError = class extends Error {
  static {
    __name(this, "SandboxError");
  }
  constructor(errorResponse) {
    super(errorResponse.message);
    this.errorResponse = errorResponse;
    this.name = "SandboxError";
  }
  get code() {
    return this.errorResponse.code;
  }
  get context() {
    return this.errorResponse.context;
  }
  get httpStatus() {
    return this.errorResponse.httpStatus;
  }
  get operation() {
    return this.errorResponse.operation;
  }
  get suggestion() {
    return this.errorResponse.suggestion;
  }
  get timestamp() {
    return this.errorResponse.timestamp;
  }
  get documentation() {
    return this.errorResponse.documentation;
  }
  toJSON() {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      context: this.context,
      httpStatus: this.httpStatus,
      operation: this.operation,
      suggestion: this.suggestion,
      timestamp: this.timestamp,
      documentation: this.documentation,
      stack: this.stack
    };
  }
};
var FileNotFoundError = class extends SandboxError {
  static {
    __name(this, "FileNotFoundError");
  }
  constructor(errorResponse) {
    super(errorResponse);
    this.name = "FileNotFoundError";
  }
  get path() {
    return this.context.path;
  }
};
var FileExistsError = class extends SandboxError {
  static {
    __name(this, "FileExistsError");
  }
  constructor(errorResponse) {
    super(errorResponse);
    this.name = "FileExistsError";
  }
  get path() {
    return this.context.path;
  }
};
var FileTooLargeError = class extends SandboxError {
  static {
    __name(this, "FileTooLargeError");
  }
  constructor(errorResponse) {
    super(errorResponse);
    this.name = "FileTooLargeError";
  }
  get path() {
    return this.context.path;
  }
};
var FileSystemError = class extends SandboxError {
  static {
    __name(this, "FileSystemError");
  }
  constructor(errorResponse) {
    super(errorResponse);
    this.name = "FileSystemError";
  }
  get path() {
    return this.context.path;
  }
  get stderr() {
    return this.context.stderr;
  }
  get exitCode() {
    return this.context.exitCode;
  }
};
var PermissionDeniedError = class extends SandboxError {
  static {
    __name(this, "PermissionDeniedError");
  }
  constructor(errorResponse) {
    super(errorResponse);
    this.name = "PermissionDeniedError";
  }
  get path() {
    return this.context.path;
  }
};
var CommandNotFoundError = class extends SandboxError {
  static {
    __name(this, "CommandNotFoundError");
  }
  constructor(errorResponse) {
    super(errorResponse);
    this.name = "CommandNotFoundError";
  }
  get command() {
    return this.context.command;
  }
};
var CommandError = class extends SandboxError {
  static {
    __name(this, "CommandError");
  }
  constructor(errorResponse) {
    super(errorResponse);
    this.name = "CommandError";
  }
  get command() {
    return this.context.command;
  }
  get exitCode() {
    return this.context.exitCode;
  }
  get stdout() {
    return this.context.stdout;
  }
  get stderr() {
    return this.context.stderr;
  }
};
var ProcessNotFoundError = class extends SandboxError {
  static {
    __name(this, "ProcessNotFoundError");
  }
  constructor(errorResponse) {
    super(errorResponse);
    this.name = "ProcessNotFoundError";
  }
  get processId() {
    return this.context.processId;
  }
};
var ProcessError = class extends SandboxError {
  static {
    __name(this, "ProcessError");
  }
  constructor(errorResponse) {
    super(errorResponse);
    this.name = "ProcessError";
  }
  get processId() {
    return this.context.processId;
  }
  get pid() {
    return this.context.pid;
  }
  get exitCode() {
    return this.context.exitCode;
  }
  get stderr() {
    return this.context.stderr;
  }
};
var SessionAlreadyExistsError = class extends SandboxError {
  static {
    __name(this, "SessionAlreadyExistsError");
  }
  constructor(errorResponse) {
    super(errorResponse);
    this.name = "SessionAlreadyExistsError";
  }
  get sessionId() {
    return this.context.sessionId;
  }
};
var SessionDestroyedError = class extends SandboxError {
  static {
    __name(this, "SessionDestroyedError");
  }
  constructor(errorResponse) {
    super(errorResponse);
    this.name = "SessionDestroyedError";
  }
  get sessionId() {
    return this.context.sessionId;
  }
};
var PortAlreadyExposedError = class extends SandboxError {
  static {
    __name(this, "PortAlreadyExposedError");
  }
  constructor(errorResponse) {
    super(errorResponse);
    this.name = "PortAlreadyExposedError";
  }
  get port() {
    return this.context.port;
  }
  get portName() {
    return this.context.portName;
  }
};
var PortNotExposedError = class extends SandboxError {
  static {
    __name(this, "PortNotExposedError");
  }
  constructor(errorResponse) {
    super(errorResponse);
    this.name = "PortNotExposedError";
  }
  get port() {
    return this.context.port;
  }
};
var InvalidPortError = class extends SandboxError {
  static {
    __name(this, "InvalidPortError");
  }
  constructor(errorResponse) {
    super(errorResponse);
    this.name = "InvalidPortError";
  }
  get port() {
    return this.context.port;
  }
  get reason() {
    return this.context.reason;
  }
};
var ServiceNotRespondingError = class extends SandboxError {
  static {
    __name(this, "ServiceNotRespondingError");
  }
  constructor(errorResponse) {
    super(errorResponse);
    this.name = "ServiceNotRespondingError";
  }
  get port() {
    return this.context.port;
  }
  get portName() {
    return this.context.portName;
  }
};
var PortInUseError = class extends SandboxError {
  static {
    __name(this, "PortInUseError");
  }
  constructor(errorResponse) {
    super(errorResponse);
    this.name = "PortInUseError";
  }
  get port() {
    return this.context.port;
  }
};
var PortError = class extends SandboxError {
  static {
    __name(this, "PortError");
  }
  constructor(errorResponse) {
    super(errorResponse);
    this.name = "PortError";
  }
  get port() {
    return this.context.port;
  }
  get portName() {
    return this.context.portName;
  }
  get stderr() {
    return this.context.stderr;
  }
};
var CustomDomainRequiredError = class extends SandboxError {
  static {
    __name(this, "CustomDomainRequiredError");
  }
  constructor(errorResponse) {
    super(errorResponse);
    this.name = "CustomDomainRequiredError";
  }
};
var GitRepositoryNotFoundError = class extends SandboxError {
  static {
    __name(this, "GitRepositoryNotFoundError");
  }
  constructor(errorResponse) {
    super(errorResponse);
    this.name = "GitRepositoryNotFoundError";
  }
  get repository() {
    return this.context.repository;
  }
};
var GitAuthenticationError = class extends SandboxError {
  static {
    __name(this, "GitAuthenticationError");
  }
  constructor(errorResponse) {
    super(errorResponse);
    this.name = "GitAuthenticationError";
  }
  get repository() {
    return this.context.repository;
  }
};
var GitBranchNotFoundError = class extends SandboxError {
  static {
    __name(this, "GitBranchNotFoundError");
  }
  constructor(errorResponse) {
    super(errorResponse);
    this.name = "GitBranchNotFoundError";
  }
  get branch() {
    return this.context.branch;
  }
  get repository() {
    return this.context.repository;
  }
};
var GitNetworkError = class extends SandboxError {
  static {
    __name(this, "GitNetworkError");
  }
  constructor(errorResponse) {
    super(errorResponse);
    this.name = "GitNetworkError";
  }
  get repository() {
    return this.context.repository;
  }
  get branch() {
    return this.context.branch;
  }
  get targetDir() {
    return this.context.targetDir;
  }
};
var GitCloneError = class extends SandboxError {
  static {
    __name(this, "GitCloneError");
  }
  constructor(errorResponse) {
    super(errorResponse);
    this.name = "GitCloneError";
  }
  get repository() {
    return this.context.repository;
  }
  get targetDir() {
    return this.context.targetDir;
  }
  get stderr() {
    return this.context.stderr;
  }
  get exitCode() {
    return this.context.exitCode;
  }
};
var GitCheckoutError = class extends SandboxError {
  static {
    __name(this, "GitCheckoutError");
  }
  constructor(errorResponse) {
    super(errorResponse);
    this.name = "GitCheckoutError";
  }
  get branch() {
    return this.context.branch;
  }
  get repository() {
    return this.context.repository;
  }
  get stderr() {
    return this.context.stderr;
  }
};
var InvalidGitUrlError = class extends SandboxError {
  static {
    __name(this, "InvalidGitUrlError");
  }
  constructor(errorResponse) {
    super(errorResponse);
    this.name = "InvalidGitUrlError";
  }
  get validationErrors() {
    return this.context.validationErrors;
  }
};
var GitError = class extends SandboxError {
  static {
    __name(this, "GitError");
  }
  constructor(errorResponse) {
    super(errorResponse);
    this.name = "GitError";
  }
  get repository() {
    return this.context.repository;
  }
  get branch() {
    return this.context.branch;
  }
  get targetDir() {
    return this.context.targetDir;
  }
  get stderr() {
    return this.context.stderr;
  }
  get exitCode() {
    return this.context.exitCode;
  }
};
var InterpreterNotReadyError = class extends SandboxError {
  static {
    __name(this, "InterpreterNotReadyError");
  }
  constructor(errorResponse) {
    super(errorResponse);
    this.name = "InterpreterNotReadyError";
  }
  get retryAfter() {
    return this.context.retryAfter;
  }
  get progress() {
    return this.context.progress;
  }
};
var ContextNotFoundError = class extends SandboxError {
  static {
    __name(this, "ContextNotFoundError");
  }
  constructor(errorResponse) {
    super(errorResponse);
    this.name = "ContextNotFoundError";
  }
  get contextId() {
    return this.context.contextId;
  }
};
var CodeExecutionError = class extends SandboxError {
  static {
    __name(this, "CodeExecutionError");
  }
  constructor(errorResponse) {
    super(errorResponse);
    this.name = "CodeExecutionError";
  }
  get contextId() {
    return this.context.contextId;
  }
  get ename() {
    return this.context.ename;
  }
  get evalue() {
    return this.context.evalue;
  }
  get traceback() {
    return this.context.traceback;
  }
};
var ValidationFailedError = class extends SandboxError {
  static {
    __name(this, "ValidationFailedError");
  }
  constructor(errorResponse) {
    super(errorResponse);
    this.name = "ValidationFailedError";
  }
  get validationErrors() {
    return this.context.validationErrors;
  }
};
var ProcessReadyTimeoutError = class extends SandboxError {
  static {
    __name(this, "ProcessReadyTimeoutError");
  }
  constructor(errorResponse) {
    super(errorResponse);
    this.name = "ProcessReadyTimeoutError";
  }
  get processId() {
    return this.context.processId;
  }
  get command() {
    return this.context.command;
  }
  get condition() {
    return this.context.condition;
  }
  get timeout() {
    return this.context.timeout;
  }
};
var ProcessExitedBeforeReadyError = class extends SandboxError {
  static {
    __name(this, "ProcessExitedBeforeReadyError");
  }
  constructor(errorResponse) {
    super(errorResponse);
    this.name = "ProcessExitedBeforeReadyError";
  }
  get processId() {
    return this.context.processId;
  }
  get command() {
    return this.context.command;
  }
  get condition() {
    return this.context.condition;
  }
  get exitCode() {
    return this.context.exitCode;
  }
};
var BackupNotFoundError = class extends SandboxError {
  static {
    __name(this, "BackupNotFoundError");
  }
  constructor(errorResponse) {
    super(errorResponse);
    this.name = "BackupNotFoundError";
  }
  get backupId() {
    return this.context.backupId;
  }
};
var BackupExpiredError = class extends SandboxError {
  static {
    __name(this, "BackupExpiredError");
  }
  constructor(errorResponse) {
    super(errorResponse);
    this.name = "BackupExpiredError";
  }
  get backupId() {
    return this.context.backupId;
  }
  get expiredAt() {
    return this.context.expiredAt;
  }
};
var InvalidBackupConfigError = class extends SandboxError {
  static {
    __name(this, "InvalidBackupConfigError");
  }
  constructor(errorResponse) {
    super(errorResponse);
    this.name = "InvalidBackupConfigError";
  }
  get reason() {
    return this.context.reason;
  }
};
var BackupCreateError = class extends SandboxError {
  static {
    __name(this, "BackupCreateError");
  }
  constructor(errorResponse) {
    super(errorResponse);
    this.name = "BackupCreateError";
  }
  get dir() {
    return this.context.dir;
  }
  get backupId() {
    return this.context.backupId;
  }
};
var BackupRestoreError = class extends SandboxError {
  static {
    __name(this, "BackupRestoreError");
  }
  constructor(errorResponse) {
    super(errorResponse);
    this.name = "BackupRestoreError";
  }
  get dir() {
    return this.context.dir;
  }
  get backupId() {
    return this.context.backupId;
  }
};
var DesktopNotStartedError = class extends SandboxError {
  static {
    __name(this, "DesktopNotStartedError");
  }
  constructor(errorResponse) {
    super(errorResponse);
    this.name = "DesktopNotStartedError";
  }
};
var DesktopStartFailedError = class extends SandboxError {
  static {
    __name(this, "DesktopStartFailedError");
  }
  constructor(errorResponse) {
    super(errorResponse);
    this.name = "DesktopStartFailedError";
  }
};
var DesktopUnavailableError = class extends SandboxError {
  static {
    __name(this, "DesktopUnavailableError");
  }
  constructor(errorResponse) {
    super(errorResponse);
    this.name = "DesktopUnavailableError";
  }
};
var DesktopProcessCrashedError = class extends SandboxError {
  static {
    __name(this, "DesktopProcessCrashedError");
  }
  constructor(errorResponse) {
    super(errorResponse);
    this.name = "DesktopProcessCrashedError";
  }
};
var DesktopInvalidOptionsError = class extends SandboxError {
  static {
    __name(this, "DesktopInvalidOptionsError");
  }
  constructor(errorResponse) {
    super(errorResponse);
    this.name = "DesktopInvalidOptionsError";
  }
};
var DesktopInvalidCoordinatesError = class extends SandboxError {
  static {
    __name(this, "DesktopInvalidCoordinatesError");
  }
  constructor(errorResponse) {
    super(errorResponse);
    this.name = "DesktopInvalidCoordinatesError";
  }
};
function createErrorFromResponse(errorResponse) {
  switch (errorResponse.code) {
    case ErrorCode.FILE_NOT_FOUND:
      return new FileNotFoundError(errorResponse);
    case ErrorCode.FILE_EXISTS:
      return new FileExistsError(errorResponse);
    case ErrorCode.FILE_TOO_LARGE:
      return new FileTooLargeError(errorResponse);
    case ErrorCode.PERMISSION_DENIED:
      return new PermissionDeniedError(errorResponse);
    case ErrorCode.IS_DIRECTORY:
    case ErrorCode.NOT_DIRECTORY:
    case ErrorCode.NO_SPACE:
    case ErrorCode.TOO_MANY_FILES:
    case ErrorCode.RESOURCE_BUSY:
    case ErrorCode.READ_ONLY:
    case ErrorCode.NAME_TOO_LONG:
    case ErrorCode.TOO_MANY_LINKS:
    case ErrorCode.FILESYSTEM_ERROR:
      return new FileSystemError(errorResponse);
    case ErrorCode.COMMAND_NOT_FOUND:
      return new CommandNotFoundError(errorResponse);
    case ErrorCode.COMMAND_PERMISSION_DENIED:
    case ErrorCode.COMMAND_EXECUTION_ERROR:
    case ErrorCode.INVALID_COMMAND:
    case ErrorCode.STREAM_START_ERROR:
      return new CommandError(errorResponse);
    case ErrorCode.PROCESS_NOT_FOUND:
      return new ProcessNotFoundError(errorResponse);
    case ErrorCode.PROCESS_PERMISSION_DENIED:
    case ErrorCode.PROCESS_ERROR:
      return new ProcessError(errorResponse);
    case ErrorCode.SESSION_ALREADY_EXISTS:
      return new SessionAlreadyExistsError(errorResponse);
    case ErrorCode.SESSION_DESTROYED:
      return new SessionDestroyedError(errorResponse);
    case ErrorCode.PORT_ALREADY_EXPOSED:
      return new PortAlreadyExposedError(errorResponse);
    case ErrorCode.PORT_NOT_EXPOSED:
      return new PortNotExposedError(errorResponse);
    case ErrorCode.INVALID_PORT_NUMBER:
    case ErrorCode.INVALID_PORT:
      return new InvalidPortError(errorResponse);
    case ErrorCode.SERVICE_NOT_RESPONDING:
      return new ServiceNotRespondingError(errorResponse);
    case ErrorCode.PORT_IN_USE:
      return new PortInUseError(errorResponse);
    case ErrorCode.PORT_OPERATION_ERROR:
      return new PortError(errorResponse);
    case ErrorCode.CUSTOM_DOMAIN_REQUIRED:
      return new CustomDomainRequiredError(errorResponse);
    case ErrorCode.GIT_REPOSITORY_NOT_FOUND:
      return new GitRepositoryNotFoundError(errorResponse);
    case ErrorCode.GIT_AUTH_FAILED:
      return new GitAuthenticationError(errorResponse);
    case ErrorCode.GIT_BRANCH_NOT_FOUND:
      return new GitBranchNotFoundError(errorResponse);
    case ErrorCode.GIT_NETWORK_ERROR:
      return new GitNetworkError(errorResponse);
    case ErrorCode.GIT_CLONE_FAILED:
      return new GitCloneError(errorResponse);
    case ErrorCode.GIT_CHECKOUT_FAILED:
      return new GitCheckoutError(errorResponse);
    case ErrorCode.INVALID_GIT_URL:
      return new InvalidGitUrlError(errorResponse);
    case ErrorCode.GIT_OPERATION_FAILED:
      return new GitError(errorResponse);
    case ErrorCode.BACKUP_NOT_FOUND:
      return new BackupNotFoundError(errorResponse);
    case ErrorCode.BACKUP_EXPIRED:
      return new BackupExpiredError(errorResponse);
    case ErrorCode.INVALID_BACKUP_CONFIG:
      return new InvalidBackupConfigError(errorResponse);
    case ErrorCode.BACKUP_CREATE_FAILED:
      return new BackupCreateError(errorResponse);
    case ErrorCode.BACKUP_RESTORE_FAILED:
      return new BackupRestoreError(errorResponse);
    case ErrorCode.INTERPRETER_NOT_READY:
      return new InterpreterNotReadyError(errorResponse);
    case ErrorCode.CONTEXT_NOT_FOUND:
      return new ContextNotFoundError(errorResponse);
    case ErrorCode.CODE_EXECUTION_ERROR:
      return new CodeExecutionError(errorResponse);
    case ErrorCode.DESKTOP_NOT_STARTED:
      return new DesktopNotStartedError(errorResponse);
    case ErrorCode.DESKTOP_START_FAILED:
      return new DesktopStartFailedError(errorResponse);
    case ErrorCode.DESKTOP_UNAVAILABLE:
      return new DesktopUnavailableError(errorResponse);
    case ErrorCode.DESKTOP_PROCESS_CRASHED:
      return new DesktopProcessCrashedError(errorResponse);
    case ErrorCode.DESKTOP_INVALID_OPTIONS:
      return new DesktopInvalidOptionsError(errorResponse);
    case ErrorCode.DESKTOP_INVALID_COORDINATES:
      return new DesktopInvalidCoordinatesError(errorResponse);
    case ErrorCode.VALIDATION_FAILED:
      return new ValidationFailedError(errorResponse);
    case ErrorCode.INVALID_JSON_RESPONSE:
    case ErrorCode.UNKNOWN_ERROR:
    case ErrorCode.INTERNAL_ERROR:
      return new SandboxError(errorResponse);
    default:
      return new SandboxError(errorResponse);
  }
}
__name(createErrorFromResponse, "createErrorFromResponse");
var DEFAULT_RETRY_TIMEOUT_MS = 12e4;
var MIN_TIME_FOR_RETRY_MS = 15e3;
var BaseTransport = class {
  static {
    __name(this, "BaseTransport");
  }
  config;
  logger;
  retryTimeoutMs;
  constructor(config2) {
    this.config = config2;
    this.logger = config2.logger ?? createNoOpLogger();
    this.retryTimeoutMs = config2.retryTimeoutMs ?? DEFAULT_RETRY_TIMEOUT_MS;
  }
  setRetryTimeoutMs(ms) {
    this.retryTimeoutMs = ms;
  }
  getRetryTimeoutMs() {
    return this.retryTimeoutMs;
  }
  /**
  * Fetch with automatic retry for 503 (container starting)
  *
  * This is the primary entry point for making requests. It wraps the
  * transport-specific doFetch() with retry logic for container startup.
  */
  async fetch(path$1, options) {
    const startTime = Date.now();
    let attempt = 0;
    while (true) {
      const response = await this.doFetch(path$1, options);
      if (response.status === 503) {
        const elapsed = Date.now() - startTime;
        const remaining = this.retryTimeoutMs - elapsed;
        if (remaining > MIN_TIME_FOR_RETRY_MS) {
          const delay = Math.min(3e3 * 2 ** attempt, 3e4);
          this.logger.info("Container not ready, retrying", {
            status: response.status,
            attempt: attempt + 1,
            delayMs: delay,
            remainingSec: Math.floor(remaining / 1e3),
            mode: this.getMode()
          });
          await this.sleep(delay);
          attempt++;
          continue;
        }
        this.logger.error("Container failed to become ready", /* @__PURE__ */ new Error(`Failed after ${attempt + 1} attempts over ${Math.floor(elapsed / 1e3)}s`));
      }
      return response;
    }
  }
  /**
  * Sleep utility for retry delays
  */
  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
};
var HttpTransport = class extends BaseTransport {
  static {
    __name(this, "HttpTransport");
  }
  baseUrl;
  constructor(config2) {
    super(config2);
    this.baseUrl = config2.baseUrl ?? "http://localhost:3000";
  }
  getMode() {
    return "http";
  }
  async connect() {
  }
  disconnect() {
  }
  isConnected() {
    return true;
  }
  async doFetch(path$1, options) {
    const url = this.buildUrl(path$1);
    if (this.config.stub) return this.config.stub.containerFetch(url, options || {}, this.config.port);
    return globalThis.fetch(url, options);
  }
  async fetchStream(path$1, body, method = "POST", headers) {
    const url = this.buildUrl(path$1);
    const options = this.buildStreamOptions(body, method, headers);
    let response;
    if (this.config.stub) response = await this.config.stub.containerFetch(url, options, this.config.port);
    else response = await globalThis.fetch(url, options);
    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`HTTP error! status: ${response.status} - ${errorBody}`);
    }
    if (!response.body) throw new Error("No response body for streaming");
    return response.body;
  }
  buildUrl(path$1) {
    if (this.config.stub) return `http://localhost:${this.config.port}${path$1}`;
    return `${this.baseUrl}${path$1}`;
  }
  buildStreamOptions(body, method, headers) {
    return {
      method,
      headers: body && method === "POST" ? {
        ...headers,
        "Content-Type": "application/json"
      } : headers,
      body: body && method === "POST" ? JSON.stringify(body) : void 0
    };
  }
};
var DEFAULT_REQUEST_TIMEOUT_MS = 12e4;
var DEFAULT_STREAM_IDLE_TIMEOUT_MS = 3e5;
var DEFAULT_CONNECT_TIMEOUT_MS = 3e4;
var DEFAULT_IDLE_DISCONNECT_MS = 1e3;
var MIN_TIME_FOR_CONNECT_RETRY_MS = 15e3;
var WebSocketTransport = class extends BaseTransport {
  static {
    __name(this, "WebSocketTransport");
  }
  ws = null;
  state = "disconnected";
  pendingRequests = /* @__PURE__ */ new Map();
  connectPromise = null;
  idleDisconnectTimer = null;
  boundHandleMessage;
  boundHandleClose;
  constructor(config2) {
    super(config2);
    if (!config2.wsUrl) throw new Error("wsUrl is required for WebSocket transport");
    this.boundHandleMessage = this.handleMessage.bind(this);
    this.boundHandleClose = this.handleClose.bind(this);
  }
  getMode() {
    return "websocket";
  }
  /**
  * Check if WebSocket is connected
  */
  isConnected() {
    return this.state === "connected" && this.ws?.readyState === WebSocket.OPEN;
  }
  /**
  * Connect to the WebSocket server
  *
  * The connection promise is assigned synchronously so concurrent
  * callers share the same connection attempt.
  */
  async connect() {
    this.clearIdleDisconnectTimer();
    if (this.isConnected()) return;
    if (this.connectPromise) return this.connectPromise;
    this.connectPromise = this.doConnect();
    try {
      await this.connectPromise;
    } finally {
      this.connectPromise = null;
    }
  }
  /**
  * Disconnect from the WebSocket server
  */
  disconnect() {
    this.cleanup();
  }
  /**
  * Transport-specific fetch implementation
  * Converts WebSocket response to standard Response object.
  */
  async doFetch(path$1, options) {
    await this.connect();
    const method = options?.method || "GET";
    const body = this.parseBody(options?.body);
    const headers = this.normalizeHeaders(options?.headers);
    const result = await this.request(method, path$1, body, headers);
    return new Response(JSON.stringify(result.body), {
      status: result.status,
      headers: { "Content-Type": "application/json" }
    });
  }
  /**
  * Streaming fetch implementation
  */
  async fetchStream(path$1, body, method = "POST", headers) {
    return this.requestStream(method, path$1, body, headers);
  }
  /**
  * Parse request body from RequestInit
  */
  parseBody(body) {
    if (!body) return;
    if (typeof body === "string") try {
      return JSON.parse(body);
    } catch (error3) {
      throw new Error(`Request body must be valid JSON: ${error3 instanceof Error ? error3.message : String(error3)}`);
    }
    throw new Error(`WebSocket transport only supports string bodies. Got: ${typeof body}`);
  }
  /**
  * Normalize RequestInit headers into a plain object for WSRequest.
  */
  normalizeHeaders(headers) {
    if (!headers) return;
    const normalized = {};
    new Headers(headers).forEach((value, key) => {
      normalized[key] = value;
    });
    return Object.keys(normalized).length > 0 ? normalized : void 0;
  }
  /**
  * Internal connection logic
  */
  async doConnect() {
    this.state = "connecting";
    if (this.config.stub) await this.connectViaFetch();
    else await this.connectViaWebSocket();
  }
  async fetchUpgradeWithRetry(attemptUpgrade) {
    const retryTimeoutMs = this.getRetryTimeoutMs();
    const startTime = Date.now();
    let attempt = 0;
    while (true) {
      const response = await attemptUpgrade();
      if (response.status !== 503) return response;
      const remaining = retryTimeoutMs - (Date.now() - startTime);
      if (remaining <= MIN_TIME_FOR_CONNECT_RETRY_MS) return response;
      const delay = Math.min(3e3 * 2 ** attempt, 3e4);
      this.logger.info("WebSocket container not ready, retrying", {
        status: response.status,
        attempt: attempt + 1,
        delayMs: delay,
        remainingSec: Math.floor(remaining / 1e3)
      });
      await this.sleep(delay);
      attempt++;
    }
  }
  /**
  * Connect using fetch-based WebSocket (Cloudflare Workers style)
  * This is required when running inside a Durable Object.
  *
  * Uses stub.fetch() which routes WebSocket upgrade requests through the
  * parent Container class that supports the WebSocket protocol.
  */
  async connectViaFetch() {
    const timeoutMs = this.config.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
    try {
      const wsPath = new URL(this.config.wsUrl).pathname;
      const httpUrl = `http://localhost:${this.config.port || 3e3}${wsPath}`;
      const response = await this.fetchUpgradeWithRetry(() => this.fetchUpgradeAttempt(httpUrl, timeoutMs));
      if (response.status !== 101) throw new Error(`WebSocket upgrade failed: ${response.status} ${response.statusText}`);
      const ws = response.webSocket;
      if (!ws) throw new Error("No WebSocket in upgrade response");
      ws.accept();
      this.ws = ws;
      this.state = "connected";
      this.ws.addEventListener("close", this.boundHandleClose);
      this.ws.addEventListener("message", this.boundHandleMessage);
      this.logger.debug("WebSocket connected via fetch", { url: this.config.wsUrl });
    } catch (error3) {
      this.state = "error";
      this.logger.error("WebSocket fetch connection failed", error3 instanceof Error ? error3 : new Error(String(error3)));
      throw error3;
    }
  }
  async fetchUpgradeAttempt(httpUrl, timeoutMs) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const request = new Request(httpUrl, {
        headers: {
          Upgrade: "websocket",
          Connection: "Upgrade"
        },
        signal: controller.signal
      });
      return await this.config.stub.fetch(request);
    } finally {
      clearTimeout(timeout);
    }
  }
  /**
  * Connect using standard WebSocket API (browser/Node style)
  */
  connectViaWebSocket() {
    return new Promise((resolve, reject) => {
      const timeoutMs = this.config.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
      const timeout = setTimeout(() => {
        this.cleanup();
        reject(/* @__PURE__ */ new Error(`WebSocket connection timeout after ${timeoutMs}ms`));
      }, timeoutMs);
      try {
        this.ws = new WebSocket(this.config.wsUrl);
        const onOpen = /* @__PURE__ */ __name(() => {
          clearTimeout(timeout);
          this.ws?.removeEventListener("open", onOpen);
          this.ws?.removeEventListener("error", onConnectError);
          this.state = "connected";
          this.logger.debug("WebSocket connected", { url: this.config.wsUrl });
          resolve();
        }, "onOpen");
        const onConnectError = /* @__PURE__ */ __name(() => {
          clearTimeout(timeout);
          this.ws?.removeEventListener("open", onOpen);
          this.ws?.removeEventListener("error", onConnectError);
          this.state = "error";
          this.logger.error("WebSocket error", /* @__PURE__ */ new Error("WebSocket connection failed"));
          reject(/* @__PURE__ */ new Error("WebSocket connection failed"));
        }, "onConnectError");
        this.ws.addEventListener("open", onOpen);
        this.ws.addEventListener("error", onConnectError);
        this.ws.addEventListener("close", this.boundHandleClose);
        this.ws.addEventListener("message", this.boundHandleMessage);
      } catch (error3) {
        clearTimeout(timeout);
        this.state = "error";
        reject(error3);
      }
    });
  }
  /**
  * Send a request and wait for response
  */
  async request(method, path$1, body, headers) {
    await this.connect();
    this.clearIdleDisconnectTimer();
    const id = generateRequestId();
    const request = {
      type: "request",
      id,
      method,
      path: path$1,
      body,
      headers
    };
    return new Promise((resolve, reject) => {
      const timeoutMs = this.config.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
      const timeoutId = setTimeout(() => {
        this.pendingRequests.delete(id);
        this.scheduleIdleDisconnect();
        reject(/* @__PURE__ */ new Error(`Request timeout after ${timeoutMs}ms: ${method} ${path$1}`));
      }, timeoutMs);
      this.pendingRequests.set(id, {
        resolve: /* @__PURE__ */ __name((response) => {
          clearTimeout(timeoutId);
          this.pendingRequests.delete(id);
          this.scheduleIdleDisconnect();
          resolve({
            status: response.status,
            body: response.body
          });
        }, "resolve"),
        reject: /* @__PURE__ */ __name((error3) => {
          clearTimeout(timeoutId);
          this.pendingRequests.delete(id);
          this.scheduleIdleDisconnect();
          reject(error3);
        }, "reject"),
        isStreaming: false,
        timeoutId
      });
      try {
        this.send(request);
      } catch (error3) {
        clearTimeout(timeoutId);
        this.pendingRequests.delete(id);
        this.scheduleIdleDisconnect();
        reject(error3 instanceof Error ? error3 : new Error(String(error3)));
      }
    });
  }
  /**
  * Send a streaming request and return a ReadableStream
  *
  * The stream will receive data chunks as they arrive over the WebSocket.
  * Format matches SSE for compatibility with existing streaming code.
  *
  * This method waits for the first message before returning. If the server
  * responds with an error (non-streaming response), it throws immediately
  * rather than returning a stream that will error later.
  *
  * Uses an inactivity timeout instead of a total-duration timeout so that
  * long-running streams (e.g. execStream from an agent) stay alive as long
  * as data is flowing. The timer resets on every chunk or response message.
  */
  async requestStream(method, path$1, body, headers) {
    await this.connect();
    this.clearIdleDisconnectTimer();
    const id = generateRequestId();
    const request = {
      type: "request",
      id,
      method,
      path: path$1,
      body,
      headers
    };
    const idleTimeoutMs = this.config.streamIdleTimeoutMs ?? DEFAULT_STREAM_IDLE_TIMEOUT_MS;
    return new Promise((resolveStream, rejectStream) => {
      let streamController;
      let firstMessageReceived = false;
      const createIdleTimeout = /* @__PURE__ */ __name(() => {
        return setTimeout(() => {
          this.pendingRequests.delete(id);
          this.scheduleIdleDisconnect();
          const error3 = /* @__PURE__ */ new Error(`Stream idle timeout after ${idleTimeoutMs}ms: ${method} ${path$1}`);
          if (firstMessageReceived) try {
            streamController?.error(error3);
          } catch {
          }
          else rejectStream(error3);
        }, idleTimeoutMs);
      }, "createIdleTimeout");
      const timeoutId = createIdleTimeout();
      const stream = new ReadableStream({
        start: /* @__PURE__ */ __name((controller) => {
          streamController = controller;
        }, "start"),
        cancel: /* @__PURE__ */ __name(() => {
          const pending = this.pendingRequests.get(id);
          if (pending?.timeoutId) clearTimeout(pending.timeoutId);
          try {
            this.send({
              type: "cancel",
              id
            });
          } catch (error3) {
            this.logger.debug("Failed to send stream cancel message", {
              id,
              error: error3 instanceof Error ? error3.message : String(error3)
            });
          }
          this.pendingRequests.delete(id);
          this.scheduleIdleDisconnect();
        }, "cancel")
      });
      this.pendingRequests.set(id, {
        resolve: /* @__PURE__ */ __name((response) => {
          const pending = this.pendingRequests.get(id);
          if (pending?.timeoutId) clearTimeout(pending.timeoutId);
          this.pendingRequests.delete(id);
          this.scheduleIdleDisconnect();
          if (!firstMessageReceived) {
            firstMessageReceived = true;
            if (response.status >= 400) rejectStream(/* @__PURE__ */ new Error(`Stream error: ${response.status} - ${JSON.stringify(response.body)}`));
            else {
              streamController?.close();
              resolveStream(stream);
            }
          } else if (response.status >= 400) try {
            streamController?.error(/* @__PURE__ */ new Error(`Stream error: ${response.status} - ${JSON.stringify(response.body)}`));
          } catch {
          }
          else streamController?.close();
        }, "resolve"),
        reject: /* @__PURE__ */ __name((error3) => {
          const pending = this.pendingRequests.get(id);
          if (pending?.timeoutId) clearTimeout(pending.timeoutId);
          this.pendingRequests.delete(id);
          this.scheduleIdleDisconnect();
          if (firstMessageReceived) try {
            streamController?.error(error3);
          } catch {
          }
          else rejectStream(error3);
        }, "reject"),
        streamController: void 0,
        isStreaming: true,
        timeoutId,
        onFirstChunk: /* @__PURE__ */ __name(() => {
          if (!firstMessageReceived) {
            firstMessageReceived = true;
            const pending = this.pendingRequests.get(id);
            if (pending) {
              pending.streamController = streamController;
              if (pending.bufferedChunks) {
                try {
                  for (const buffered of pending.bufferedChunks) streamController.enqueue(buffered);
                } catch (error3) {
                  this.logger.debug("Failed to flush buffered chunks, cleaning up", {
                    id,
                    error: error3 instanceof Error ? error3.message : String(error3)
                  });
                  if (pending.timeoutId) clearTimeout(pending.timeoutId);
                  this.pendingRequests.delete(id);
                  this.scheduleIdleDisconnect();
                }
                pending.bufferedChunks = void 0;
              }
            }
            resolveStream(stream);
          }
        }, "onFirstChunk")
      });
      try {
        this.send(request);
      } catch (error3) {
        clearTimeout(timeoutId);
        this.pendingRequests.delete(id);
        this.scheduleIdleDisconnect();
        rejectStream(error3 instanceof Error ? error3 : new Error(String(error3)));
      }
    });
  }
  /**
  * Send a message over the WebSocket
  */
  send(message) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) throw new Error("WebSocket not connected");
    this.ws.send(JSON.stringify(message));
    this.logger.debug("WebSocket sent", {
      id: message.id,
      type: message.type,
      method: message.type === "request" ? message.method : void 0,
      path: message.type === "request" ? message.path : void 0
    });
  }
  /**
  * Handle incoming WebSocket messages
  */
  handleMessage(event) {
    try {
      const message = JSON.parse(event.data);
      if (isWSResponse(message)) this.handleResponse(message);
      else if (isWSStreamChunk(message)) this.handleStreamChunk(message);
      else if (isWSError(message)) this.handleError(message);
      else this.logger.warn("Unknown WebSocket message type", { message });
    } catch (error3) {
      this.logger.error("Failed to parse WebSocket message", error3 instanceof Error ? error3 : new Error(String(error3)));
    }
  }
  /**
  * Handle a response message
  */
  handleResponse(response) {
    const pending = this.pendingRequests.get(response.id);
    if (!pending) {
      this.logger.warn("Received response for unknown request", { id: response.id });
      return;
    }
    this.logger.debug("WebSocket response", {
      id: response.id,
      status: response.status,
      done: response.done
    });
    if (response.done) pending.resolve(response);
  }
  /**
  * Handle a stream chunk message
  *
  * Resets the idle timeout on every chunk so that long-running streams
  * with continuous output are not killed by the inactivity timer.
  */
  handleStreamChunk(chunk) {
    const pending = this.pendingRequests.get(chunk.id);
    if (!pending) {
      this.logger.warn("Received stream chunk for unknown request", { id: chunk.id });
      return;
    }
    if (pending.onFirstChunk) {
      pending.onFirstChunk();
      pending.onFirstChunk = void 0;
    }
    if (pending.isStreaming) this.resetStreamIdleTimeout(chunk.id, pending);
    if (!pending.streamController) {
      if (!pending.bufferedChunks) pending.bufferedChunks = [];
      const encoder$1 = new TextEncoder();
      let sseData$1;
      if (chunk.event) sseData$1 = `event: ${chunk.event}
data: ${chunk.data}

`;
      else sseData$1 = `data: ${chunk.data}

`;
      pending.bufferedChunks.push(encoder$1.encode(sseData$1));
      return;
    }
    const encoder2 = new TextEncoder();
    let sseData;
    if (chunk.event) sseData = `event: ${chunk.event}
data: ${chunk.data}

`;
    else sseData = `data: ${chunk.data}

`;
    try {
      pending.streamController.enqueue(encoder2.encode(sseData));
    } catch (error3) {
      this.logger.debug("Failed to enqueue stream chunk, cleaning up", {
        id: chunk.id,
        error: error3 instanceof Error ? error3.message : String(error3)
      });
      if (pending.timeoutId) clearTimeout(pending.timeoutId);
      this.pendingRequests.delete(chunk.id);
      this.scheduleIdleDisconnect();
    }
  }
  /**
  * Reset the idle timeout for a streaming request.
  * Called on every incoming chunk to keep the stream alive while data flows.
  */
  resetStreamIdleTimeout(id, pending) {
    if (pending.timeoutId) clearTimeout(pending.timeoutId);
    const idleTimeoutMs = this.config.streamIdleTimeoutMs ?? DEFAULT_STREAM_IDLE_TIMEOUT_MS;
    pending.timeoutId = setTimeout(() => {
      this.pendingRequests.delete(id);
      this.scheduleIdleDisconnect();
      if (pending.streamController) try {
        pending.streamController.error(/* @__PURE__ */ new Error(`Stream idle timeout after ${idleTimeoutMs}ms`));
      } catch {
      }
    }, idleTimeoutMs);
  }
  /**
  * Handle an error message
  */
  handleError(error3) {
    if (error3.id) {
      const pending = this.pendingRequests.get(error3.id);
      if (pending) {
        pending.reject(/* @__PURE__ */ new Error(`${error3.code}: ${error3.message}`));
        return;
      }
    }
    this.logger.error("WebSocket error message", new Error(error3.message), {
      code: error3.code,
      status: error3.status
    });
  }
  /**
  * Handle WebSocket close
  */
  handleClose(event) {
    this.state = "disconnected";
    this.ws = null;
    this.connectPromise = null;
    const closeError = /* @__PURE__ */ new Error(`WebSocket closed: ${event.code} ${event.reason || "No reason"}`);
    for (const [, pending] of this.pendingRequests) {
      if (pending.timeoutId) clearTimeout(pending.timeoutId);
      if (pending.streamController) try {
        pending.streamController.error(closeError);
      } catch {
      }
      pending.reject(closeError);
    }
    this.pendingRequests.clear();
  }
  /**
  * Cleanup resources
  */
  cleanup() {
    this.clearIdleDisconnectTimer();
    if (this.ws) {
      this.ws.removeEventListener("close", this.boundHandleClose);
      this.ws.removeEventListener("message", this.boundHandleMessage);
      this.ws.close();
      this.ws = null;
    }
    this.state = "disconnected";
    this.connectPromise = null;
    for (const pending of this.pendingRequests.values()) if (pending.timeoutId) clearTimeout(pending.timeoutId);
    this.pendingRequests.clear();
  }
  scheduleIdleDisconnect() {
    if (!this.isConnected() || this.pendingRequests.size > 0) return;
    this.clearIdleDisconnectTimer();
    this.idleDisconnectTimer = setTimeout(() => {
      this.idleDisconnectTimer = null;
      if (this.pendingRequests.size === 0 && this.isConnected()) {
        this.logger.debug("Disconnecting idle WebSocket transport");
        this.cleanup();
      }
    }, DEFAULT_IDLE_DISCONNECT_MS);
  }
  clearIdleDisconnectTimer() {
    if (this.idleDisconnectTimer) {
      clearTimeout(this.idleDisconnectTimer);
      this.idleDisconnectTimer = null;
    }
  }
};
function createTransport(options) {
  switch (options.mode) {
    case "websocket":
      return new WebSocketTransport(options);
    default:
      return new HttpTransport(options);
  }
}
__name(createTransport, "createTransport");
var BaseHttpClient = class {
  static {
    __name(this, "BaseHttpClient");
  }
  options;
  logger;
  transport;
  constructor(options = {}) {
    this.options = options;
    this.logger = options.logger ?? createNoOpLogger();
    if (options.transport) this.transport = options.transport;
    else this.transport = createTransport({
      mode: options.transportMode ?? "http",
      baseUrl: options.baseUrl ?? "http://localhost:3000",
      wsUrl: options.wsUrl,
      logger: this.logger,
      stub: options.stub,
      port: options.port,
      retryTimeoutMs: options.retryTimeoutMs
    });
  }
  /**
  * Update the transport's 503 retry budget
  */
  setRetryTimeoutMs(ms) {
    this.transport.setRetryTimeoutMs(ms);
  }
  /**
  * Check if using WebSocket transport
  */
  isWebSocketMode() {
    return this.transport.getMode() === "websocket";
  }
  /**
  * Core fetch method - delegates to Transport which handles retry logic
  */
  async doFetch(path$1, options) {
    const { defaultHeaders } = this.options;
    if (defaultHeaders) options = {
      ...options,
      headers: {
        ...defaultHeaders,
        ...options?.headers
      }
    };
    return this.transport.fetch(path$1, options);
  }
  /**
  * Make a POST request with JSON body
  */
  async post(endpoint, data, responseHandler) {
    const response = await this.doFetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data)
    });
    return this.handleResponse(response, responseHandler);
  }
  /**
  * Make a GET request
  */
  async get(endpoint, responseHandler) {
    const response = await this.doFetch(endpoint, { method: "GET" });
    return this.handleResponse(response, responseHandler);
  }
  /**
  * Make a DELETE request
  */
  async delete(endpoint, responseHandler) {
    const response = await this.doFetch(endpoint, { method: "DELETE" });
    return this.handleResponse(response, responseHandler);
  }
  /**
  * Handle HTTP response with error checking and parsing
  */
  async handleResponse(response, customHandler) {
    if (!response.ok) await this.handleErrorResponse(response);
    if (customHandler) return customHandler(response);
    try {
      return await response.json();
    } catch (error3) {
      throw createErrorFromResponse({
        code: ErrorCode.INVALID_JSON_RESPONSE,
        message: `Invalid JSON response: ${error3 instanceof Error ? error3.message : "Unknown parsing error"}`,
        context: {},
        httpStatus: response.status,
        timestamp: (/* @__PURE__ */ new Date()).toISOString()
      });
    }
  }
  /**
  * Handle error responses with consistent error throwing
  */
  async handleErrorResponse(response) {
    let errorData;
    try {
      errorData = await response.json();
    } catch {
      errorData = {
        code: ErrorCode.INTERNAL_ERROR,
        message: `HTTP error! status: ${response.status}`,
        context: { statusText: response.statusText },
        httpStatus: response.status,
        timestamp: (/* @__PURE__ */ new Date()).toISOString()
      };
    }
    const error3 = createErrorFromResponse(errorData);
    this.options.onError?.(errorData.message, void 0);
    throw error3;
  }
  /**
  * Create a streaming response handler for Server-Sent Events
  */
  async handleStreamResponse(response) {
    if (!response.ok) await this.handleErrorResponse(response);
    if (!response.body) throw new Error("No response body for streaming");
    return response.body;
  }
  /**
  * Stream request handler
  *
  * For HTTP mode, uses doFetch + handleStreamResponse to get proper error typing.
  * For WebSocket mode, uses Transport's streaming support.
  *
  * @param path - The API path to call
  * @param body - Optional request body (for POST requests)
  * @param method - HTTP method (default: POST, use GET for process logs)
  */
  async doStreamFetch(path$1, body, method = "POST") {
    const streamHeaders = method === "POST" ? {
      ...this.options.defaultHeaders,
      "Content-Type": "application/json"
    } : this.options.defaultHeaders;
    if (this.transport.getMode() === "websocket") return this.transport.fetchStream(path$1, body, method, streamHeaders);
    const response = await this.doFetch(path$1, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body && method === "POST" ? JSON.stringify(body) : void 0
    });
    return this.handleStreamResponse(response);
  }
};
var BackupClient = class extends BaseHttpClient {
  static {
    __name(this, "BackupClient");
  }
  /**
  * Tell the container to create a squashfs archive from a directory.
  * @param dir - Directory to back up
  * @param archivePath - Where the container should write the archive
  * @param sessionId - Session context
  */
  async createArchive(dir3, archivePath, sessionId, gitignore = false, excludes = []) {
    try {
      const data = {
        dir: dir3,
        archivePath,
        gitignore,
        excludes,
        sessionId
      };
      return await this.post("/api/backup/create", data);
    } catch (error3) {
      throw error3;
    }
  }
  /**
  * Tell the container to restore a squashfs archive into a directory.
  * @param dir - Target directory
  * @param archivePath - Path to the archive file in the container
  * @param sessionId - Session context
  */
  async restoreArchive(dir3, archivePath, sessionId) {
    try {
      const data = {
        dir: dir3,
        archivePath,
        sessionId
      };
      return await this.post("/api/backup/restore", data);
    } catch (error3) {
      throw error3;
    }
  }
};
var CommandClient = class extends BaseHttpClient {
  static {
    __name(this, "CommandClient");
  }
  /**
  * Execute a command and return the complete result
  * @param command - The command to execute
  * @param sessionId - The session ID for this command execution
  * @param timeoutMs - Optional timeout in milliseconds (unlimited by default)
  * @param env - Optional environment variables for this command
  * @param cwd - Optional working directory for this command
  */
  async execute(command, sessionId, options) {
    try {
      const data = {
        command,
        sessionId,
        ...options?.timeoutMs !== void 0 && { timeoutMs: options.timeoutMs },
        ...options?.env !== void 0 && { env: options.env },
        ...options?.cwd !== void 0 && { cwd: options.cwd },
        ...options?.origin !== void 0 && { origin: options.origin }
      };
      const response = await this.post("/api/execute", data);
      this.options.onCommandComplete?.(response.success, response.exitCode, response.stdout, response.stderr, response.command);
      return response;
    } catch (error3) {
      this.options.onError?.(error3 instanceof Error ? error3.message : String(error3), command);
      throw error3;
    }
  }
  /**
  * Execute a command and return a stream of events
  * @param command - The command to execute
  * @param sessionId - The session ID for this command execution
  * @param options - Optional per-command execution settings
  */
  async executeStream(command, sessionId, options) {
    try {
      const data = {
        command,
        sessionId,
        ...options?.timeoutMs !== void 0 && { timeoutMs: options.timeoutMs },
        ...options?.env !== void 0 && { env: options.env },
        ...options?.cwd !== void 0 && { cwd: options.cwd },
        ...options?.origin !== void 0 && { origin: options.origin }
      };
      return await this.doStreamFetch("/api/execute/stream", data);
    } catch (error3) {
      this.options.onError?.(error3 instanceof Error ? error3.message : String(error3), command);
      throw error3;
    }
  }
};
var DesktopClient = class extends BaseHttpClient {
  static {
    __name(this, "DesktopClient");
  }
  /**
  * Start the desktop environment with optional resolution and DPI.
  */
  async start(options) {
    try {
      const data = {
        ...options?.resolution !== void 0 && { resolution: options.resolution },
        ...options?.dpi !== void 0 && { dpi: options.dpi }
      };
      return await this.post("/api/desktop/start", data);
    } catch (error3) {
      this.options.onError?.(error3 instanceof Error ? error3.message : String(error3));
      throw error3;
    }
  }
  /**
  * Stop the desktop environment and all related processes.
  */
  async stop() {
    try {
      return await this.post("/api/desktop/stop", {});
    } catch (error3) {
      this.options.onError?.(error3 instanceof Error ? error3.message : String(error3));
      throw error3;
    }
  }
  /**
  * Get desktop lifecycle and process health status.
  */
  async status() {
    try {
      return await this.get("/api/desktop/status");
    } catch (error3) {
      throw error3;
    }
  }
  async screenshot(options) {
    try {
      const wantsBytes = options?.format === "bytes";
      const data = {
        format: "base64",
        ...options?.imageFormat !== void 0 && { imageFormat: options.imageFormat },
        ...options?.quality !== void 0 && { quality: options.quality },
        ...options?.showCursor !== void 0 && { showCursor: options.showCursor }
      };
      const response = await this.post("/api/desktop/screenshot", data);
      if (wantsBytes) {
        const binaryString = atob(response.data);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
        return {
          ...response,
          data: bytes
        };
      }
      return response;
    } catch (error3) {
      throw error3;
    }
  }
  async screenshotRegion(region, options) {
    try {
      const wantsBytes = options?.format === "bytes";
      const data = {
        region,
        format: "base64",
        ...options?.imageFormat !== void 0 && { imageFormat: options.imageFormat },
        ...options?.quality !== void 0 && { quality: options.quality },
        ...options?.showCursor !== void 0 && { showCursor: options.showCursor }
      };
      const response = await this.post("/api/desktop/screenshot/region", data);
      if (wantsBytes) {
        const binaryString = atob(response.data);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
        return {
          ...response,
          data: bytes
        };
      }
      return response;
    } catch (error3) {
      throw error3;
    }
  }
  /**
  * Single-click at the given coordinates.
  */
  async click(x, y, options) {
    try {
      await this.post("/api/desktop/mouse/click", {
        x,
        y,
        button: options?.button ?? "left",
        clickCount: 1
      });
    } catch (error3) {
      throw error3;
    }
  }
  /**
  * Double-click at the given coordinates.
  */
  async doubleClick(x, y, options) {
    try {
      await this.post("/api/desktop/mouse/click", {
        x,
        y,
        button: options?.button ?? "left",
        clickCount: 2
      });
    } catch (error3) {
      throw error3;
    }
  }
  /**
  * Triple-click at the given coordinates.
  */
  async tripleClick(x, y, options) {
    try {
      await this.post("/api/desktop/mouse/click", {
        x,
        y,
        button: options?.button ?? "left",
        clickCount: 3
      });
    } catch (error3) {
      throw error3;
    }
  }
  /**
  * Right-click at the given coordinates.
  */
  async rightClick(x, y) {
    try {
      await this.post("/api/desktop/mouse/click", {
        x,
        y,
        button: "right",
        clickCount: 1
      });
    } catch (error3) {
      throw error3;
    }
  }
  /**
  * Middle-click at the given coordinates.
  */
  async middleClick(x, y) {
    try {
      await this.post("/api/desktop/mouse/click", {
        x,
        y,
        button: "middle",
        clickCount: 1
      });
    } catch (error3) {
      throw error3;
    }
  }
  /**
  * Press and hold a mouse button.
  */
  async mouseDown(x, y, options) {
    try {
      await this.post("/api/desktop/mouse/down", {
        ...x !== void 0 && { x },
        ...y !== void 0 && { y },
        button: options?.button ?? "left"
      });
    } catch (error3) {
      throw error3;
    }
  }
  /**
  * Release a held mouse button.
  */
  async mouseUp(x, y, options) {
    try {
      await this.post("/api/desktop/mouse/up", {
        ...x !== void 0 && { x },
        ...y !== void 0 && { y },
        button: options?.button ?? "left"
      });
    } catch (error3) {
      throw error3;
    }
  }
  /**
  * Move the mouse cursor to coordinates.
  */
  async moveMouse(x, y) {
    try {
      await this.post("/api/desktop/mouse/move", {
        x,
        y
      });
    } catch (error3) {
      throw error3;
    }
  }
  /**
  * Drag from start coordinates to end coordinates.
  */
  async drag(startX, startY, endX, endY, options) {
    try {
      await this.post("/api/desktop/mouse/drag", {
        startX,
        startY,
        endX,
        endY,
        button: options?.button ?? "left"
      });
    } catch (error3) {
      throw error3;
    }
  }
  /**
  * Scroll at coordinates in the specified direction.
  */
  async scroll(x, y, direction, amount = 3) {
    try {
      await this.post("/api/desktop/mouse/scroll", {
        x,
        y,
        direction,
        amount
      });
    } catch (error3) {
      throw error3;
    }
  }
  /**
  * Get the current cursor coordinates.
  */
  async getCursorPosition() {
    try {
      return await this.get("/api/desktop/mouse/position");
    } catch (error3) {
      throw error3;
    }
  }
  /**
  * Type text into the focused element.
  */
  async type(text, options) {
    try {
      await this.post("/api/desktop/keyboard/type", {
        text,
        ...options?.delayMs !== void 0 && { delayMs: options.delayMs }
      });
    } catch (error3) {
      throw error3;
    }
  }
  /**
  * Press and release a key or key combination.
  */
  async press(key) {
    try {
      await this.post("/api/desktop/keyboard/press", { key });
    } catch (error3) {
      throw error3;
    }
  }
  /**
  * Press and hold a key.
  */
  async keyDown(key) {
    try {
      await this.post("/api/desktop/keyboard/down", { key });
    } catch (error3) {
      throw error3;
    }
  }
  /**
  * Release a held key.
  */
  async keyUp(key) {
    try {
      await this.post("/api/desktop/keyboard/up", { key });
    } catch (error3) {
      throw error3;
    }
  }
  /**
  * Get the active desktop screen size.
  */
  async getScreenSize() {
    try {
      return await this.get("/api/desktop/screen/size");
    } catch (error3) {
      throw error3;
    }
  }
  /**
  * Get health status for a specific desktop process.
  */
  async getProcessStatus(name) {
    try {
      return await this.get(`/api/desktop/process/${encodeURIComponent(name)}/status`);
    } catch (error3) {
      throw error3;
    }
  }
};
var FileClient = class extends BaseHttpClient {
  static {
    __name(this, "FileClient");
  }
  /**
  * Create a directory
  * @param path - Directory path to create
  * @param sessionId - The session ID for this operation
  * @param options - Optional settings (recursive)
  */
  async mkdir(path$1, sessionId, options) {
    try {
      const data = {
        path: path$1,
        sessionId,
        recursive: options?.recursive ?? false
      };
      return await this.post("/api/mkdir", data);
    } catch (error3) {
      throw error3;
    }
  }
  /**
  * Write content to a file
  * @param path - File path to write to
  * @param content - Content to write
  * @param sessionId - The session ID for this operation
  * @param options - Optional settings (encoding)
  */
  async writeFile(path$1, content, sessionId, options) {
    try {
      const data = {
        path: path$1,
        content,
        sessionId,
        encoding: options?.encoding
      };
      return await this.post("/api/write", data);
    } catch (error3) {
      throw error3;
    }
  }
  /**
  * Read content from a file
  * @param path - File path to read from
  * @param sessionId - The session ID for this operation
  * @param options - Optional settings (encoding)
  */
  async readFile(path$1, sessionId, options) {
    try {
      const data = {
        path: path$1,
        sessionId,
        encoding: options?.encoding
      };
      return await this.post("/api/read", data);
    } catch (error3) {
      throw error3;
    }
  }
  /**
  * Stream a file using Server-Sent Events
  * Returns a ReadableStream of SSE events containing metadata, chunks, and completion
  * @param path - File path to stream
  * @param sessionId - The session ID for this operation
  */
  async readFileStream(path$1, sessionId) {
    try {
      const data = {
        path: path$1,
        sessionId
      };
      return await this.doStreamFetch("/api/read/stream", data);
    } catch (error3) {
      throw error3;
    }
  }
  /**
  * Delete a file
  * @param path - File path to delete
  * @param sessionId - The session ID for this operation
  */
  async deleteFile(path$1, sessionId) {
    try {
      const data = {
        path: path$1,
        sessionId
      };
      return await this.post("/api/delete", data);
    } catch (error3) {
      throw error3;
    }
  }
  /**
  * Rename a file
  * @param path - Current file path
  * @param newPath - New file path
  * @param sessionId - The session ID for this operation
  */
  async renameFile(path$1, newPath, sessionId) {
    try {
      const data = {
        oldPath: path$1,
        newPath,
        sessionId
      };
      return await this.post("/api/rename", data);
    } catch (error3) {
      throw error3;
    }
  }
  /**
  * Move a file
  * @param path - Current file path
  * @param newPath - Destination file path
  * @param sessionId - The session ID for this operation
  */
  async moveFile(path$1, newPath, sessionId) {
    try {
      const data = {
        sourcePath: path$1,
        destinationPath: newPath,
        sessionId
      };
      return await this.post("/api/move", data);
    } catch (error3) {
      throw error3;
    }
  }
  /**
  * List files in a directory
  * @param path - Directory path to list
  * @param sessionId - The session ID for this operation
  * @param options - Optional settings (recursive, includeHidden)
  */
  async listFiles(path$1, sessionId, options) {
    try {
      const data = {
        path: path$1,
        sessionId,
        options: options || {}
      };
      return await this.post("/api/list-files", data);
    } catch (error3) {
      throw error3;
    }
  }
  /**
  * Check if a file or directory exists
  * @param path - Path to check
  * @param sessionId - The session ID for this operation
  */
  async exists(path$1, sessionId) {
    try {
      const data = {
        path: path$1,
        sessionId
      };
      return await this.post("/api/exists", data);
    } catch (error3) {
      throw error3;
    }
  }
};
var GitClient = class extends BaseHttpClient {
  static {
    __name(this, "GitClient");
  }
  constructor(options = {}) {
    super(options);
    this.logger = new GitLogger(this.logger);
  }
  /**
  * Clone a Git repository
  * @param repoUrl - URL of the Git repository to clone
  * @param sessionId - The session ID for this operation
  * @param options - Optional settings (branch, targetDir, depth)
  */
  async checkout(repoUrl, sessionId, options) {
    try {
      let targetDir = options?.targetDir;
      if (!targetDir) targetDir = `/workspace/${extractRepoName(repoUrl)}`;
      const data = {
        repoUrl,
        sessionId,
        targetDir
      };
      if (options?.branch) data.branch = options.branch;
      if (options?.depth !== void 0) {
        if (!Number.isInteger(options.depth) || options.depth <= 0) throw new Error(`Invalid depth value: ${options.depth}. Must be a positive integer (e.g., 1, 5, 10).`);
        data.depth = options.depth;
      }
      return await this.post("/api/git/checkout", data);
    } catch (error3) {
      throw error3;
    }
  }
};
var InterpreterClient = class extends BaseHttpClient {
  static {
    __name(this, "InterpreterClient");
  }
  maxRetries = 3;
  retryDelayMs = 1e3;
  async createCodeContext(options = {}) {
    return this.executeWithRetry(async () => {
      const response = await this.doFetch("/api/contexts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          language: options.language || "python",
          cwd: options.cwd || "/workspace",
          env_vars: options.envVars
        })
      });
      if (!response.ok) throw await this.parseErrorResponse(response);
      const data = await response.json();
      if (!data.success) throw new Error(`Failed to create context: ${JSON.stringify(data)}`);
      return {
        id: data.contextId,
        language: data.language,
        cwd: data.cwd || "/workspace",
        createdAt: new Date(data.timestamp),
        lastUsed: new Date(data.timestamp)
      };
    });
  }
  async runCodeStream(contextId, code, language, callbacks, timeoutMs) {
    return this.executeWithRetry(async () => {
      const stream = await this.doStreamFetch("/api/execute/code", {
        context_id: contextId,
        code,
        language,
        ...timeoutMs !== void 0 && { timeout_ms: timeoutMs }
      });
      for await (const chunk of this.readLines(stream)) await this.parseExecutionResult(chunk, callbacks);
    });
  }
  async listCodeContexts() {
    return this.executeWithRetry(async () => {
      const response = await this.doFetch("/api/contexts", {
        method: "GET",
        headers: { "Content-Type": "application/json" }
      });
      if (!response.ok) throw await this.parseErrorResponse(response);
      const data = await response.json();
      if (!data.success) throw new Error(`Failed to list contexts: ${JSON.stringify(data)}`);
      return data.contexts.map((ctx) => ({
        id: ctx.id,
        language: ctx.language,
        cwd: ctx.cwd || "/workspace",
        createdAt: new Date(data.timestamp),
        lastUsed: new Date(data.timestamp)
      }));
    });
  }
  async deleteCodeContext(contextId) {
    return this.executeWithRetry(async () => {
      const response = await this.doFetch(`/api/contexts/${contextId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" }
      });
      if (!response.ok) throw await this.parseErrorResponse(response);
    });
  }
  /**
  * Get a raw stream for code execution.
  * Used by CodeInterpreter.runCodeStreaming() for direct stream access.
  */
  async streamCode(contextId, code, language) {
    return this.doStreamFetch("/api/execute/code", {
      context_id: contextId,
      code,
      language
    });
  }
  /**
  * Execute an operation with automatic retry for transient errors
  */
  async executeWithRetry(operation) {
    let lastError;
    for (let attempt = 0; attempt < this.maxRetries; attempt++) try {
      return await operation();
    } catch (error3) {
      lastError = error3;
      if (this.isRetryableError(error3)) {
        if (attempt < this.maxRetries - 1) {
          const delay = this.retryDelayMs * 2 ** attempt + Math.random() * 1e3;
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }
      }
      throw error3;
    }
    throw lastError || /* @__PURE__ */ new Error("Execution failed after retries");
  }
  isRetryableError(error3) {
    if (error3 instanceof InterpreterNotReadyError) return true;
    if (error3 instanceof Error) return error3.message.includes("not ready") || error3.message.includes("initializing");
    return false;
  }
  async parseErrorResponse(response) {
    try {
      return createErrorFromResponse(await response.json());
    } catch {
      return createErrorFromResponse({
        code: ErrorCode.INTERNAL_ERROR,
        message: `HTTP ${response.status}: ${response.statusText}`,
        context: {},
        httpStatus: response.status,
        timestamp: (/* @__PURE__ */ new Date()).toISOString()
      });
    }
  }
  async *readLines(stream) {
    const reader = stream.getReader();
    let buffer = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (value) buffer += new TextDecoder().decode(value);
        if (done) break;
        let newlineIdx = buffer.indexOf("\n");
        while (newlineIdx !== -1) {
          yield buffer.slice(0, newlineIdx);
          buffer = buffer.slice(newlineIdx + 1);
          newlineIdx = buffer.indexOf("\n");
        }
      }
      if (buffer.length > 0) yield buffer;
    } finally {
      try {
        await reader.cancel();
      } catch {
      }
      reader.releaseLock();
    }
  }
  async parseExecutionResult(line, callbacks) {
    if (!line.trim()) return;
    if (!line.startsWith("data: ")) return;
    try {
      const jsonData = line.substring(6);
      const data = JSON.parse(jsonData);
      switch (data.type) {
        case "stdout":
          if (callbacks.onStdout && data.text) await callbacks.onStdout({
            text: data.text,
            timestamp: data.timestamp || Date.now()
          });
          break;
        case "stderr":
          if (callbacks.onStderr && data.text) await callbacks.onStderr({
            text: data.text,
            timestamp: data.timestamp || Date.now()
          });
          break;
        case "result":
          if (callbacks.onResult) {
            const result = new ResultImpl(data);
            await callbacks.onResult(result);
          }
          break;
        case "error":
          if (callbacks.onError) await callbacks.onError({
            name: data.ename || "Error",
            message: data.evalue || "Unknown error",
            traceback: data.traceback || []
          });
          break;
        case "execution_complete":
          break;
      }
    } catch {
    }
  }
};
var PortClient = class extends BaseHttpClient {
  static {
    __name(this, "PortClient");
  }
  /**
  * Expose a port and get a preview URL
  * @param port - Port number to expose
  * @param sessionId - The session ID for this operation
  * @param name - Optional name for the port
  */
  async exposePort(port, sessionId, name) {
    try {
      const data = {
        port,
        sessionId,
        name
      };
      return await this.post("/api/expose-port", data);
    } catch (error3) {
      throw error3;
    }
  }
  /**
  * Unexpose a port and remove its preview URL
  * @param port - Port number to unexpose
  * @param sessionId - The session ID for this operation
  */
  async unexposePort(port, sessionId) {
    try {
      const url = `/api/exposed-ports/${port}?session=${encodeURIComponent(sessionId)}`;
      return await this.delete(url);
    } catch (error3) {
      throw error3;
    }
  }
  /**
  * Get all currently exposed ports
  * @param sessionId - The session ID for this operation
  */
  async getExposedPorts(sessionId) {
    try {
      const url = `/api/exposed-ports?session=${encodeURIComponent(sessionId)}`;
      return await this.get(url);
    } catch (error3) {
      throw error3;
    }
  }
  /**
  * Watch a port for readiness via SSE stream
  * @param request - Port watch configuration
  * @returns SSE stream that emits PortWatchEvent objects
  */
  async watchPort(request) {
    try {
      return await this.doStreamFetch("/api/port-watch", request);
    } catch (error3) {
      throw error3;
    }
  }
};
var ProcessClient = class extends BaseHttpClient {
  static {
    __name(this, "ProcessClient");
  }
  /**
  * Start a background process
  * @param command - Command to execute as a background process
  * @param sessionId - The session ID for this operation
  * @param options - Optional settings (processId)
  */
  async startProcess(command, sessionId, options) {
    try {
      const data = {
        command,
        sessionId,
        ...options?.origin !== void 0 && { origin: options.origin },
        ...options?.processId !== void 0 && { processId: options.processId },
        ...options?.timeoutMs !== void 0 && { timeoutMs: options.timeoutMs },
        ...options?.env !== void 0 && { env: options.env },
        ...options?.cwd !== void 0 && { cwd: options.cwd },
        ...options?.encoding !== void 0 && { encoding: options.encoding },
        ...options?.autoCleanup !== void 0 && { autoCleanup: options.autoCleanup }
      };
      return await this.post("/api/process/start", data);
    } catch (error3) {
      throw error3;
    }
  }
  /**
  * List all processes (sandbox-scoped, not session-scoped)
  */
  async listProcesses() {
    try {
      return await this.get(`/api/process/list`);
    } catch (error3) {
      throw error3;
    }
  }
  /**
  * Get information about a specific process (sandbox-scoped, not session-scoped)
  * @param processId - ID of the process to retrieve
  */
  async getProcess(processId) {
    try {
      const url = `/api/process/${processId}`;
      return await this.get(url);
    } catch (error3) {
      throw error3;
    }
  }
  /**
  * Kill a specific process (sandbox-scoped, not session-scoped)
  * @param processId - ID of the process to kill
  */
  async killProcess(processId) {
    try {
      const url = `/api/process/${processId}`;
      return await this.delete(url);
    } catch (error3) {
      throw error3;
    }
  }
  /**
  * Kill all running processes (sandbox-scoped, not session-scoped)
  */
  async killAllProcesses() {
    try {
      return await this.delete(`/api/process/kill-all`);
    } catch (error3) {
      throw error3;
    }
  }
  /**
  * Get logs from a specific process (sandbox-scoped, not session-scoped)
  * @param processId - ID of the process to get logs from
  */
  async getProcessLogs(processId) {
    try {
      const url = `/api/process/${processId}/logs`;
      return await this.get(url);
    } catch (error3) {
      throw error3;
    }
  }
  /**
  * Stream logs from a specific process (sandbox-scoped, not session-scoped)
  * @param processId - ID of the process to stream logs from
  */
  async streamProcessLogs(processId) {
    try {
      const url = `/api/process/${processId}/stream`;
      return await this.doStreamFetch(url, void 0, "GET");
    } catch (error3) {
      throw error3;
    }
  }
};
var UtilityClient = class extends BaseHttpClient {
  static {
    __name(this, "UtilityClient");
  }
  /**
  * Ping the sandbox to check if it's responsive
  */
  async ping() {
    try {
      return (await this.get("/api/ping")).message;
    } catch (error3) {
      throw error3;
    }
  }
  /**
  * Get list of available commands in the sandbox environment
  */
  async getCommands() {
    try {
      return (await this.get("/api/commands")).availableCommands;
    } catch (error3) {
      throw error3;
    }
  }
  /**
  * Create a new execution session
  * @param options - Session configuration (id, env, cwd)
  */
  async createSession(options) {
    try {
      return await this.post("/api/session/create", options);
    } catch (error3) {
      throw error3;
    }
  }
  /**
  * Delete an execution session
  * @param sessionId - Session ID to delete
  */
  async deleteSession(sessionId) {
    try {
      return await this.post("/api/session/delete", { sessionId });
    } catch (error3) {
      throw error3;
    }
  }
  /**
  * Get the container version
  * Returns the version embedded in the Docker image during build
  */
  async getVersion() {
    try {
      return (await this.get("/api/version")).version;
    } catch (error3) {
      this.logger.debug("Failed to get container version (may be old container)", { error: error3 });
      return "unknown";
    }
  }
};
var WatchClient = class extends BaseHttpClient {
  static {
    __name(this, "WatchClient");
  }
  /**
  * Check whether a path changed since a previously returned version.
  */
  async checkChanges(request) {
    return this.post("/api/watch/check", request);
  }
  /**
  * Start watching a directory for changes.
  * The returned promise resolves only after the watcher is established
  * on the filesystem (i.e. the `watching` SSE event has been received).
  * The returned stream still contains the `watching` event so consumers
  * using `parseSSEStream` will see the full event sequence.
  *
  * @param request - Watch request with path and options
  */
  async watch(request) {
    try {
      const stream = await this.doStreamFetch("/api/watch", request);
      return await this.waitForReadiness(stream);
    } catch (error3) {
      throw error3;
    }
  }
  /**
  * Read SSE chunks until the `watching` event appears, then return a
  * wrapper stream that replays the buffered chunks followed by the
  * remaining original stream data.
  */
  async waitForReadiness(stream) {
    const reader = stream.getReader();
    const bufferedChunks = [];
    const decoder = new TextDecoder();
    let buffer = "";
    let currentEvent = { data: [] };
    let watcherReady = false;
    const processEventData = /* @__PURE__ */ __name((eventData) => {
      let event;
      try {
        event = JSON.parse(eventData);
      } catch {
        return;
      }
      if (event.type === "watching") watcherReady = true;
      if (event.type === "error") throw new Error(event.error || "Watch failed to establish");
    }, "processEventData");
    try {
      while (!watcherReady) {
        const { done, value } = await reader.read();
        if (done) {
          const finalParsed = parseSSEFrames(`${buffer}

`, currentEvent);
          for (const frame of finalParsed.events) {
            processEventData(frame.data);
            if (watcherReady) break;
          }
          if (watcherReady) break;
          throw new Error("Watch stream ended before watcher was established");
        }
        bufferedChunks.push(value);
        buffer += decoder.decode(value, { stream: true });
        const parsed = parseSSEFrames(buffer, currentEvent);
        buffer = parsed.remaining;
        currentEvent = parsed.currentEvent;
        for (const frame of parsed.events) {
          processEventData(frame.data);
          if (watcherReady) break;
        }
      }
    } catch (error3) {
      reader.cancel().catch(() => {
      });
      throw error3;
    }
    let replayIndex = 0;
    return new ReadableStream({
      pull(controller) {
        if (replayIndex < bufferedChunks.length) {
          controller.enqueue(bufferedChunks[replayIndex++]);
          return;
        }
        return reader.read().then(({ done: d, value: v }) => {
          if (d) {
            controller.close();
            return;
          }
          controller.enqueue(v);
        });
      },
      cancel() {
        return reader.cancel();
      }
    });
  }
};
var SandboxClient = class {
  static {
    __name(this, "SandboxClient");
  }
  backup;
  commands;
  files;
  processes;
  ports;
  git;
  interpreter;
  utils;
  desktop;
  watch;
  transport = null;
  constructor(options) {
    if (options.transportMode === "websocket" && options.wsUrl) this.transport = createTransport({
      mode: "websocket",
      wsUrl: options.wsUrl,
      baseUrl: options.baseUrl,
      logger: options.logger,
      stub: options.stub,
      port: options.port,
      retryTimeoutMs: options.retryTimeoutMs
    });
    const clientOptions = {
      baseUrl: "http://localhost:3000",
      ...options,
      transport: this.transport ?? options.transport
    };
    this.backup = new BackupClient(clientOptions);
    this.commands = new CommandClient(clientOptions);
    this.files = new FileClient(clientOptions);
    this.processes = new ProcessClient(clientOptions);
    this.ports = new PortClient(clientOptions);
    this.git = new GitClient(clientOptions);
    this.interpreter = new InterpreterClient(clientOptions);
    this.utils = new UtilityClient(clientOptions);
    this.desktop = new DesktopClient(clientOptions);
    this.watch = new WatchClient(clientOptions);
  }
  /**
  * Update the 503 retry budget on all transports without recreating the client.
  *
  * In WebSocket mode a single shared transport is used, so one update covers
  * every sub-client. In HTTP mode each sub-client owns its own transport, so
  * all of them are updated individually.
  */
  setRetryTimeoutMs(ms) {
    if (this.transport) this.transport.setRetryTimeoutMs(ms);
    else {
      this.backup.setRetryTimeoutMs(ms);
      this.commands.setRetryTimeoutMs(ms);
      this.files.setRetryTimeoutMs(ms);
      this.processes.setRetryTimeoutMs(ms);
      this.ports.setRetryTimeoutMs(ms);
      this.git.setRetryTimeoutMs(ms);
      this.interpreter.setRetryTimeoutMs(ms);
      this.utils.setRetryTimeoutMs(ms);
      this.desktop.setRetryTimeoutMs(ms);
      this.watch.setRetryTimeoutMs(ms);
    }
  }
  /**
  * Get the current transport mode
  */
  getTransportMode() {
    return this.transport?.getMode() ?? "http";
  }
  /**
  * Check if WebSocket is connected (only relevant in WebSocket mode)
  */
  isWebSocketConnected() {
    return this.transport?.isConnected() ?? false;
  }
  /**
  * Connect WebSocket transport (no-op in HTTP mode)
  * Called automatically on first request, but can be called explicitly
  * to establish connection upfront.
  */
  async connect() {
    if (this.transport) await this.transport.connect();
  }
  /**
  * Disconnect WebSocket transport (no-op in HTTP mode)
  * Should be called when the sandbox is destroyed.
  */
  disconnect() {
    if (this.transport) this.transport.disconnect();
  }
};
var SecurityError = class extends Error {
  static {
    __name(this, "SecurityError");
  }
  constructor(message, code) {
    super(message);
    this.code = code;
    this.name = "SecurityError";
  }
};
function validatePort(port) {
  if (!Number.isInteger(port)) return false;
  if (port < 1024 || port > 65535) return false;
  if ([3e3].includes(port)) return false;
  return true;
}
__name(validatePort, "validatePort");
function sanitizeSandboxId(id) {
  if (!id || id.length > 63) throw new SecurityError("Sandbox ID must be 1-63 characters long.", "INVALID_SANDBOX_ID_LENGTH");
  if (id.startsWith("-") || id.endsWith("-")) throw new SecurityError("Sandbox ID cannot start or end with hyphens (DNS requirement).", "INVALID_SANDBOX_ID_HYPHENS");
  const reservedNames = [
    "www",
    "api",
    "admin",
    "root",
    "system",
    "cloudflare",
    "workers"
  ];
  const lowerCaseId = id.toLowerCase();
  if (reservedNames.includes(lowerCaseId)) throw new SecurityError(`Reserved sandbox ID '${id}' is not allowed.`, "RESERVED_SANDBOX_ID");
  return id;
}
__name(sanitizeSandboxId, "sanitizeSandboxId");
function validateLanguage(language) {
  if (!language) return;
  const supportedLanguages = [
    "python",
    "python3",
    "javascript",
    "js",
    "node",
    "typescript",
    "ts"
  ];
  const normalized = language.toLowerCase();
  if (!supportedLanguages.includes(normalized)) throw new SecurityError(`Unsupported language '${language}'. Supported languages: python, javascript, typescript`, "INVALID_LANGUAGE");
}
__name(validateLanguage, "validateLanguage");
var CodeInterpreter = class {
  static {
    __name(this, "CodeInterpreter");
  }
  interpreterClient;
  contexts = /* @__PURE__ */ new Map();
  constructor(sandbox) {
    this.interpreterClient = sandbox.client.interpreter;
  }
  /**
  * Create a new code execution context
  */
  async createCodeContext(options = {}) {
    validateLanguage(options.language);
    const context2 = await this.interpreterClient.createCodeContext(options);
    this.contexts.set(context2.id, context2);
    return context2;
  }
  /**
  * Run code with optional context
  */
  async runCode(code, options = {}) {
    let context2 = options.context;
    if (!context2) {
      const language = options.language || "python";
      context2 = await this.getOrCreateDefaultContext(language);
    }
    const execution = new Execution(code, context2);
    await this.interpreterClient.runCodeStream(context2.id, code, options.language, {
      onStdout: /* @__PURE__ */ __name((output) => {
        execution.logs.stdout.push(output.text);
        if (options.onStdout) return options.onStdout(output);
      }, "onStdout"),
      onStderr: /* @__PURE__ */ __name((output) => {
        execution.logs.stderr.push(output.text);
        if (options.onStderr) return options.onStderr(output);
      }, "onStderr"),
      onResult: /* @__PURE__ */ __name(async (result) => {
        execution.results.push(new ResultImpl(result));
        if (options.onResult) return options.onResult(result);
      }, "onResult"),
      onError: /* @__PURE__ */ __name((error3) => {
        execution.error = error3;
        if (options.onError) return options.onError(error3);
      }, "onError")
    });
    return execution;
  }
  /**
  * Run code and return a streaming response
  */
  async runCodeStream(code, options = {}) {
    let context2 = options.context;
    if (!context2) {
      const language = options.language || "python";
      context2 = await this.getOrCreateDefaultContext(language);
    }
    return this.interpreterClient.streamCode(context2.id, code, options.language);
  }
  /**
  * List all code contexts
  */
  async listCodeContexts() {
    const contexts = await this.interpreterClient.listCodeContexts();
    for (const context2 of contexts) this.contexts.set(context2.id, context2);
    return contexts;
  }
  /**
  * Delete a code context
  */
  async deleteCodeContext(contextId) {
    await this.interpreterClient.deleteCodeContext(contextId);
    this.contexts.delete(contextId);
  }
  async getOrCreateDefaultContext(language) {
    for (const context2 of this.contexts.values()) if (context2.language === language) return context2;
    return this.createCodeContext({ language });
  }
};
async function* parseSSEStream(stream, signal) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let currentEvent = { data: [] };
  let isAborted = signal?.aborted ?? false;
  const emitEvent = /* @__PURE__ */ __name((data) => {
    if (data === "[DONE]" || data.trim() === "") return;
    try {
      return JSON.parse(data);
    } catch {
      return;
    }
  }, "emitEvent");
  const onAbort = /* @__PURE__ */ __name(() => {
    isAborted = true;
    reader.cancel().catch(() => {
    });
  }, "onAbort");
  if (signal && !signal.aborted) signal.addEventListener("abort", onAbort);
  try {
    while (true) {
      if (isAborted) throw new Error("Operation was aborted");
      const { done, value } = await reader.read();
      if (isAborted) throw new Error("Operation was aborted");
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parsed = parseSSEFrames(buffer, currentEvent);
      buffer = parsed.remaining;
      currentEvent = parsed.currentEvent;
      for (const frame of parsed.events) {
        const event = emitEvent(frame.data);
        if (event !== void 0) yield event;
      }
    }
    if (isAborted) throw new Error("Operation was aborted");
    const finalParsed = parseSSEFrames(`${buffer}

`, currentEvent);
    for (const frame of finalParsed.events) {
      const event = emitEvent(frame.data);
      if (event !== void 0) yield event;
    }
  } finally {
    if (signal) signal.removeEventListener("abort", onAbort);
    try {
      await reader.cancel();
    } catch {
    }
    reader.releaseLock();
  }
}
__name(parseSSEStream, "parseSSEStream");
var DEFAULT_POLL_INTERVAL_MS = 1e3;
var DEFAULT_ECHO_SUPPRESS_TTL_MS = 2e3;
var MAX_BACKOFF_MS = 3e4;
var SYNC_CONCURRENCY = 5;
var LocalMountSyncManager = class {
  static {
    __name(this, "LocalMountSyncManager");
  }
  bucket;
  mountPath;
  prefix;
  readOnly;
  client;
  sessionId;
  logger;
  pollIntervalMs;
  echoSuppressTtlMs;
  snapshot = /* @__PURE__ */ new Map();
  echoSuppressSet = /* @__PURE__ */ new Set();
  pollTimer = null;
  watchReconnectTimer = null;
  watchAbortController = null;
  running = false;
  consecutivePollFailures = 0;
  consecutiveWatchFailures = 0;
  constructor(options) {
    this.bucket = options.bucket;
    this.mountPath = options.mountPath;
    this.prefix = options.prefix;
    this.readOnly = options.readOnly;
    this.client = options.client;
    this.sessionId = options.sessionId;
    this.logger = options.logger.child({ operation: "local-mount-sync" });
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.echoSuppressTtlMs = options.echoSuppressTtlMs ?? DEFAULT_ECHO_SUPPRESS_TTL_MS;
  }
  /**
  * Start bidirectional sync. Performs initial full sync, then starts
  * the R2 poll loop and (if not readOnly) the container watch loop.
  */
  async start() {
    this.running = true;
    await this.client.files.mkdir(this.mountPath, this.sessionId, { recursive: true });
    await this.fullSyncR2ToContainer();
    this.schedulePoll();
    if (!this.readOnly) this.startContainerWatch();
    this.logger.info("Local mount sync started", {
      mountPath: this.mountPath,
      prefix: this.prefix,
      readOnly: this.readOnly,
      pollIntervalMs: this.pollIntervalMs
    });
  }
  /**
  * Stop all sync activity and clean up resources.
  */
  async stop() {
    this.running = false;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.watchReconnectTimer) {
      clearTimeout(this.watchReconnectTimer);
      this.watchReconnectTimer = null;
    }
    if (this.watchAbortController) {
      this.watchAbortController.abort();
      this.watchAbortController = null;
    }
    this.snapshot.clear();
    this.echoSuppressSet.clear();
    this.logger.info("Local mount sync stopped", { mountPath: this.mountPath });
  }
  async fullSyncR2ToContainer() {
    const objects = await this.listAllR2Objects();
    const newSnapshot = /* @__PURE__ */ new Map();
    for (let i = 0; i < objects.length; i += SYNC_CONCURRENCY) {
      const batch = objects.slice(i, i + SYNC_CONCURRENCY);
      await Promise.all(batch.map(async (obj) => {
        const containerPath = this.r2KeyToContainerPath(obj.key);
        newSnapshot.set(obj.key, {
          etag: obj.etag,
          size: obj.size
        });
        await this.ensureParentDir(containerPath);
        await this.transferR2ObjectToContainer(obj.key, containerPath);
      }));
    }
    this.snapshot = newSnapshot;
    this.logger.debug("Initial R2 -> Container sync complete", { objectCount: objects.length });
  }
  schedulePoll() {
    if (!this.running) return;
    const backoffMs = this.consecutivePollFailures > 0 ? Math.min(this.pollIntervalMs * 2 ** this.consecutivePollFailures, MAX_BACKOFF_MS) : this.pollIntervalMs;
    this.pollTimer = setTimeout(async () => {
      try {
        await this.pollR2ForChanges();
        this.consecutivePollFailures = 0;
      } catch (error3) {
        this.consecutivePollFailures++;
        this.logger.error("R2 poll cycle failed", error3 instanceof Error ? error3 : new Error(String(error3)));
      }
      this.schedulePoll();
    }, backoffMs);
  }
  async pollR2ForChanges() {
    const objects = await this.listAllR2Objects();
    const newSnapshot = /* @__PURE__ */ new Map();
    const changed = [];
    for (const obj of objects) {
      newSnapshot.set(obj.key, {
        etag: obj.etag,
        size: obj.size
      });
      const existing = this.snapshot.get(obj.key);
      if (!existing || existing.etag !== obj.etag) changed.push({
        key: obj.key,
        action: existing ? "modified" : "created"
      });
    }
    for (let i = 0; i < changed.length; i += SYNC_CONCURRENCY) {
      const batch = changed.slice(i, i + SYNC_CONCURRENCY);
      await Promise.all(batch.map(async ({ key, action }) => {
        try {
          const containerPath = this.r2KeyToContainerPath(key);
          await this.ensureParentDir(containerPath);
          this.suppressEcho(containerPath);
          await this.transferR2ObjectToContainer(key, containerPath);
          this.logger.debug("R2 -> Container: synced object", {
            key,
            action
          });
        } catch (error3) {
          this.logger.error(`R2 -> Container: failed to sync object ${key}`, error3 instanceof Error ? error3 : new Error(String(error3)));
        }
      }));
    }
    for (const [key] of this.snapshot) if (!newSnapshot.has(key)) {
      const containerPath = this.r2KeyToContainerPath(key);
      this.suppressEcho(containerPath);
      try {
        await this.client.files.deleteFile(containerPath, this.sessionId);
        this.logger.debug("R2 -> Container: deleted file", { key });
      } catch (error3) {
        this.logger.error("R2 -> Container: failed to delete", error3 instanceof Error ? error3 : new Error(String(error3)));
      }
    }
    this.snapshot = newSnapshot;
  }
  async listAllR2Objects() {
    const results = [];
    let cursor;
    do {
      const listResult = await this.bucket.list({
        ...this.prefix && { prefix: this.prefix },
        ...cursor && { cursor }
      });
      for (const obj of listResult.objects) results.push({
        key: obj.key,
        etag: obj.etag,
        size: obj.size
      });
      cursor = listResult.truncated ? listResult.cursor : void 0;
    } while (cursor);
    return results;
  }
  async transferR2ObjectToContainer(key, containerPath) {
    const obj = await this.bucket.get(key);
    if (!obj) return;
    const arrayBuffer = await obj.arrayBuffer();
    const base64 = uint8ArrayToBase64(new Uint8Array(arrayBuffer));
    await this.client.files.writeFile(containerPath, base64, this.sessionId, { encoding: "base64" });
  }
  async ensureParentDir(containerPath) {
    const parentDir = containerPath.substring(0, containerPath.lastIndexOf("/"));
    if (parentDir && parentDir !== this.mountPath) await this.client.files.mkdir(parentDir, this.sessionId, { recursive: true });
  }
  startContainerWatch() {
    this.watchAbortController = new AbortController();
    this.runWatchWithRetry();
  }
  runWatchWithRetry() {
    if (!this.running) return;
    this.runContainerWatchLoop().then(() => {
      this.consecutiveWatchFailures = 0;
      this.scheduleWatchReconnect();
    }).catch((error3) => {
      if (!this.running) return;
      this.consecutiveWatchFailures++;
      this.logger.error("Container watch loop failed", error3 instanceof Error ? error3 : new Error(String(error3)));
      this.scheduleWatchReconnect();
    });
  }
  scheduleWatchReconnect() {
    if (!this.running) return;
    const backoffMs = this.consecutiveWatchFailures > 0 ? Math.min(this.pollIntervalMs * 2 ** this.consecutiveWatchFailures, MAX_BACKOFF_MS) : this.pollIntervalMs;
    this.logger.debug("Reconnecting container watch", {
      backoffMs,
      failures: this.consecutiveWatchFailures
    });
    this.watchReconnectTimer = setTimeout(() => {
      this.watchReconnectTimer = null;
      if (!this.running) return;
      this.watchAbortController = new AbortController();
      this.runWatchWithRetry();
    }, backoffMs);
  }
  async runContainerWatchLoop() {
    const stream = await this.client.watch.watch({
      path: this.mountPath,
      recursive: true,
      sessionId: this.sessionId
    });
    for await (const event of parseSSEStream(stream, this.watchAbortController?.signal)) {
      if (!this.running) break;
      this.consecutiveWatchFailures = 0;
      if (event.type !== "event") continue;
      if (event.isDirectory) continue;
      const containerPath = event.path;
      if (this.echoSuppressSet.has(containerPath)) continue;
      const r2Key = this.containerPathToR2Key(containerPath);
      if (!r2Key) continue;
      try {
        switch (event.eventType) {
          case "create":
          case "modify":
          case "move_to":
            await this.uploadFileToR2(containerPath, r2Key);
            this.logger.debug("Container -> R2: synced file", {
              path: containerPath,
              key: r2Key,
              action: event.eventType
            });
            break;
          case "delete":
          case "move_from":
            await this.bucket.delete(r2Key);
            this.snapshot.delete(r2Key);
            this.logger.debug("Container -> R2: deleted object", {
              path: containerPath,
              key: r2Key
            });
            break;
        }
      } catch (error3) {
        this.logger.error(`Container -> R2 sync failed for ${containerPath}`, error3 instanceof Error ? error3 : new Error(String(error3)));
      }
    }
  }
  /**
  * Read a container file and upload it to R2, then update the local
  * snapshot so the next poll cycle doesn't echo the write back.
  */
  async uploadFileToR2(containerPath, r2Key) {
    const bytes = base64ToUint8Array((await this.client.files.readFile(containerPath, this.sessionId, { encoding: "base64" })).content);
    await this.bucket.put(r2Key, bytes);
    const head = await this.bucket.head(r2Key);
    if (head) this.snapshot.set(r2Key, {
      etag: head.etag,
      size: head.size
    });
  }
  suppressEcho(containerPath) {
    this.echoSuppressSet.add(containerPath);
    setTimeout(() => {
      this.echoSuppressSet.delete(containerPath);
    }, this.echoSuppressTtlMs);
  }
  r2KeyToContainerPath(key) {
    let relativePath = key;
    if (this.prefix) relativePath = key.startsWith(this.prefix) ? key.slice(this.prefix.length) : key;
    return path.join(this.mountPath, relativePath);
  }
  containerPathToR2Key(containerPath) {
    const resolved = path.resolve(containerPath);
    const mount = path.resolve(this.mountPath);
    if (!resolved.startsWith(mount)) return null;
    const relativePath = path.relative(mount, resolved);
    if (!relativePath || relativePath.startsWith("..")) return null;
    return this.prefix ? path.join(this.prefix, relativePath) : relativePath;
  }
};
function uint8ArrayToBase64(bytes) {
  return Buffer.from(bytes).toString("base64");
}
__name(uint8ArrayToBase64, "uint8ArrayToBase64");
function base64ToUint8Array(base64) {
  return new Uint8Array(Buffer.from(base64, "base64"));
}
__name(base64ToUint8Array, "base64ToUint8Array");
async function proxyTerminal(stub, sessionId, request, options) {
  if (!sessionId || typeof sessionId !== "string") throw new Error("sessionId is required for terminal access");
  if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") throw new Error("terminal() requires a WebSocket upgrade request");
  const params = new URLSearchParams({ sessionId });
  if (options?.cols) params.set("cols", String(options.cols));
  if (options?.rows) params.set("rows", String(options.rows));
  if (options?.shell) params.set("shell", options.shell);
  const ptyUrl = `http://localhost/ws/pty?${params}`;
  const ptyRequest = new Request(ptyUrl, request);
  return stub.fetch(switchPort(ptyRequest, 3e3));
}
__name(proxyTerminal, "proxyTerminal");
async function proxyToSandbox(request, env2) {
  const logger = createLogger({
    component: "sandbox-do",
    traceId: TraceContext.fromHeaders(request.headers) || TraceContext.generate(),
    operation: "proxy"
  });
  try {
    const url = new URL(request.url);
    const routeInfo = extractSandboxRoute(url);
    if (!routeInfo) return null;
    const { sandboxId, port, path: path$1, token } = routeInfo;
    const sandbox = getSandbox(env2.Sandbox, sandboxId, { normalizeId: true });
    if (port !== 3e3) {
      if (!await sandbox.validatePortToken(port, token)) {
        logger.warn("Invalid token access blocked", {
          port,
          sandboxId,
          path: path$1,
          hostname: url.hostname,
          url: request.url,
          method: request.method,
          userAgent: request.headers.get("User-Agent") || "unknown"
        });
        return new Response(JSON.stringify({
          error: `Access denied: Invalid token or port not exposed`,
          code: "INVALID_TOKEN"
        }), {
          status: 404,
          headers: { "Content-Type": "application/json" }
        });
      }
    }
    if (request.headers.get("Upgrade")?.toLowerCase() === "websocket") return await sandbox.fetch(switchPort(request, port));
    let proxyUrl;
    if (port !== 3e3) proxyUrl = `http://localhost:${port}${path$1}${url.search}`;
    else proxyUrl = `http://localhost:3000${path$1}${url.search}`;
    const headers = {
      "X-Original-URL": request.url,
      "X-Forwarded-Host": url.hostname,
      "X-Forwarded-Proto": url.protocol.replace(":", ""),
      "X-Sandbox-Name": sandboxId
    };
    request.headers.forEach((value, key) => {
      headers[key] = value;
    });
    const proxyRequest = new Request(proxyUrl, {
      method: request.method,
      headers,
      body: request.body,
      duplex: "half",
      redirect: "manual"
    });
    return await sandbox.containerFetch(proxyRequest, port);
  } catch (error3) {
    logger.error("Proxy routing error", error3 instanceof Error ? error3 : new Error(String(error3)));
    return new Response("Proxy routing error", { status: 500 });
  }
}
__name(proxyToSandbox, "proxyToSandbox");
function extractSandboxRoute(url) {
  const dotIndex = url.hostname.indexOf(".");
  if (dotIndex === -1) return null;
  const subdomain = url.hostname.slice(0, dotIndex);
  url.hostname.slice(dotIndex + 1);
  const firstHyphen = subdomain.indexOf("-");
  if (firstHyphen === -1) return null;
  const portStr = subdomain.slice(0, firstHyphen);
  if (!/^\d{4,5}$/.test(portStr)) return null;
  const port = parseInt(portStr, 10);
  if (!validatePort(port)) return null;
  const rest = subdomain.slice(firstHyphen + 1);
  const lastHyphen = rest.lastIndexOf("-");
  if (lastHyphen === -1) return null;
  const sandboxId = rest.slice(0, lastHyphen);
  const token = rest.slice(lastHyphen + 1);
  if (!/^[a-z0-9_]+$/.test(token) || token.length === 0 || token.length > 63) return null;
  if (sandboxId.length === 0 || sandboxId.length > 63) return null;
  let sanitizedSandboxId;
  try {
    sanitizedSandboxId = sanitizeSandboxId(sandboxId);
  } catch {
    return null;
  }
  return {
    port,
    sandboxId: sanitizedSandboxId,
    path: url.pathname || "/",
    token
  };
}
__name(extractSandboxRoute, "extractSandboxRoute");
function isLocalhostPattern(hostname) {
  if (hostname.startsWith("[")) if (hostname.includes("]:")) return hostname.substring(0, hostname.indexOf("]:") + 1) === "[::1]";
  else return hostname === "[::1]";
  if (hostname === "::1") return true;
  const hostPart = hostname.split(":")[0];
  return hostPart === "localhost" || hostPart === "127.0.0.1" || hostPart === "0.0.0.0";
}
__name(isLocalhostPattern, "isLocalhostPattern");
var BucketMountError = class extends Error {
  static {
    __name(this, "BucketMountError");
  }
  code;
  constructor(message, code = ErrorCode.BUCKET_MOUNT_ERROR) {
    super(message);
    this.name = "BucketMountError";
    this.code = code;
  }
};
var S3FSMountError = class extends BucketMountError {
  static {
    __name(this, "S3FSMountError");
  }
  constructor(message) {
    super(message, ErrorCode.S3FS_MOUNT_ERROR);
    this.name = "S3FSMountError";
  }
};
var MissingCredentialsError = class extends BucketMountError {
  static {
    __name(this, "MissingCredentialsError");
  }
  constructor(message) {
    super(message, ErrorCode.MISSING_CREDENTIALS);
    this.name = "MissingCredentialsError";
  }
};
var InvalidMountConfigError = class extends BucketMountError {
  static {
    __name(this, "InvalidMountConfigError");
  }
  constructor(message) {
    super(message, ErrorCode.INVALID_MOUNT_CONFIG);
    this.name = "InvalidMountConfigError";
  }
};
function detectCredentials(options, envVars) {
  if (options.credentials) return options.credentials;
  const awsAccessKeyId = envVars.AWS_ACCESS_KEY_ID;
  const awsSecretAccessKey = envVars.AWS_SECRET_ACCESS_KEY;
  if (awsAccessKeyId && awsSecretAccessKey) return {
    accessKeyId: awsAccessKeyId,
    secretAccessKey: awsSecretAccessKey
  };
  const r2AccessKeyId = envVars.R2_ACCESS_KEY_ID;
  const r2SecretAccessKey = envVars.R2_SECRET_ACCESS_KEY;
  if (r2AccessKeyId && r2SecretAccessKey) return {
    accessKeyId: r2AccessKeyId,
    secretAccessKey: r2SecretAccessKey
  };
  throw new MissingCredentialsError("No credentials found. Set R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY or AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY environment variables, or pass explicit credentials in options.");
}
__name(detectCredentials, "detectCredentials");
function detectProviderFromUrl(endpoint) {
  try {
    const hostname = new URL(endpoint).hostname.toLowerCase();
    if (hostname.endsWith(".r2.cloudflarestorage.com")) return "r2";
    if (hostname.endsWith(".amazonaws.com") || hostname === "s3.amazonaws.com") return "s3";
    if (hostname === "storage.googleapis.com") return "gcs";
    return null;
  } catch {
    return null;
  }
}
__name(detectProviderFromUrl, "detectProviderFromUrl");
function getProviderFlags(provider) {
  if (!provider) return ["use_path_request_style"];
  switch (provider) {
    case "r2":
      return ["nomixupload"];
    case "s3":
      return [];
    case "gcs":
      return [];
    default:
      return ["use_path_request_style"];
  }
}
__name(getProviderFlags, "getProviderFlags");
function resolveS3fsOptions(provider, userOptions) {
  const providerFlags = getProviderFlags(provider);
  if (!userOptions || userOptions.length === 0) return providerFlags;
  const allFlags = [...providerFlags, ...userOptions];
  const flagMap = /* @__PURE__ */ new Map();
  for (const flag of allFlags) {
    const [flagName] = flag.split("=");
    flagMap.set(flagName, flag);
  }
  return Array.from(flagMap.values());
}
__name(resolveS3fsOptions, "resolveS3fsOptions");
function validatePrefix(prefix) {
  if (!prefix.startsWith("/")) throw new InvalidMountConfigError(`Prefix must start with '/': "${prefix}"`);
}
__name(validatePrefix, "validatePrefix");
function validateBucketName(bucket, mountPath) {
  if (bucket.includes(":")) {
    const [bucketName, prefixPart] = bucket.split(":");
    throw new InvalidMountConfigError(`Bucket name cannot contain ':'. To mount a prefix, use the 'prefix' option:
  mountBucket('${bucketName}', '${mountPath}', { ...options, prefix: '${prefixPart}' })`);
  }
  if (!/^[a-z0-9]([a-z0-9.-]{0,61}[a-z0-9])?$/.test(bucket)) throw new InvalidMountConfigError(`Invalid bucket name: "${bucket}". Bucket names must be 3-63 characters, lowercase alphanumeric, dots, or hyphens, and cannot start/end with dots or hyphens.`);
}
__name(validateBucketName, "validateBucketName");
function buildS3fsSource(bucket, prefix) {
  return prefix ? `${bucket}:${prefix}` : bucket;
}
__name(buildS3fsSource, "buildS3fsSource");
var SDK_VERSION = "0.8.4";
var sandboxConfigurationCache = /* @__PURE__ */ new WeakMap();
function getNamespaceConfigurationCache(namespace) {
  const existing = sandboxConfigurationCache.get(namespace);
  if (existing) return existing;
  const created = /* @__PURE__ */ new Map();
  sandboxConfigurationCache.set(namespace, created);
  return created;
}
__name(getNamespaceConfigurationCache, "getNamespaceConfigurationCache");
function sameContainerTimeouts(left, right) {
  return left?.instanceGetTimeoutMS === right?.instanceGetTimeoutMS && left?.portReadyTimeoutMS === right?.portReadyTimeoutMS && left?.waitIntervalMS === right?.waitIntervalMS;
}
__name(sameContainerTimeouts, "sameContainerTimeouts");
function buildSandboxConfiguration(effectiveId, options, cached) {
  const configuration = {};
  if (cached?.sandboxName !== effectiveId || cached.normalizeId !== options?.normalizeId) configuration.sandboxName = {
    name: effectiveId,
    normalizeId: options?.normalizeId
  };
  if (options?.baseUrl !== void 0 && cached?.baseUrl !== options.baseUrl) configuration.baseUrl = options.baseUrl;
  if (options?.sleepAfter !== void 0 && cached?.sleepAfter !== options.sleepAfter) configuration.sleepAfter = options.sleepAfter;
  if (options?.keepAlive !== void 0 && cached?.keepAlive !== options.keepAlive) configuration.keepAlive = options.keepAlive;
  if (options?.containerTimeouts && !sameContainerTimeouts(cached?.containerTimeouts, options.containerTimeouts)) configuration.containerTimeouts = options.containerTimeouts;
  return configuration;
}
__name(buildSandboxConfiguration, "buildSandboxConfiguration");
function hasSandboxConfiguration(configuration) {
  return configuration.sandboxName !== void 0 || configuration.baseUrl !== void 0 || configuration.sleepAfter !== void 0 || configuration.keepAlive !== void 0 || configuration.containerTimeouts !== void 0;
}
__name(hasSandboxConfiguration, "hasSandboxConfiguration");
function mergeSandboxConfiguration(cached, configuration) {
  return {
    ...cached,
    ...configuration.sandboxName && {
      sandboxName: configuration.sandboxName.name,
      normalizeId: configuration.sandboxName.normalizeId
    },
    ...configuration.baseUrl !== void 0 && { baseUrl: configuration.baseUrl },
    ...configuration.sleepAfter !== void 0 && { sleepAfter: configuration.sleepAfter },
    ...configuration.keepAlive !== void 0 && { keepAlive: configuration.keepAlive },
    ...configuration.containerTimeouts !== void 0 && { containerTimeouts: configuration.containerTimeouts }
  };
}
__name(mergeSandboxConfiguration, "mergeSandboxConfiguration");
function applySandboxConfiguration(stub, configuration) {
  if (stub.configure) return stub.configure(configuration);
  const operations = [];
  if (configuration.sandboxName) operations.push(stub.setSandboxName?.(configuration.sandboxName.name, configuration.sandboxName.normalizeId) ?? Promise.resolve());
  if (configuration.baseUrl !== void 0) operations.push(stub.setBaseUrl?.(configuration.baseUrl) ?? Promise.resolve());
  if (configuration.sleepAfter !== void 0) operations.push(stub.setSleepAfter?.(configuration.sleepAfter) ?? Promise.resolve());
  if (configuration.keepAlive !== void 0) operations.push(stub.setKeepAlive?.(configuration.keepAlive) ?? Promise.resolve());
  if (configuration.containerTimeouts !== void 0) operations.push(stub.setContainerTimeouts?.(configuration.containerTimeouts) ?? Promise.resolve());
  return Promise.all(operations).then(() => void 0);
}
__name(applySandboxConfiguration, "applySandboxConfiguration");
function getSandbox(ns, id, options) {
  const sanitizedId = sanitizeSandboxId(id);
  const effectiveId = options?.normalizeId ? sanitizedId.toLowerCase() : sanitizedId;
  const hasUppercase = /[A-Z]/.test(sanitizedId);
  if (!options?.normalizeId && hasUppercase) createLogger({ component: "sandbox-do" }).warn(`Sandbox ID "${sanitizedId}" contains uppercase letters, which causes issues with preview URLs (hostnames are case-insensitive). normalizeId will default to true in a future version to prevent this. Use lowercase IDs or pass { normalizeId: true } to prepare.`);
  const stub = getContainer(ns, effectiveId);
  const namespaceCache = getNamespaceConfigurationCache(ns);
  const cachedConfiguration = namespaceCache.get(effectiveId);
  const configuration = buildSandboxConfiguration(effectiveId, options, cachedConfiguration);
  if (hasSandboxConfiguration(configuration)) {
    const nextConfiguration = mergeSandboxConfiguration(cachedConfiguration, configuration);
    namespaceCache.set(effectiveId, nextConfiguration);
    applySandboxConfiguration(stub, configuration).catch(() => {
      if (cachedConfiguration) {
        namespaceCache.set(effectiveId, cachedConfiguration);
        return;
      }
      namespaceCache.delete(effectiveId);
    });
  }
  const defaultSessionId = `sandbox-${effectiveId}`;
  const enhancedMethods = {
    fetch: /* @__PURE__ */ __name((request) => stub.fetch(request), "fetch"),
    createSession: /* @__PURE__ */ __name(async (opts) => {
      return enhanceSession(stub, await stub.createSession(opts));
    }, "createSession"),
    getSession: /* @__PURE__ */ __name(async (sessionId) => {
      return enhanceSession(stub, await stub.getSession(sessionId));
    }, "getSession"),
    terminal: /* @__PURE__ */ __name((request, opts) => proxyTerminal(stub, defaultSessionId, request, opts), "terminal"),
    wsConnect: connect(stub),
    desktop: new Proxy({}, { get(_, method) {
      if (typeof method !== "string" || method === "then") return void 0;
      return (...args) => stub.callDesktop(method, args);
    } })
  };
  return new Proxy(stub, { get(target, prop) {
    if (typeof prop === "string" && prop in enhancedMethods) return enhancedMethods[prop];
    return target[prop];
  } });
}
__name(getSandbox, "getSandbox");
function enhanceSession(stub, rpcSession) {
  return {
    ...rpcSession,
    terminal: /* @__PURE__ */ __name((request, opts) => proxyTerminal(stub, rpcSession.id, request, opts), "terminal")
  };
}
__name(enhanceSession, "enhanceSession");
function connect(stub) {
  return async (request, port) => {
    if (!validatePort(port)) throw new SecurityError(`Invalid port number: ${port}. Must be 1024-65535, excluding 3000 (sandbox control plane).`);
    const portSwitchedRequest = switchPort(request, port);
    return await stub.fetch(portSwitchedRequest);
  };
}
__name(connect, "connect");
function isR2Bucket(value) {
  return typeof value === "object" && value !== null && "put" in value && typeof value.put === "function" && "get" in value && typeof value.get === "function" && "head" in value && typeof value.head === "function" && "delete" in value && typeof value.delete === "function";
}
__name(isR2Bucket, "isR2Bucket");
var Sandbox = class Sandbox2 extends Container {
  static {
    __name(this, "Sandbox");
  }
  defaultPort = 3e3;
  sleepAfter = "10m";
  client;
  codeInterpreter;
  sandboxName = null;
  normalizeId = false;
  baseUrl = null;
  defaultSession = null;
  envVars = {};
  logger;
  keepAliveEnabled = false;
  activeMounts = /* @__PURE__ */ new Map();
  transport = "http";
  backupBucket = null;
  /**
  * Serializes backup operations to prevent concurrent create/restore on the same sandbox.
  *
  * This is in-memory state — it resets if the Durable Object is evicted and
  * re-instantiated (e.g. after sleep). This is acceptable because the container
  * filesystem is also lost on eviction, so there is no archive to race on.
  */
  backupInProgress = Promise.resolve();
  /**
  * R2 presigned URL credentials for direct container-to-R2 transfers.
  * All four fields plus the R2 binding must be configured for backup to work.
  */
  r2AccessKeyId = null;
  r2SecretAccessKey = null;
  r2AccountId = null;
  backupBucketName = null;
  r2Client = null;
  /**
  * Default container startup timeouts (conservative for production)
  * Based on Cloudflare docs: "Containers take several minutes to provision"
  */
  DEFAULT_CONTAINER_TIMEOUTS = {
    instanceGetTimeoutMS: 3e4,
    portReadyTimeoutMS: 9e4,
    waitIntervalMS: 300
  };
  /**
  * Active container timeout configuration
  * Can be set via options, env vars, or defaults
  */
  containerTimeouts = { ...this.DEFAULT_CONTAINER_TIMEOUTS };
  /**
  * Desktop environment operations.
  * Within the DO, this getter provides direct access to DesktopClient.
  * Over RPC, the getSandbox() proxy intercepts this property and routes
  * calls through callDesktop() instead.
  */
  get desktop() {
    return this.client.desktop;
  }
  /**
  * Allowed desktop methods — derived from the Desktop interface.
  * Restricts callDesktop() to a known set of operations.
  */
  static DESKTOP_METHODS = /* @__PURE__ */ new Set([
    "start",
    "stop",
    "status",
    "screenshot",
    "screenshotRegion",
    "click",
    "doubleClick",
    "tripleClick",
    "rightClick",
    "middleClick",
    "mouseDown",
    "mouseUp",
    "moveMouse",
    "drag",
    "scroll",
    "getCursorPosition",
    "type",
    "press",
    "keyDown",
    "keyUp",
    "getScreenSize",
    "getProcessStatus"
  ]);
  /**
  * Dispatch method for desktop operations.
  * Called by the client-side proxy created in getSandbox() to provide
  * the `sandbox.desktop.status()` API without relying on RPC pipelining
  * through property getters.
  */
  async callDesktop(method, args) {
    if (!Sandbox2.DESKTOP_METHODS.has(method)) throw new Error(`Unknown desktop method: ${method}`);
    const client = this.client.desktop;
    const fn = client[method];
    if (typeof fn !== "function") throw new Error(`Unknown desktop method: ${method}`);
    return fn.apply(client, args);
  }
  /**
  * Compute the transport retry budget from current container timeouts.
  *
  * The budget covers the full container startup window (instance provisioning
  * + port readiness) plus a 30s margin for the maximum single backoff delay
  * (capped at 30s in BaseTransport). The 120s floor preserves the previous
  * default for short timeout configurations.
  */
  computeRetryTimeoutMs() {
    const startupBudgetMs = this.containerTimeouts.instanceGetTimeoutMS + this.containerTimeouts.portReadyTimeoutMS;
    return Math.max(12e4, startupBudgetMs + 3e4);
  }
  /**
  * Create a SandboxClient with current transport settings
  */
  createSandboxClient() {
    return new SandboxClient({
      logger: this.logger,
      port: 3e3,
      stub: this,
      retryTimeoutMs: this.computeRetryTimeoutMs(),
      defaultHeaders: { "X-Sandbox-Id": this.ctx.id.toString() },
      ...this.transport === "websocket" && {
        transportMode: "websocket",
        wsUrl: "ws://localhost:3000/ws"
      }
    });
  }
  constructor(ctx, env2) {
    super(ctx, env2);
    const envObj = env2;
    ["SANDBOX_LOG_LEVEL", "SANDBOX_LOG_FORMAT"].forEach((key) => {
      if (envObj?.[key]) this.envVars[key] = String(envObj[key]);
    });
    this.containerTimeouts = this.getDefaultTimeouts(envObj);
    this.logger = createLogger({
      component: "sandbox-do",
      sandboxId: this.ctx.id.toString()
    });
    const transportEnv = envObj?.SANDBOX_TRANSPORT;
    if (transportEnv === "websocket") this.transport = "websocket";
    else if (transportEnv != null && transportEnv !== "http") this.logger.warn(`Invalid SANDBOX_TRANSPORT value: "${transportEnv}". Must be "http" or "websocket". Defaulting to "http".`);
    const backupBucket = envObj?.BACKUP_BUCKET;
    if (isR2Bucket(backupBucket)) this.backupBucket = backupBucket;
    this.r2AccountId = getEnvString(envObj, "CLOUDFLARE_ACCOUNT_ID") ?? null;
    this.r2AccessKeyId = getEnvString(envObj, "R2_ACCESS_KEY_ID") ?? null;
    this.r2SecretAccessKey = getEnvString(envObj, "R2_SECRET_ACCESS_KEY") ?? null;
    this.backupBucketName = getEnvString(envObj, "BACKUP_BUCKET_NAME") ?? null;
    if (this.r2AccessKeyId && this.r2SecretAccessKey) this.r2Client = new AwsClient({
      accessKeyId: this.r2AccessKeyId,
      secretAccessKey: this.r2SecretAccessKey
    });
    this.client = this.createSandboxClient();
    this.codeInterpreter = new CodeInterpreter(this);
    this.ctx.blockConcurrencyWhile(async () => {
      this.sandboxName = await this.ctx.storage.get("sandboxName") || null;
      this.normalizeId = await this.ctx.storage.get("normalizeId") || false;
      this.defaultSession = await this.ctx.storage.get("defaultSession") || null;
      this.keepAliveEnabled = await this.ctx.storage.get("keepAliveEnabled") || false;
      const storedTimeouts = await this.ctx.storage.get("containerTimeouts");
      if (storedTimeouts) {
        this.containerTimeouts = {
          ...this.containerTimeouts,
          ...storedTimeouts
        };
        this.client.setRetryTimeoutMs(this.computeRetryTimeoutMs());
      }
      const storedSleepAfter = await this.ctx.storage.get("sleepAfter");
      if (storedSleepAfter !== void 0) {
        this.sleepAfter = storedSleepAfter;
        this.renewActivityTimeout();
      }
    });
  }
  async setSandboxName(name, normalizeId) {
    if (!this.sandboxName) {
      this.sandboxName = name;
      this.normalizeId = normalizeId || false;
      await this.ctx.storage.put("sandboxName", name);
      await this.ctx.storage.put("normalizeId", this.normalizeId);
    }
  }
  async configure(configuration) {
    if (configuration.sandboxName) await this.setSandboxName(configuration.sandboxName.name, configuration.sandboxName.normalizeId);
    if (configuration.baseUrl !== void 0) await this.setBaseUrl(configuration.baseUrl);
    if (configuration.sleepAfter !== void 0) await this.setSleepAfter(configuration.sleepAfter);
    if (configuration.keepAlive !== void 0) await this.setKeepAlive(configuration.keepAlive);
    if (configuration.containerTimeouts !== void 0) await this.setContainerTimeouts(configuration.containerTimeouts);
  }
  async setBaseUrl(baseUrl) {
    if (!this.baseUrl) {
      this.baseUrl = baseUrl;
      await this.ctx.storage.put("baseUrl", baseUrl);
    } else if (this.baseUrl !== baseUrl) throw new Error("Base URL already set and different from one previously provided");
  }
  async setSleepAfter(sleepAfter) {
    this.sleepAfter = sleepAfter;
    await this.ctx.storage.put("sleepAfter", sleepAfter);
    this.renewActivityTimeout();
  }
  async setKeepAlive(keepAlive) {
    this.keepAliveEnabled = keepAlive;
    await this.ctx.storage.put("keepAliveEnabled", keepAlive);
    if (!keepAlive) this.renewActivityTimeout();
  }
  async setEnvVars(envVars) {
    const { toSet, toUnset } = partitionEnvVars(envVars);
    for (const key of toUnset) delete this.envVars[key];
    this.envVars = {
      ...this.envVars,
      ...toSet
    };
    if (this.defaultSession) {
      for (const key of toUnset) {
        const unsetCommand = `unset ${key}`;
        const result = await this.client.commands.execute(unsetCommand, this.defaultSession, { origin: "internal" });
        if (result.exitCode !== 0) throw new Error(`Failed to unset ${key}: ${result.stderr || "Unknown error"}`);
      }
      for (const [key, value] of Object.entries(toSet)) {
        const exportCommand = `export ${key}=${shellEscape(value)}`;
        const result = await this.client.commands.execute(exportCommand, this.defaultSession, { origin: "internal" });
        if (result.exitCode !== 0) throw new Error(`Failed to set ${key}: ${result.stderr || "Unknown error"}`);
      }
    }
  }
  /**
  * RPC method to configure container startup timeouts
  */
  async setContainerTimeouts(timeouts) {
    const validated = { ...this.containerTimeouts };
    if (timeouts.instanceGetTimeoutMS !== void 0) validated.instanceGetTimeoutMS = this.validateTimeout(timeouts.instanceGetTimeoutMS, "instanceGetTimeoutMS", 5e3, 3e5);
    if (timeouts.portReadyTimeoutMS !== void 0) validated.portReadyTimeoutMS = this.validateTimeout(timeouts.portReadyTimeoutMS, "portReadyTimeoutMS", 1e4, 6e5);
    if (timeouts.waitIntervalMS !== void 0) validated.waitIntervalMS = this.validateTimeout(timeouts.waitIntervalMS, "waitIntervalMS", 100, 5e3);
    this.containerTimeouts = validated;
    await this.ctx.storage.put("containerTimeouts", this.containerTimeouts);
    this.client.setRetryTimeoutMs(this.computeRetryTimeoutMs());
    this.logger.debug("Container timeouts updated", this.containerTimeouts);
  }
  /**
  * Validate a timeout value is within acceptable range
  * Throws error if invalid - used for user-provided values
  */
  validateTimeout(value, name, min, max) {
    if (typeof value !== "number" || Number.isNaN(value) || !Number.isFinite(value)) throw new Error(`${name} must be a valid finite number, got ${value}`);
    if (value < min || value > max) throw new Error(`${name} must be between ${min}-${max}ms, got ${value}ms`);
    return value;
  }
  /**
  * Get default timeouts with env var fallbacks and validation
  * Precedence: SDK defaults < Env vars < User config
  */
  getDefaultTimeouts(env2) {
    const parseAndValidate = /* @__PURE__ */ __name((envVar, name, min, max) => {
      const defaultValue = this.DEFAULT_CONTAINER_TIMEOUTS[name];
      if (envVar === void 0) return defaultValue;
      const parsed = parseInt(envVar, 10);
      if (Number.isNaN(parsed)) {
        this.logger.warn(`Invalid ${name}: "${envVar}" is not a number. Using default: ${defaultValue}ms`);
        return defaultValue;
      }
      if (parsed < min || parsed > max) {
        this.logger.warn(`Invalid ${name}: ${parsed}ms. Must be ${min}-${max}ms. Using default: ${defaultValue}ms`);
        return defaultValue;
      }
      return parsed;
    }, "parseAndValidate");
    return {
      instanceGetTimeoutMS: parseAndValidate(getEnvString(env2, "SANDBOX_INSTANCE_TIMEOUT_MS"), "instanceGetTimeoutMS", 5e3, 3e5),
      portReadyTimeoutMS: parseAndValidate(getEnvString(env2, "SANDBOX_PORT_TIMEOUT_MS"), "portReadyTimeoutMS", 1e4, 6e5),
      waitIntervalMS: parseAndValidate(getEnvString(env2, "SANDBOX_POLL_INTERVAL_MS"), "waitIntervalMS", 100, 5e3)
    };
  }
  /**
  * Mount an S3-compatible bucket as a local directory.
  *
  * Requires explicit endpoint URL for production. Credentials are auto-detected from environment
  * variables or can be provided explicitly.
  *
  * @param bucket - Bucket name (or R2 binding name when localBucket is true)
  * @param mountPath - Absolute path in container to mount at
  * @param options - Mount configuration
  * @throws MissingCredentialsError if no credentials found in environment
  * @throws S3FSMountError if S3FS mount command fails
  * @throws InvalidMountConfigError if bucket name, mount path, or endpoint is invalid
  */
  async mountBucket(bucket, mountPath, options) {
    if ("localBucket" in options && options.localBucket) {
      await this.mountBucketLocal(bucket, mountPath, options);
      return;
    }
    await this.mountBucketFuse(bucket, mountPath, options);
  }
  /**
  * Local dev mount: bidirectional sync via R2 binding + file/watch APIs
  */
  async mountBucketLocal(bucket, mountPath, options) {
    const mountStartTime = Date.now();
    let mountOutcome = "error";
    let mountError;
    try {
      const r2Binding = this.env[bucket];
      if (!r2Binding || !isR2Bucket(r2Binding)) throw new InvalidMountConfigError(`R2 binding "${bucket}" not found in env or is not an R2Bucket. Make sure the binding name matches your wrangler.jsonc R2 binding.`);
      if (!mountPath || !mountPath.startsWith("/")) throw new InvalidMountConfigError(`Invalid mount path: "${mountPath}". Must be an absolute path starting with /`);
      if (this.activeMounts.has(mountPath)) throw new InvalidMountConfigError(`Mount path already in use: ${mountPath}`);
      const sessionId = await this.ensureDefaultSession();
      const syncManager = new LocalMountSyncManager({
        bucket: r2Binding,
        mountPath,
        prefix: options.prefix,
        readOnly: options.readOnly ?? false,
        client: this.client,
        sessionId,
        logger: this.logger
      });
      const mountInfo = {
        mountType: "local-sync",
        bucket,
        mountPath,
        syncManager,
        mounted: false
      };
      this.activeMounts.set(mountPath, mountInfo);
      try {
        await syncManager.start();
        mountInfo.mounted = true;
      } catch (error3) {
        await syncManager.stop();
        this.activeMounts.delete(mountPath);
        throw error3;
      }
      mountOutcome = "success";
    } catch (error3) {
      mountError = error3 instanceof Error ? error3 : new Error(String(error3));
      throw error3;
    } finally {
      logCanonicalEvent(this.logger, {
        event: "bucket.mount",
        outcome: mountOutcome,
        durationMs: Date.now() - mountStartTime,
        bucket,
        mountPath,
        provider: "local-sync",
        prefix: options.prefix,
        error: mountError
      });
    }
  }
  /**
  * Production mount: S3FS-FUSE inside the container
  */
  async mountBucketFuse(bucket, mountPath, options) {
    const mountStartTime = Date.now();
    const prefix = options.prefix || void 0;
    let mountOutcome = "error";
    let mountError;
    let passwordFilePath;
    let provider = null;
    try {
      this.validateMountOptions(bucket, mountPath, {
        ...options,
        prefix
      });
      const s3fsSource = buildS3fsSource(bucket, prefix);
      provider = options.provider || detectProviderFromUrl(options.endpoint);
      this.logger.debug(`Detected provider: ${provider || "unknown"}`, {
        explicitProvider: options.provider,
        prefix
      });
      const envObj = this.env;
      const credentials = detectCredentials(options, {
        AWS_ACCESS_KEY_ID: getEnvString(envObj, "AWS_ACCESS_KEY_ID"),
        AWS_SECRET_ACCESS_KEY: getEnvString(envObj, "AWS_SECRET_ACCESS_KEY"),
        R2_ACCESS_KEY_ID: this.r2AccessKeyId || void 0,
        R2_SECRET_ACCESS_KEY: this.r2SecretAccessKey || void 0,
        ...this.envVars
      });
      passwordFilePath = this.generatePasswordFilePath();
      const mountInfo = {
        mountType: "fuse",
        bucket: s3fsSource,
        mountPath,
        endpoint: options.endpoint,
        provider,
        passwordFilePath,
        mounted: false
      };
      this.activeMounts.set(mountPath, mountInfo);
      await this.createPasswordFile(passwordFilePath, bucket, credentials);
      await this.execInternal(`mkdir -p ${shellEscape(mountPath)}`);
      await this.executeS3FSMount(s3fsSource, mountPath, options, provider, passwordFilePath);
      mountInfo.mounted = true;
      mountOutcome = "success";
    } catch (error3) {
      mountError = error3 instanceof Error ? error3 : new Error(String(error3));
      if (passwordFilePath) await this.deletePasswordFile(passwordFilePath);
      this.activeMounts.delete(mountPath);
      throw error3;
    } finally {
      logCanonicalEvent(this.logger, {
        event: "bucket.mount",
        outcome: mountOutcome,
        durationMs: Date.now() - mountStartTime,
        bucket,
        mountPath,
        provider: provider || "unknown",
        prefix,
        error: mountError
      });
    }
  }
  /**
  * Manually unmount a bucket filesystem
  *
  * @param mountPath - Absolute path where the bucket is mounted
  * @throws InvalidMountConfigError if mount path doesn't exist or isn't mounted
  */
  async unmountBucket(mountPath) {
    const unmountStartTime = Date.now();
    let unmountOutcome = "error";
    let unmountError;
    const mountInfo = this.activeMounts.get(mountPath);
    try {
      if (!mountInfo) throw new InvalidMountConfigError(`No active mount found at path: ${mountPath}`);
      if (mountInfo.mountType === "local-sync") {
        await mountInfo.syncManager.stop();
        mountInfo.mounted = false;
        this.activeMounts.delete(mountPath);
      } else try {
        await this.execInternal(`fusermount -u ${shellEscape(mountPath)}`);
        mountInfo.mounted = false;
        this.activeMounts.delete(mountPath);
      } finally {
        await this.deletePasswordFile(mountInfo.passwordFilePath);
      }
      unmountOutcome = "success";
    } catch (error3) {
      unmountError = error3 instanceof Error ? error3 : new Error(String(error3));
      throw error3;
    } finally {
      logCanonicalEvent(this.logger, {
        event: "bucket.unmount",
        outcome: unmountOutcome,
        durationMs: Date.now() - unmountStartTime,
        mountPath,
        bucket: mountInfo?.bucket,
        error: unmountError
      });
    }
  }
  /**
  * Validate mount options
  */
  validateMountOptions(bucket, mountPath, options) {
    try {
      new URL(options.endpoint);
    } catch (error3) {
      throw new InvalidMountConfigError(`Invalid endpoint URL: "${options.endpoint}". Must be a valid HTTP(S) URL.`);
    }
    validateBucketName(bucket, mountPath);
    if (!mountPath.startsWith("/")) throw new InvalidMountConfigError(`Mount path must be absolute (start with /): "${mountPath}"`);
    if (this.activeMounts.has(mountPath)) throw new InvalidMountConfigError(`Mount path "${mountPath}" is already in use by bucket "${this.activeMounts.get(mountPath)?.bucket}". Unmount the existing bucket first or use a different mount path.`);
    if (options.prefix !== void 0) validatePrefix(options.prefix);
  }
  /**
  * Generate unique password file path for s3fs credentials
  */
  generatePasswordFilePath() {
    return `/tmp/.passwd-s3fs-${crypto.randomUUID()}`;
  }
  /**
  * Create password file with s3fs credentials
  * Format: bucket:accessKeyId:secretAccessKey
  */
  async createPasswordFile(passwordFilePath, bucket, credentials) {
    const content = `${bucket}:${credentials.accessKeyId}:${credentials.secretAccessKey}`;
    await this.writeFile(passwordFilePath, content);
    await this.execInternal(`chmod 0600 ${shellEscape(passwordFilePath)}`);
  }
  /**
  * Delete password file
  */
  async deletePasswordFile(passwordFilePath) {
    try {
      await this.execInternal(`rm -f ${shellEscape(passwordFilePath)}`);
    } catch (error3) {
      this.logger.warn("password file cleanup failed", {
        passwordFilePath,
        error: error3 instanceof Error ? error3.message : String(error3)
      });
    }
  }
  /**
  * Execute S3FS mount command
  */
  async executeS3FSMount(bucket, mountPath, options, provider, passwordFilePath) {
    const resolvedOptions = resolveS3fsOptions(provider, options.s3fsOptions);
    const s3fsArgs = [];
    s3fsArgs.push(`passwd_file=${passwordFilePath}`);
    s3fsArgs.push(...resolvedOptions);
    if (options.readOnly) s3fsArgs.push("ro");
    s3fsArgs.push(`url=${options.endpoint}`);
    const optionsStr = shellEscape(s3fsArgs.join(","));
    const mountCmd = `s3fs ${shellEscape(bucket)} ${shellEscape(mountPath)} -o ${optionsStr}`;
    const result = await this.execInternal(mountCmd);
    if (result.exitCode !== 0) throw new S3FSMountError(`S3FS mount failed: ${result.stderr || result.stdout || "Unknown error"}`);
  }
  /**
  * Cleanup and destroy the sandbox container
  */
  async destroy() {
    const startTime = Date.now();
    let mountsProcessed = 0;
    let mountFailures = 0;
    let outcome = "error";
    let caughtError;
    try {
      if (this.ctx.container?.running) try {
        await this.client.desktop.stop();
      } catch {
      }
      this.client.disconnect();
      for (const [mountPath, mountInfo] of this.activeMounts.entries()) {
        mountsProcessed++;
        if (mountInfo.mountType === "local-sync") try {
          await mountInfo.syncManager.stop();
          mountInfo.mounted = false;
        } catch (error3) {
          mountFailures++;
          const errorMsg = error3 instanceof Error ? error3.message : String(error3);
          this.logger.warn(`Failed to stop local sync for ${mountPath}: ${errorMsg}`);
        }
        else {
          if (mountInfo.mounted) try {
            this.logger.debug(`Unmounting bucket ${mountInfo.bucket} from ${mountPath}`);
            await this.execInternal(`fusermount -u ${shellEscape(mountPath)}`);
            mountInfo.mounted = false;
          } catch (error3) {
            mountFailures++;
            const errorMsg = error3 instanceof Error ? error3.message : String(error3);
            this.logger.warn(`Failed to unmount bucket ${mountInfo.bucket} from ${mountPath}: ${errorMsg}`);
          }
          await this.deletePasswordFile(mountInfo.passwordFilePath);
        }
      }
      outcome = "success";
      await super.destroy();
    } catch (error3) {
      caughtError = error3 instanceof Error ? error3 : new Error(String(error3));
      throw error3;
    } finally {
      logCanonicalEvent(this.logger, {
        event: "sandbox.destroy",
        outcome,
        durationMs: Date.now() - startTime,
        mountsProcessed,
        mountFailures,
        error: caughtError
      });
    }
  }
  onStart() {
    this.logger.debug("Sandbox started");
    this.checkVersionCompatibility().catch((error3) => {
      this.logger.error("Version compatibility check failed", error3 instanceof Error ? error3 : new Error(String(error3)));
    });
  }
  /**
  * Check if the container version matches the SDK version
  * Logs a warning if there's a mismatch
  */
  async checkVersionCompatibility() {
    const sdkVersion = SDK_VERSION;
    let containerVersion;
    let outcome;
    try {
      containerVersion = await this.client.utils.getVersion();
      if (containerVersion === "unknown") outcome = "container_version_unknown";
      else if (containerVersion !== sdkVersion) outcome = "version_mismatch";
      else outcome = "compatible";
    } catch (error3) {
      outcome = "check_failed";
      containerVersion = void 0;
    }
    const successLevel = outcome === "compatible" ? "debug" : outcome === "container_version_unknown" ? "info" : "warn";
    logCanonicalEvent(this.logger, {
      event: "version.check",
      outcome: "success",
      durationMs: 0,
      sdkVersion,
      containerVersion: containerVersion ?? "unknown",
      versionOutcome: outcome
    }, { successLevel });
  }
  async onStop() {
    this.logger.debug("Sandbox stopped");
    for (const [, m] of this.activeMounts) if (m.mountType === "local-sync") await m.syncManager.stop().catch(() => {
    });
    this.defaultSession = null;
    this.activeMounts.clear();
    await Promise.all([this.ctx.storage.delete("portTokens"), this.ctx.storage.delete("defaultSession")]);
  }
  onError(error3) {
    this.logger.error("Sandbox error", error3 instanceof Error ? error3 : new Error(String(error3)));
  }
  /**
  * Override Container.containerFetch to use production-friendly timeouts
  * Automatically starts container with longer timeouts if not running
  */
  async containerFetch(requestOrUrl, portOrInit, portParam) {
    const { request, port } = this.parseContainerFetchArgs(requestOrUrl, portOrInit, portParam);
    const state = await this.getState();
    const containerRunning = this.ctx.container?.running;
    const staleStateDetected = state.status === "healthy" && containerRunning === false;
    if (state.status !== "healthy" || containerRunning === false) try {
      await this.startAndWaitForPorts({
        ports: port,
        cancellationOptions: {
          instanceGetTimeoutMS: this.containerTimeouts.instanceGetTimeoutMS,
          portReadyTimeoutMS: this.containerTimeouts.portReadyTimeoutMS,
          waitInterval: this.containerTimeouts.waitIntervalMS,
          abort: request.signal
        }
      });
    } catch (e) {
      if (this.isNoInstanceError(e)) {
        const errorBody$1 = {
          code: ErrorCode.INTERNAL_ERROR,
          message: "Container is currently provisioning. This can take several minutes on first deployment.",
          context: { phase: "provisioning" },
          httpStatus: 503,
          timestamp: (/* @__PURE__ */ new Date()).toISOString(),
          suggestion: "This is expected during first deployment. The SDK will retry automatically."
        };
        return new Response(JSON.stringify(errorBody$1), {
          status: 503,
          headers: {
            "Content-Type": "application/json",
            "Retry-After": "10"
          }
        });
      }
      if (this.isPermanentStartupError(e)) {
        this.logger.error("Permanent container startup error, returning 500", e instanceof Error ? e : new Error(String(e)));
        const errorBody$1 = {
          code: ErrorCode.INTERNAL_ERROR,
          message: "Container failed to start due to a permanent error. Check your container configuration.",
          context: {
            phase: "startup",
            error: e instanceof Error ? e.message : String(e)
          },
          httpStatus: 500,
          timestamp: (/* @__PURE__ */ new Date()).toISOString(),
          suggestion: "This error will not resolve with retries. Check container logs, image name, and resource limits."
        };
        return new Response(JSON.stringify(errorBody$1), {
          status: 500,
          headers: { "Content-Type": "application/json" }
        });
      }
      if (this.isTransientStartupError(e)) {
        if (staleStateDetected) {
          this.logger.warn("container.startup", {
            outcome: "stale_state_abort",
            staleStateDetected: true,
            error: e instanceof Error ? e.message : String(e)
          });
          this.ctx.abort();
        } else this.logger.debug("container.startup", {
          outcome: "transient_error",
          staleStateDetected,
          error: e instanceof Error ? e.message : String(e)
        });
        const errorBody$1 = {
          code: ErrorCode.INTERNAL_ERROR,
          message: "Container is starting. Please retry in a moment.",
          context: {
            phase: "startup",
            error: e instanceof Error ? e.message : String(e)
          },
          httpStatus: 503,
          timestamp: (/* @__PURE__ */ new Date()).toISOString(),
          suggestion: "The container is booting. The SDK will retry automatically."
        };
        return new Response(JSON.stringify(errorBody$1), {
          status: 503,
          headers: {
            "Content-Type": "application/json",
            "Retry-After": "3"
          }
        });
      }
      this.logger.warn("container.startup", {
        outcome: "unrecognized_error",
        staleStateDetected,
        error: e instanceof Error ? e.message : String(e)
      });
      const errorBody = {
        code: ErrorCode.INTERNAL_ERROR,
        message: "Container is starting. Please retry in a moment.",
        context: {
          phase: "startup",
          error: e instanceof Error ? e.message : String(e)
        },
        httpStatus: 503,
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        suggestion: "The SDK will retry automatically. If this persists, the container may need redeployment."
      };
      return new Response(JSON.stringify(errorBody), {
        status: 503,
        headers: {
          "Content-Type": "application/json",
          "Retry-After": "5"
        }
      });
    }
    return await super.containerFetch(requestOrUrl, portOrInit, portParam);
  }
  /**
  * Helper: Check if error is "no container instance available"
  * This indicates the container VM is still being provisioned.
  */
  isNoInstanceError(error3) {
    return error3 instanceof Error && error3.message.toLowerCase().includes("no container instance");
  }
  /**
  * Helper: Check if error is a transient startup error that should trigger retry
  *
  * These errors occur during normal container startup and are recoverable:
  * - Port not yet mapped (container starting, app not listening yet)
  * - Connection refused (port mapped but app not ready)
  * - Timeouts during startup (recoverable with retry)
  * - Network transients (temporary connectivity issues)
  *
  * Errors NOT included (permanent failures):
  * - "no such image" - missing Docker image
  * - "container already exists" - name collision
  * - Configuration errors
  */
  isTransientStartupError(error3) {
    if (!(error3 instanceof Error)) return false;
    const msg = error3.message.toLowerCase();
    return [
      "container port not found",
      "connection refused: container port",
      "the container is not listening",
      "failed to verify port",
      "container did not start",
      "network connection lost",
      "container suddenly disconnected",
      "monitor failed to find container",
      "container exited with unexpected exit code",
      "container exited before we could determine",
      "timed out",
      "timeout",
      "the operation was aborted"
    ].some((pattern) => msg.includes(pattern));
  }
  /**
  * Helper: Check if error is a permanent startup failure that will never recover
  *
  * These errors indicate resource exhaustion, misconfiguration, or missing images.
  * Retrying will never succeed, so the SDK should fail fast with HTTP 500.
  *
  * Error sources (traced from platform internals):
  *   - Container runtime: OOM, PID limit
  *   - Scheduling/provisioning: no matching app, no namespace configured
  *   - workerd container-client.c++: no such image
  *   - @cloudflare/containers: did not call start
  */
  isPermanentStartupError(error3) {
    if (!(error3 instanceof Error)) return false;
    const msg = error3.message.toLowerCase();
    return [
      "ran out of memory",
      "too many subprocesses",
      "no application that matches",
      "no container application assigned",
      "no such image",
      "did not call start"
    ].some((pattern) => msg.includes(pattern));
  }
  /**
  * Helper: Parse containerFetch arguments (supports multiple signatures)
  */
  parseContainerFetchArgs(requestOrUrl, portOrInit, portParam) {
    let request;
    let port;
    if (requestOrUrl instanceof Request) {
      request = requestOrUrl;
      port = typeof portOrInit === "number" ? portOrInit : void 0;
    } else {
      const url = typeof requestOrUrl === "string" ? requestOrUrl : requestOrUrl.toString();
      const init = typeof portOrInit === "number" ? {} : portOrInit || {};
      port = typeof portOrInit === "number" ? portOrInit : typeof portParam === "number" ? portParam : void 0;
      request = new Request(url, init);
    }
    port ??= this.defaultPort;
    if (port === void 0) throw new Error("No port specified for container fetch");
    return {
      request,
      port
    };
  }
  /**
  * Override onActivityExpired to prevent automatic shutdown when keepAlive is enabled
  * When keepAlive is disabled, calls parent implementation which stops the container
  */
  async onActivityExpired() {
    if (this.keepAliveEnabled) this.logger.debug("Activity expired but keepAlive is enabled - container will stay alive");
    else {
      this.logger.debug("Activity expired - stopping container");
      await super.onActivityExpired();
    }
  }
  async fetch(request) {
    const traceId = TraceContext.fromHeaders(request.headers) || TraceContext.generate();
    const requestLogger = this.logger.child({
      traceId,
      operation: "fetch"
    });
    const url = new URL(request.url);
    if (!this.sandboxName && request.headers.has("X-Sandbox-Name")) {
      const name = request.headers.get("X-Sandbox-Name");
      this.sandboxName = name;
      await this.ctx.storage.put("sandboxName", name);
    }
    const upgradeHeader = request.headers.get("Upgrade");
    const connectionHeader = request.headers.get("Connection");
    if (upgradeHeader?.toLowerCase() === "websocket" && connectionHeader?.toLowerCase().includes("upgrade")) try {
      requestLogger.debug("WebSocket upgrade requested", {
        path: url.pathname,
        port: this.determinePort(url)
      });
      return await super.fetch(request);
    } catch (error3) {
      requestLogger.error("WebSocket connection failed", error3 instanceof Error ? error3 : new Error(String(error3)), { path: url.pathname });
      throw error3;
    }
    const port = this.determinePort(url);
    return await this.containerFetch(request, port);
  }
  wsConnect(request, port) {
    throw new Error("wsConnect must be called on the stub returned by getSandbox()");
  }
  determinePort(url) {
    const proxyMatch = url.pathname.match(/^\/proxy\/(\d+)/);
    if (proxyMatch) return parseInt(proxyMatch[1], 10);
    return 3e3;
  }
  /**
  * Ensure default session exists - lazy initialization
  * This is called automatically by all public methods that need a session
  *
  * The session ID is persisted to DO storage. On container restart, if the
  * container already has this session (from a previous instance), we sync
  * our state rather than failing on duplicate creation.
  */
  async ensureDefaultSession() {
    const sessionId = `sandbox-${this.sandboxName || "default"}`;
    if (this.defaultSession === sessionId) return this.defaultSession;
    try {
      await this.client.utils.createSession({
        id: sessionId,
        env: this.envVars || {},
        cwd: "/workspace"
      });
      this.defaultSession = sessionId;
      await this.ctx.storage.put("defaultSession", sessionId);
      this.logger.debug("Default session initialized", { sessionId });
    } catch (error3) {
      if (error3 instanceof SessionAlreadyExistsError) {
        this.logger.debug("Session exists in container but not in DO state, syncing", { sessionId });
        this.defaultSession = sessionId;
        await this.ctx.storage.put("defaultSession", sessionId);
      } else throw error3;
    }
    return this.defaultSession;
  }
  async exec(command, options) {
    const session = await this.ensureDefaultSession();
    return this.execWithSession(command, session, options);
  }
  /**
  * Execute an infrastructure command (backup, mount, env setup, etc.)
  * tagged with origin: 'internal' so logging demotes it to debug level.
  */
  async execInternal(command) {
    const session = await this.ensureDefaultSession();
    return this.execWithSession(command, session, { origin: "internal" });
  }
  /**
  * Internal session-aware exec implementation
  * Used by both public exec() and session wrappers
  */
  async execWithSession(command, sessionId, options) {
    const startTime = Date.now();
    const timestamp = (/* @__PURE__ */ new Date()).toISOString();
    let execOutcome;
    let execError;
    try {
      if (options?.signal?.aborted) throw new Error("Operation was aborted");
      let result;
      if (options?.stream && options?.onOutput) result = await this.executeWithStreaming(command, sessionId, options, startTime, timestamp);
      else {
        const commandOptions = options && (options.timeout !== void 0 || options.env !== void 0 || options.cwd !== void 0 || options.origin !== void 0) ? {
          timeoutMs: options.timeout,
          env: options.env,
          cwd: options.cwd,
          origin: options.origin
        } : void 0;
        const response = await this.client.commands.execute(command, sessionId, commandOptions);
        const duration = Date.now() - startTime;
        result = this.mapExecuteResponseToExecResult(response, duration, sessionId);
      }
      execOutcome = {
        exitCode: result.exitCode,
        success: result.success
      };
      if (options?.onComplete) options.onComplete(result);
      return result;
    } catch (error3) {
      execError = error3 instanceof Error ? error3 : new Error(String(error3));
      if (options?.onError && error3 instanceof Error) options.onError(error3);
      throw error3;
    } finally {
      logCanonicalEvent(this.logger, {
        event: "sandbox.exec",
        outcome: execError ? "error" : "success",
        command,
        exitCode: execOutcome?.exitCode,
        durationMs: Date.now() - startTime,
        sessionId,
        origin: options?.origin ?? "user",
        error: execError ?? void 0,
        errorMessage: execError?.message
      });
    }
  }
  async executeWithStreaming(command, sessionId, options, startTime, timestamp) {
    let stdout2 = "";
    let stderr2 = "";
    try {
      const stream = await this.client.commands.executeStream(command, sessionId, {
        timeoutMs: options.timeout,
        env: options.env,
        cwd: options.cwd,
        origin: options.origin
      });
      for await (const event of parseSSEStream(stream)) {
        if (options.signal?.aborted) throw new Error("Operation was aborted");
        switch (event.type) {
          case "stdout":
          case "stderr":
            if (event.data) {
              if (event.type === "stdout") stdout2 += event.data;
              if (event.type === "stderr") stderr2 += event.data;
              if (options.onOutput) options.onOutput(event.type, event.data);
            }
            break;
          case "complete": {
            const duration = Date.now() - startTime;
            return {
              success: (event.exitCode ?? 0) === 0,
              exitCode: event.exitCode ?? 0,
              stdout: stdout2,
              stderr: stderr2,
              command,
              duration,
              timestamp,
              sessionId
            };
          }
          case "error":
            throw new Error(event.data || "Command execution failed");
        }
      }
      throw new Error("Stream ended without completion event");
    } catch (error3) {
      if (options.signal?.aborted) throw new Error("Operation was aborted");
      throw error3;
    }
  }
  mapExecuteResponseToExecResult(response, duration, sessionId) {
    return {
      success: response.success,
      exitCode: response.exitCode,
      stdout: response.stdout,
      stderr: response.stderr,
      command: response.command,
      duration,
      timestamp: response.timestamp,
      sessionId
    };
  }
  /**
  * Create a Process domain object from HTTP client DTO
  * Centralizes process object creation with bound methods
  * This eliminates duplication across startProcess, listProcesses, getProcess, and session wrappers
  */
  createProcessFromDTO(data, sessionId) {
    return {
      id: data.id,
      pid: data.pid,
      command: data.command,
      status: data.status,
      startTime: typeof data.startTime === "string" ? new Date(data.startTime) : data.startTime,
      endTime: data.endTime ? typeof data.endTime === "string" ? new Date(data.endTime) : data.endTime : void 0,
      exitCode: data.exitCode,
      sessionId,
      kill: /* @__PURE__ */ __name(async (signal) => {
        await this.killProcess(data.id, signal);
      }, "kill"),
      getStatus: /* @__PURE__ */ __name(async () => {
        return (await this.getProcess(data.id))?.status || "error";
      }, "getStatus"),
      getLogs: /* @__PURE__ */ __name(async () => {
        const logs = await this.getProcessLogs(data.id);
        return {
          stdout: logs.stdout,
          stderr: logs.stderr
        };
      }, "getLogs"),
      waitForLog: /* @__PURE__ */ __name(async (pattern, timeout) => {
        return this.waitForLogPattern(data.id, data.command, pattern, timeout);
      }, "waitForLog"),
      waitForPort: /* @__PURE__ */ __name(async (port, options) => {
        await this.waitForPortReady(data.id, data.command, port, options);
      }, "waitForPort"),
      waitForExit: /* @__PURE__ */ __name(async (timeout) => {
        return this.waitForProcessExit(data.id, data.command, timeout);
      }, "waitForExit")
    };
  }
  /**
  * Wait for a log pattern to appear in process output
  */
  async waitForLogPattern(processId, command, pattern, timeout) {
    const startTime = Date.now();
    const conditionStr = this.conditionToString(pattern);
    let collectedStdout = "";
    let collectedStderr = "";
    try {
      const existingLogs = await this.getProcessLogs(processId);
      collectedStdout = existingLogs.stdout;
      if (collectedStdout && !collectedStdout.endsWith("\n")) collectedStdout += "\n";
      collectedStderr = existingLogs.stderr;
      if (collectedStderr && !collectedStderr.endsWith("\n")) collectedStderr += "\n";
      const stdoutResult = this.matchPattern(existingLogs.stdout, pattern);
      if (stdoutResult) return stdoutResult;
      const stderrResult = this.matchPattern(existingLogs.stderr, pattern);
      if (stderrResult) return stderrResult;
    } catch (error3) {
      this.logger.debug("Could not get existing logs, will stream", {
        processId,
        error: error3 instanceof Error ? error3.message : String(error3)
      });
    }
    const stream = await this.streamProcessLogs(processId);
    let timeoutId;
    let timeoutPromise;
    if (timeout !== void 0) {
      const remainingTime = timeout - (Date.now() - startTime);
      if (remainingTime <= 0) throw this.createReadyTimeoutError(processId, command, conditionStr, timeout);
      timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(this.createReadyTimeoutError(processId, command, conditionStr, timeout));
        }, remainingTime);
      });
    }
    try {
      const streamProcessor = /* @__PURE__ */ __name(async () => {
        const checkPattern = /* @__PURE__ */ __name(() => {
          const stdoutResult = this.matchPattern(collectedStdout, pattern);
          if (stdoutResult) return stdoutResult;
          const stderrResult = this.matchPattern(collectedStderr, pattern);
          if (stderrResult) return stderrResult;
          return null;
        }, "checkPattern");
        for await (const event of parseSSEStream(stream)) {
          if (event.type === "stdout" || event.type === "stderr") {
            const data = event.data || "";
            if (event.type === "stdout") collectedStdout += data;
            else collectedStderr += data;
            const result = checkPattern();
            if (result) return result;
          }
          if (event.type === "exit") {
            const result = checkPattern();
            if (result) return result;
            throw this.createExitedBeforeReadyError(processId, command, conditionStr, event.exitCode ?? 1);
          }
        }
        const finalResult = checkPattern();
        if (finalResult) return finalResult;
        throw this.createExitedBeforeReadyError(processId, command, conditionStr, 0);
      }, "streamProcessor");
      if (timeoutPromise) return await Promise.race([streamProcessor(), timeoutPromise]);
      return await streamProcessor();
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }
  /**
  * Wait for a port to become available (for process readiness checking)
  */
  async waitForPortReady(processId, command, port, options) {
    const { mode = "http", path: path$1 = "/", status = {
      min: 200,
      max: 399
    }, timeout, interval = 500 } = options ?? {};
    const conditionStr = mode === "http" ? `port ${port} (HTTP ${path$1})` : `port ${port} (TCP)`;
    const statusMin = typeof status === "number" ? status : status.min;
    const statusMax = typeof status === "number" ? status : status.max;
    const stream = await this.client.ports.watchPort({
      port,
      mode,
      path: path$1,
      statusMin,
      statusMax,
      processId,
      interval
    });
    let timeoutId;
    let timeoutPromise;
    if (timeout !== void 0) timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(this.createReadyTimeoutError(processId, command, conditionStr, timeout));
      }, timeout);
    });
    try {
      const streamProcessor = /* @__PURE__ */ __name(async () => {
        for await (const event of parseSSEStream(stream)) switch (event.type) {
          case "ready":
            return;
          case "process_exited":
            throw this.createExitedBeforeReadyError(processId, command, conditionStr, event.exitCode ?? 1);
          case "error":
            throw new Error(event.error || "Port watch failed");
        }
        throw new Error("Port watch stream ended unexpectedly");
      }, "streamProcessor");
      if (timeoutPromise) await Promise.race([streamProcessor(), timeoutPromise]);
      else await streamProcessor();
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
      try {
        await stream.cancel();
      } catch {
      }
    }
  }
  /**
  * Wait for a process to exit
  * Returns the exit code
  */
  async waitForProcessExit(processId, command, timeout) {
    const stream = await this.streamProcessLogs(processId);
    let timeoutId;
    let timeoutPromise;
    if (timeout !== void 0) timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(this.createReadyTimeoutError(processId, command, "process exit", timeout));
      }, timeout);
    });
    try {
      const streamProcessor = /* @__PURE__ */ __name(async () => {
        for await (const event of parseSSEStream(stream)) if (event.type === "exit") return { exitCode: event.exitCode ?? 1 };
        throw new Error(`Process ${processId} stream ended unexpectedly without exit event`);
      }, "streamProcessor");
      if (timeoutPromise) return await Promise.race([streamProcessor(), timeoutPromise]);
      return await streamProcessor();
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }
  /**
  * Match a pattern against text
  */
  matchPattern(text, pattern) {
    if (typeof pattern === "string") {
      if (text.includes(pattern)) {
        const lines = text.split("\n");
        for (const line of lines) if (line.includes(pattern)) return { line };
        return { line: pattern };
      }
    } else {
      const safePattern = new RegExp(pattern.source, pattern.flags.replace("g", ""));
      const match = text.match(safePattern);
      if (match) {
        const lines = text.split("\n");
        for (const line of lines) {
          const lineMatch = line.match(safePattern);
          if (lineMatch) return {
            line,
            match: lineMatch
          };
        }
        return {
          line: match[0],
          match
        };
      }
    }
    return null;
  }
  /**
  * Convert a log pattern to a human-readable string
  */
  conditionToString(pattern) {
    if (typeof pattern === "string") return `"${pattern}"`;
    return pattern.toString();
  }
  /**
  * Create a ProcessReadyTimeoutError
  */
  createReadyTimeoutError(processId, command, condition, timeout) {
    return new ProcessReadyTimeoutError({
      code: ErrorCode.PROCESS_READY_TIMEOUT,
      message: `Process did not become ready within ${timeout}ms. Waiting for: ${condition}`,
      context: {
        processId,
        command,
        condition,
        timeout
      },
      httpStatus: 408,
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      suggestion: `Check if your process outputs ${condition}. You can increase the timeout parameter.`
    });
  }
  /**
  * Create a ProcessExitedBeforeReadyError
  */
  createExitedBeforeReadyError(processId, command, condition, exitCode2) {
    return new ProcessExitedBeforeReadyError({
      code: ErrorCode.PROCESS_EXITED_BEFORE_READY,
      message: `Process exited with code ${exitCode2} before becoming ready. Waiting for: ${condition}`,
      context: {
        processId,
        command,
        condition,
        exitCode: exitCode2
      },
      httpStatus: 500,
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      suggestion: "Check process logs with getLogs() for error messages"
    });
  }
  async startProcess(command, options, sessionId) {
    try {
      const session = sessionId ?? await this.ensureDefaultSession();
      const requestOptions = {
        ...options?.processId !== void 0 && { processId: options.processId },
        ...options?.timeout !== void 0 && { timeoutMs: options.timeout },
        ...options?.env !== void 0 && { env: filterEnvVars(options.env) },
        ...options?.cwd !== void 0 && { cwd: options.cwd },
        ...options?.encoding !== void 0 && { encoding: options.encoding },
        ...options?.autoCleanup !== void 0 && { autoCleanup: options.autoCleanup }
      };
      const response = await this.client.processes.startProcess(command, session, requestOptions);
      const processObj = this.createProcessFromDTO({
        id: response.processId,
        pid: response.pid,
        command: response.command,
        status: "running",
        startTime: /* @__PURE__ */ new Date(),
        endTime: void 0,
        exitCode: void 0
      }, session);
      if (options?.onStart) options.onStart(processObj);
      if (options?.onOutput || options?.onExit) this.startProcessCallbackStream(response.processId, options).catch(() => {
      });
      return processObj;
    } catch (error3) {
      if (options?.onError && error3 instanceof Error) options.onError(error3);
      throw error3;
    }
  }
  /**
  * Start background streaming for process callbacks
  * Opens SSE stream to container and routes events to callbacks
  */
  async startProcessCallbackStream(processId, options) {
    try {
      const stream = await this.client.processes.streamProcessLogs(processId);
      for await (const event of parseSSEStream(stream)) switch (event.type) {
        case "stdout":
          if (event.data && options.onOutput) options.onOutput("stdout", event.data);
          break;
        case "stderr":
          if (event.data && options.onOutput) options.onOutput("stderr", event.data);
          break;
        case "exit":
        case "complete":
          if (options.onExit) options.onExit(event.exitCode ?? null);
          return;
      }
    } catch (error3) {
      if (options.onError && error3 instanceof Error) options.onError(error3);
      this.logger.error("Background process streaming failed", error3 instanceof Error ? error3 : new Error(String(error3)), { processId });
    }
  }
  async listProcesses(sessionId) {
    const session = sessionId ?? await this.ensureDefaultSession();
    return (await this.client.processes.listProcesses()).processes.map((processData) => this.createProcessFromDTO({
      id: processData.id,
      pid: processData.pid,
      command: processData.command,
      status: processData.status,
      startTime: processData.startTime,
      endTime: processData.endTime,
      exitCode: processData.exitCode
    }, session));
  }
  async getProcess(id, sessionId) {
    const session = sessionId ?? await this.ensureDefaultSession();
    const response = await this.client.processes.getProcess(id);
    if (!response.process) return null;
    const processData = response.process;
    return this.createProcessFromDTO({
      id: processData.id,
      pid: processData.pid,
      command: processData.command,
      status: processData.status,
      startTime: processData.startTime,
      endTime: processData.endTime,
      exitCode: processData.exitCode
    }, session);
  }
  async killProcess(id, signal, sessionId) {
    await this.client.processes.killProcess(id);
  }
  async killAllProcesses(sessionId) {
    return (await this.client.processes.killAllProcesses()).cleanedCount;
  }
  async cleanupCompletedProcesses(sessionId) {
    return 0;
  }
  async getProcessLogs(id, sessionId) {
    const response = await this.client.processes.getProcessLogs(id);
    return {
      stdout: response.stdout,
      stderr: response.stderr,
      processId: response.processId
    };
  }
  async execStream(command, options) {
    if (options?.signal?.aborted) throw new Error("Operation was aborted");
    const session = await this.ensureDefaultSession();
    return this.client.commands.executeStream(command, session, {
      timeoutMs: options?.timeout,
      env: options?.env,
      cwd: options?.cwd
    });
  }
  /**
  * Internal session-aware execStream implementation
  */
  async execStreamWithSession(command, sessionId, options) {
    if (options?.signal?.aborted) throw new Error("Operation was aborted");
    return this.client.commands.executeStream(command, sessionId, {
      timeoutMs: options?.timeout,
      env: options?.env,
      cwd: options?.cwd
    });
  }
  /**
  * Stream logs from a background process as a ReadableStream.
  */
  async streamProcessLogs(processId, options) {
    if (options?.signal?.aborted) throw new Error("Operation was aborted");
    return this.client.processes.streamProcessLogs(processId);
  }
  async gitCheckout(repoUrl, options) {
    const session = options?.sessionId ?? await this.ensureDefaultSession();
    return this.client.git.checkout(repoUrl, session, {
      branch: options?.branch,
      targetDir: options?.targetDir,
      depth: options?.depth
    });
  }
  async mkdir(path$1, options = {}) {
    const session = options.sessionId ?? await this.ensureDefaultSession();
    return this.client.files.mkdir(path$1, session, { recursive: options.recursive });
  }
  async writeFile(path$1, content, options = {}) {
    const session = options.sessionId ?? await this.ensureDefaultSession();
    return this.client.files.writeFile(path$1, content, session, { encoding: options.encoding });
  }
  async deleteFile(path$1, sessionId) {
    const session = sessionId ?? await this.ensureDefaultSession();
    return this.client.files.deleteFile(path$1, session);
  }
  async renameFile(oldPath, newPath, sessionId) {
    const session = sessionId ?? await this.ensureDefaultSession();
    return this.client.files.renameFile(oldPath, newPath, session);
  }
  async moveFile(sourcePath, destinationPath, sessionId) {
    const session = sessionId ?? await this.ensureDefaultSession();
    return this.client.files.moveFile(sourcePath, destinationPath, session);
  }
  async readFile(path$1, options = {}) {
    const session = options.sessionId ?? await this.ensureDefaultSession();
    return this.client.files.readFile(path$1, session, { encoding: options.encoding });
  }
  /**
  * Stream a file from the sandbox using Server-Sent Events
  * Returns a ReadableStream that can be consumed with streamFile() or collectFile() utilities
  * @param path - Path to the file to stream
  * @param options - Optional session ID
  */
  async readFileStream(path$1, options = {}) {
    const session = options.sessionId ?? await this.ensureDefaultSession();
    return this.client.files.readFileStream(path$1, session);
  }
  async listFiles(path$1, options) {
    const session = await this.ensureDefaultSession();
    return this.client.files.listFiles(path$1, session, options);
  }
  async exists(path$1, sessionId) {
    const session = sessionId ?? await this.ensureDefaultSession();
    return this.client.files.exists(path$1, session);
  }
  /**
  * Get the noVNC preview URL for browser-based desktop viewing.
  * Confirms desktop is active, then uses exposePort() to generate
  * a token-authenticated preview URL for the noVNC port (6080).
  *
  * @param hostname - The custom domain hostname for preview URLs
  *   (e.g., 'preview.example.com'). Required because preview URLs
  *   use subdomain patterns that .workers.dev doesn't support.
  * @param options - Optional settings
  * @param options.token - Reuse an existing token instead of generating a new one
  * @returns The authenticated noVNC preview URL
  */
  async getDesktopStreamUrl(hostname, options) {
    if ((await this.client.desktop.status()).status === "inactive") throw new Error("Desktop is not running. Call sandbox.desktop.start() first.");
    let url;
    try {
      url = (await this.exposePort(6080, {
        hostname,
        token: options?.token
      })).url;
    } catch {
      const existingToken = (await this.ctx.storage.get("portTokens") || {})["6080"];
      if (existingToken && this.sandboxName) url = this.constructPreviewUrl(6080, this.sandboxName, hostname, existingToken);
      else throw new Error("Failed to get desktop stream URL: port 6080 could not be exposed and no existing token found.");
    }
    try {
      await this.waitForPort({
        portToCheck: 6080,
        retries: 30,
        waitInterval: 500
      });
    } catch {
    }
    return { url };
  }
  /**
  * Watch a directory for file system changes using native inotify.
  *
  * The returned promise resolves only after the watcher is established on the
  * filesystem, so callers can immediately perform actions that depend on the
  * watch being active. The returned stream contains the full event sequence
  * starting with the `watching` event.
  *
  * Consume the stream with `parseSSEStream<FileWatchSSEEvent>(stream)`.
  *
  * @param path - Path to watch (absolute or relative to /workspace)
  * @param options - Watch options
  */
  async watch(path$1, options = {}) {
    const sessionId = options.sessionId ?? await this.ensureDefaultSession();
    return this.client.watch.watch({
      path: path$1,
      recursive: options.recursive,
      include: options.include,
      exclude: options.exclude,
      sessionId
    });
  }
  /**
  * Check whether a path changed while this caller was disconnected.
  *
  * Pass the `version` returned from a prior call in `options.since` to learn
  * whether the path is unchanged, changed, or needs a full resync because the
  * retained change state was reset.
  *
  * @param path - Path to check (absolute or relative to /workspace)
  * @param options - Change-check options
  */
  async checkChanges(path$1, options = {}) {
    const sessionId = options.sessionId ?? await this.ensureDefaultSession();
    return this.client.watch.checkChanges({
      path: path$1,
      recursive: options.recursive,
      include: options.include,
      exclude: options.exclude,
      since: options.since,
      sessionId
    });
  }
  /**
  * Expose a port and get a preview URL for accessing services running in the sandbox
  *
  * @param port - Port number to expose (1024-65535)
  * @param options - Configuration options
  * @param options.hostname - Your Worker's domain name (required for preview URL construction)
  * @param options.name - Optional friendly name for the port
  * @param options.token - Optional custom token for the preview URL (1-16 characters: lowercase letters, numbers, underscores)
  *                       If not provided, a random 16-character token will be generated automatically
  * @returns Preview URL information including the full URL, port number, and optional name
  *
  * @example
  * // With auto-generated token
  * const { url } = await sandbox.exposePort(8080, { hostname: 'example.com' });
  * // url: https://8080-sandbox-id-abc123random4567.example.com
  *
  * @example
  * // With custom token for stable URLs across deployments
  * const { url } = await sandbox.exposePort(8080, {
  *   hostname: 'example.com',
  *   token: 'my_token_v1'
  * });
  * // url: https://8080-sandbox-id-my_token_v1.example.com
  */
  async exposePort(port, options) {
    const exposeStartTime = Date.now();
    let outcome = "error";
    let caughtError;
    try {
      if (!validatePort(port)) throw new SecurityError(`Invalid port number: ${port}. Must be 1024-65535, excluding 3000 (sandbox control plane).`);
      if (options.hostname.endsWith(".workers.dev")) throw new CustomDomainRequiredError({
        code: ErrorCode.CUSTOM_DOMAIN_REQUIRED,
        message: `Port exposure requires a custom domain. .workers.dev domains do not support wildcard subdomains required for port proxying.`,
        context: { originalError: options.hostname },
        httpStatus: 400,
        timestamp: (/* @__PURE__ */ new Date()).toISOString()
      });
      if (!this.sandboxName) throw new Error("Sandbox name not available. Ensure sandbox is accessed through getSandbox()");
      let token;
      if (options.token !== void 0) {
        this.validateCustomToken(options.token);
        token = options.token;
      } else token = this.generatePortToken();
      const tokens = await this.ctx.storage.get("portTokens") || {};
      const existingPort = Object.entries(tokens).find(([p, t]) => t === token && p !== port.toString());
      if (existingPort) throw new SecurityError(`Token '${token}' is already in use by port ${existingPort[0]}. Please use a different token.`);
      const sessionId = await this.ensureDefaultSession();
      await this.client.ports.exposePort(port, sessionId, options?.name);
      tokens[port.toString()] = token;
      await this.ctx.storage.put("portTokens", tokens);
      const url = this.constructPreviewUrl(port, this.sandboxName, options.hostname, token);
      outcome = "success";
      return {
        url,
        port,
        name: options?.name
      };
    } catch (error3) {
      caughtError = error3 instanceof Error ? error3 : new Error(String(error3));
      throw error3;
    } finally {
      logCanonicalEvent(this.logger, {
        event: "port.expose",
        outcome,
        port,
        durationMs: Date.now() - exposeStartTime,
        name: options?.name,
        hostname: options.hostname,
        error: caughtError
      });
    }
  }
  async unexposePort(port) {
    const unexposeStartTime = Date.now();
    let outcome = "error";
    let caughtError;
    try {
      if (!validatePort(port)) throw new SecurityError(`Invalid port number: ${port}. Must be 1024-65535, excluding 3000 (sandbox control plane).`);
      const sessionId = await this.ensureDefaultSession();
      await this.client.ports.unexposePort(port, sessionId);
      const tokens = await this.ctx.storage.get("portTokens") || {};
      if (tokens[port.toString()]) {
        delete tokens[port.toString()];
        await this.ctx.storage.put("portTokens", tokens);
      }
      outcome = "success";
    } catch (error3) {
      caughtError = error3 instanceof Error ? error3 : new Error(String(error3));
      throw error3;
    } finally {
      logCanonicalEvent(this.logger, {
        event: "port.unexpose",
        outcome,
        port,
        durationMs: Date.now() - unexposeStartTime,
        error: caughtError
      });
    }
  }
  async getExposedPorts(hostname) {
    const sessionId = await this.ensureDefaultSession();
    const response = await this.client.ports.getExposedPorts(sessionId);
    if (!this.sandboxName) throw new Error("Sandbox name not available. Ensure sandbox is accessed through getSandbox()");
    const tokens = await this.ctx.storage.get("portTokens") || {};
    return response.ports.map((port) => {
      const token = tokens[port.port.toString()];
      if (!token) throw new Error(`Port ${port.port} is exposed but has no token. This should not happen.`);
      return {
        url: this.constructPreviewUrl(port.port, this.sandboxName, hostname, token),
        port: port.port,
        status: port.status
      };
    });
  }
  async isPortExposed(port) {
    try {
      const sessionId = await this.ensureDefaultSession();
      return (await this.client.ports.getExposedPorts(sessionId)).ports.some((exposedPort) => exposedPort.port === port);
    } catch (error3) {
      this.logger.error("Error checking if port is exposed", error3 instanceof Error ? error3 : new Error(String(error3)), { port });
      return false;
    }
  }
  async validatePortToken(port, token) {
    if (!await this.isPortExposed(port)) return false;
    const storedToken = (await this.ctx.storage.get("portTokens") || {})[port.toString()];
    if (!storedToken) {
      this.logger.error("Port is exposed but has no token - bug detected", void 0, { port });
      return false;
    }
    const encoder2 = new TextEncoder();
    const a = encoder2.encode(storedToken);
    const b = encoder2.encode(token);
    try {
      return crypto.subtle.timingSafeEqual(a, b);
    } catch {
      return false;
    }
  }
  validateCustomToken(token) {
    if (token.length === 0) throw new SecurityError(`Custom token cannot be empty.`);
    if (token.length > 16) throw new SecurityError(`Custom token too long. Maximum 16 characters allowed. Received: ${token.length} characters.`);
    if (!/^[a-z0-9_]+$/.test(token)) throw new SecurityError(`Custom token must contain only lowercase letters (a-z), numbers (0-9), and underscores (_). Invalid token provided.`);
  }
  generatePortToken() {
    const array = new Uint8Array(12);
    crypto.getRandomValues(array);
    return btoa(String.fromCharCode(...array)).replace(/\+/g, "_").replace(/\//g, "_").replace(/=/g, "").toLowerCase();
  }
  constructPreviewUrl(port, sandboxId, hostname, token) {
    if (!validatePort(port)) throw new SecurityError(`Invalid port number: ${port}. Must be 1024-65535, excluding 3000 (sandbox control plane).`);
    const effectiveId = this.sandboxName || sandboxId;
    const hasUppercase = /[A-Z]/.test(effectiveId);
    if (!this.normalizeId && hasUppercase) throw new SecurityError(`Preview URLs require lowercase sandbox IDs. Your ID "${effectiveId}" contains uppercase letters.

To fix this:
1. Create a new sandbox with: getSandbox(ns, "${effectiveId}", { normalizeId: true })
2. This will create a sandbox with ID: "${effectiveId.toLowerCase()}"

Note: Due to DNS case-insensitivity, IDs with uppercase letters cannot be used with preview URLs.`);
    const sanitizedSandboxId = sanitizeSandboxId(sandboxId).toLowerCase();
    if (isLocalhostPattern(hostname)) {
      const [host, portStr] = hostname.split(":");
      const mainPort = portStr || "80";
      try {
        const baseUrl = new URL(`http://${host}:${mainPort}`);
        baseUrl.hostname = `${port}-${sanitizedSandboxId}-${token}.${host}`;
        return baseUrl.toString();
      } catch (error3) {
        throw new SecurityError(`Failed to construct preview URL: ${error3 instanceof Error ? error3.message : "Unknown error"}`);
      }
    }
    try {
      const baseUrl = new URL(`https://${hostname}`);
      baseUrl.hostname = `${port}-${sanitizedSandboxId}-${token}.${hostname}`;
      return baseUrl.toString();
    } catch (error3) {
      throw new SecurityError(`Failed to construct preview URL: ${error3 instanceof Error ? error3.message : "Unknown error"}`);
    }
  }
  /**
  * Create isolated execution session for advanced use cases
  * Returns ExecutionSession with full sandbox API bound to specific session
  */
  async createSession(options) {
    const sessionId = options?.id || `session-${Date.now()}`;
    const filteredEnv = filterEnvVars({
      ...this.envVars,
      ...options?.env ?? {}
    });
    const envPayload = Object.keys(filteredEnv).length > 0 ? filteredEnv : void 0;
    await this.client.utils.createSession({
      id: sessionId,
      ...envPayload && { env: envPayload },
      ...options?.cwd && { cwd: options.cwd },
      ...options?.commandTimeoutMs !== void 0 && { commandTimeoutMs: options.commandTimeoutMs }
    });
    return this.getSessionWrapper(sessionId);
  }
  /**
  * Get an existing session by ID
  * Returns ExecutionSession wrapper bound to the specified session
  *
  * This is useful for retrieving sessions across different requests/contexts
  * without storing the ExecutionSession object (which has RPC lifecycle limitations)
  *
  * @param sessionId - The ID of an existing session
  * @returns ExecutionSession wrapper bound to the session
  */
  async getSession(sessionId) {
    return this.getSessionWrapper(sessionId);
  }
  /**
  * Delete an execution session
  * Cleans up session resources and removes it from the container
  * Note: Cannot delete the default session. To reset the default session,
  * use sandbox.destroy() to terminate the entire sandbox.
  *
  * @param sessionId - The ID of the session to delete
  * @returns Result with success status, sessionId, and timestamp
  * @throws Error if attempting to delete the default session
  */
  async deleteSession(sessionId) {
    if (this.defaultSession && sessionId === this.defaultSession) throw new Error(`Cannot delete default session '${sessionId}'. Use sandbox.destroy() to terminate the sandbox.`);
    const response = await this.client.utils.deleteSession(sessionId);
    return {
      success: response.success,
      sessionId: response.sessionId,
      timestamp: response.timestamp
    };
  }
  getSessionWrapper(sessionId) {
    return {
      id: sessionId,
      terminal: null,
      exec: /* @__PURE__ */ __name((command, options) => this.execWithSession(command, sessionId, options), "exec"),
      execStream: /* @__PURE__ */ __name((command, options) => this.execStreamWithSession(command, sessionId, options), "execStream"),
      startProcess: /* @__PURE__ */ __name((command, options) => this.startProcess(command, options, sessionId), "startProcess"),
      listProcesses: /* @__PURE__ */ __name(() => this.listProcesses(sessionId), "listProcesses"),
      getProcess: /* @__PURE__ */ __name((id) => this.getProcess(id, sessionId), "getProcess"),
      killProcess: /* @__PURE__ */ __name((id, signal) => this.killProcess(id, signal), "killProcess"),
      killAllProcesses: /* @__PURE__ */ __name(() => this.killAllProcesses(), "killAllProcesses"),
      cleanupCompletedProcesses: /* @__PURE__ */ __name(() => this.cleanupCompletedProcesses(), "cleanupCompletedProcesses"),
      getProcessLogs: /* @__PURE__ */ __name((id) => this.getProcessLogs(id), "getProcessLogs"),
      streamProcessLogs: /* @__PURE__ */ __name((processId, options) => this.streamProcessLogs(processId, options), "streamProcessLogs"),
      writeFile: /* @__PURE__ */ __name((path$1, content, options) => this.writeFile(path$1, content, {
        ...options,
        sessionId
      }), "writeFile"),
      readFile: /* @__PURE__ */ __name((path$1, options) => this.readFile(path$1, {
        ...options,
        sessionId
      }), "readFile"),
      readFileStream: /* @__PURE__ */ __name((path$1) => this.readFileStream(path$1, { sessionId }), "readFileStream"),
      watch: /* @__PURE__ */ __name((path$1, options) => this.watch(path$1, {
        ...options,
        sessionId
      }), "watch"),
      checkChanges: /* @__PURE__ */ __name((path$1, options) => this.checkChanges(path$1, {
        ...options,
        sessionId
      }), "checkChanges"),
      mkdir: /* @__PURE__ */ __name((path$1, options) => this.mkdir(path$1, {
        ...options,
        sessionId
      }), "mkdir"),
      deleteFile: /* @__PURE__ */ __name((path$1) => this.deleteFile(path$1, sessionId), "deleteFile"),
      renameFile: /* @__PURE__ */ __name((oldPath, newPath) => this.renameFile(oldPath, newPath, sessionId), "renameFile"),
      moveFile: /* @__PURE__ */ __name((sourcePath, destPath) => this.moveFile(sourcePath, destPath, sessionId), "moveFile"),
      listFiles: /* @__PURE__ */ __name((path$1, options) => this.client.files.listFiles(path$1, sessionId, options), "listFiles"),
      exists: /* @__PURE__ */ __name((path$1) => this.exists(path$1, sessionId), "exists"),
      gitCheckout: /* @__PURE__ */ __name((repoUrl, options) => this.gitCheckout(repoUrl, {
        ...options,
        sessionId
      }), "gitCheckout"),
      setEnvVars: /* @__PURE__ */ __name(async (envVars) => {
        const { toSet, toUnset } = partitionEnvVars(envVars);
        try {
          for (const key of toUnset) {
            const unsetCommand = `unset ${key}`;
            const result = await this.client.commands.execute(unsetCommand, sessionId, { origin: "internal" });
            if (result.exitCode !== 0) throw new Error(`Failed to unset ${key}: ${result.stderr || "Unknown error"}`);
          }
          for (const [key, value] of Object.entries(toSet)) {
            const exportCommand = `export ${key}=${shellEscape(value)}`;
            const result = await this.client.commands.execute(exportCommand, sessionId, { origin: "internal" });
            if (result.exitCode !== 0) throw new Error(`Failed to set ${key}: ${result.stderr || "Unknown error"}`);
          }
        } catch (error3) {
          this.logger.error("Failed to set environment variables", error3 instanceof Error ? error3 : new Error(String(error3)), { sessionId });
          throw error3;
        }
      }, "setEnvVars"),
      createCodeContext: /* @__PURE__ */ __name((options) => this.codeInterpreter.createCodeContext(options), "createCodeContext"),
      runCode: /* @__PURE__ */ __name(async (code, options) => {
        return (await this.codeInterpreter.runCode(code, options)).toJSON();
      }, "runCode"),
      runCodeStream: /* @__PURE__ */ __name((code, options) => this.codeInterpreter.runCodeStream(code, options), "runCodeStream"),
      listCodeContexts: /* @__PURE__ */ __name(() => this.codeInterpreter.listCodeContexts(), "listCodeContexts"),
      deleteCodeContext: /* @__PURE__ */ __name((contextId) => this.codeInterpreter.deleteCodeContext(contextId), "deleteCodeContext"),
      mountBucket: /* @__PURE__ */ __name((bucket, mountPath, options) => this.mountBucket(bucket, mountPath, options), "mountBucket"),
      unmountBucket: /* @__PURE__ */ __name((mountPath) => this.unmountBucket(mountPath), "unmountBucket"),
      createBackup: /* @__PURE__ */ __name((options) => this.createBackup(options), "createBackup"),
      restoreBackup: /* @__PURE__ */ __name((backup) => this.restoreBackup(backup), "restoreBackup")
    };
  }
  async createCodeContext(options) {
    return this.codeInterpreter.createCodeContext(options);
  }
  async runCode(code, options) {
    return (await this.codeInterpreter.runCode(code, options)).toJSON();
  }
  async runCodeStream(code, options) {
    return this.codeInterpreter.runCodeStream(code, options);
  }
  async listCodeContexts() {
    return this.codeInterpreter.listCodeContexts();
  }
  async deleteCodeContext(contextId) {
    return this.codeInterpreter.deleteCodeContext(contextId);
  }
  /** UUID v4 format validator for backup IDs */
  static UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  /**
  * Validate that a directory path is safe for backup operations.
  * Rejects empty, relative, traversal, and null-byte paths.
  */
  static validateBackupDir(dir3, label) {
    if (!dir3 || !dir3.startsWith("/")) throw new InvalidBackupConfigError({
      message: `${label} must be an absolute path`,
      code: ErrorCode.INVALID_BACKUP_CONFIG,
      httpStatus: 400,
      context: { reason: `${label} must be an absolute path` },
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    });
    if (dir3.includes("\0")) throw new InvalidBackupConfigError({
      message: `${label} must not contain null bytes`,
      code: ErrorCode.INVALID_BACKUP_CONFIG,
      httpStatus: 400,
      context: { reason: `${label} must not contain null bytes` },
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    });
    if (dir3.split("/").includes("..")) throw new InvalidBackupConfigError({
      message: `${label} must not contain ".." path segments`,
      code: ErrorCode.INVALID_BACKUP_CONFIG,
      httpStatus: 400,
      context: { reason: `${label} must not contain ".." path segments` },
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    });
  }
  /**
  * Returns the R2 bucket or throws if backup is not configured.
  */
  requireBackupBucket() {
    if (!this.backupBucket) throw new InvalidBackupConfigError({
      message: "Backup not configured. Add a BACKUP_BUCKET R2 binding to your wrangler.jsonc.",
      code: ErrorCode.INVALID_BACKUP_CONFIG,
      httpStatus: 400,
      context: { reason: "Missing BACKUP_BUCKET R2 binding" },
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    });
    return this.backupBucket;
  }
  static PRESIGNED_URL_EXPIRY_SECONDS = 3600;
  /**
  * Create a unique, dedicated session for a single backup operation.
  * Each call produces a fresh session ID so concurrent or sequential
  * operations never share shell state. Callers must destroy the session
  * in a finally block via `client.utils.deleteSession()`.
  */
  async ensureBackupSession() {
    const sessionId = `__sandbox_backup_${crypto.randomUUID()}`;
    await this.client.utils.createSession({
      id: sessionId,
      cwd: "/"
    });
    return sessionId;
  }
  /**
  * Returns validated presigned URL configuration or throws if not configured.
  * All credential fields plus the R2 binding are required for backup to work.
  */
  requirePresignedUrlSupport() {
    if (!this.r2Client || !this.r2AccountId || !this.backupBucketName) {
      const missing = [];
      if (!this.r2AccountId) missing.push("CLOUDFLARE_ACCOUNT_ID");
      if (!this.r2AccessKeyId) missing.push("R2_ACCESS_KEY_ID");
      if (!this.r2SecretAccessKey) missing.push("R2_SECRET_ACCESS_KEY");
      if (!this.backupBucketName) missing.push("BACKUP_BUCKET_NAME");
      throw new InvalidBackupConfigError({
        message: `Backup requires R2 presigned URL credentials. Missing: ${missing.join(", ")}. Set these as environment variables or secrets in your wrangler.jsonc.`,
        code: ErrorCode.INVALID_BACKUP_CONFIG,
        httpStatus: 400,
        context: { reason: `Missing env vars: ${missing.join(", ")}` },
        timestamp: (/* @__PURE__ */ new Date()).toISOString()
      });
    }
    return {
      client: this.r2Client,
      accountId: this.r2AccountId,
      bucketName: this.backupBucketName
    };
  }
  /**
  * Generate a presigned GET URL for downloading an object from R2.
  * The container can curl this URL directly without credentials.
  */
  async generatePresignedGetUrl(r2Key) {
    const { client, accountId, bucketName } = this.requirePresignedUrlSupport();
    const encodedBucket = encodeURIComponent(bucketName);
    const encodedKey = r2Key.split("/").map((seg) => encodeURIComponent(seg)).join("/");
    const url = new URL(`https://${accountId}.r2.cloudflarestorage.com/${encodedBucket}/${encodedKey}`);
    url.searchParams.set("X-Amz-Expires", String(Sandbox2.PRESIGNED_URL_EXPIRY_SECONDS));
    return (await client.sign(new Request(url), { aws: { signQuery: true } })).url;
  }
  /**
  * Generate a presigned PUT URL for uploading an object to R2.
  * The container can curl PUT to this URL directly without credentials.
  */
  async generatePresignedPutUrl(r2Key) {
    const { client, accountId, bucketName } = this.requirePresignedUrlSupport();
    const encodedBucket = encodeURIComponent(bucketName);
    const encodedKey = r2Key.split("/").map((seg) => encodeURIComponent(seg)).join("/");
    const url = new URL(`https://${accountId}.r2.cloudflarestorage.com/${encodedBucket}/${encodedKey}`);
    url.searchParams.set("X-Amz-Expires", String(Sandbox2.PRESIGNED_URL_EXPIRY_SECONDS));
    return (await client.sign(new Request(url, { method: "PUT" }), { aws: { signQuery: true } })).url;
  }
  /**
  * Upload a backup archive via presigned PUT URL.
  * The container curls the archive directly to R2, bypassing the DO.
  * ~24 MB/s throughput vs ~0.6 MB/s for base64 readFile.
  */
  async uploadBackupPresigned(archivePath, r2Key, archiveSize, backupId, dir3, backupSession) {
    const presignedUrl = await this.generatePresignedPutUrl(r2Key);
    const curlCmd = [
      "curl -sSf",
      "-X PUT",
      "-H 'Content-Type: application/octet-stream'",
      "--connect-timeout 10",
      "--max-time 1800",
      "--retry 2",
      "--retry-max-time 60",
      `-T ${shellEscape(archivePath)}`,
      shellEscape(presignedUrl)
    ].join(" ");
    const result = await this.execWithSession(curlCmd, backupSession, {
      timeout: 181e4,
      origin: "internal"
    });
    if (result.exitCode !== 0) throw new BackupCreateError({
      message: `Presigned URL upload failed (exit code ${result.exitCode}): ${result.stderr}`,
      code: ErrorCode.BACKUP_CREATE_FAILED,
      httpStatus: 500,
      context: {
        dir: dir3,
        backupId
      },
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    });
    const head = await this.requireBackupBucket().head(r2Key);
    if (!head || head.size !== archiveSize) {
      const actualSize = head?.size ?? 0;
      throw new BackupCreateError({
        message: `Upload verification failed: expected ${archiveSize} bytes, got ${actualSize}.${result.exitCode === 0 && actualSize === 0 ? ' This usually means the BACKUP_BUCKET R2 binding is using local storage while presigned URLs upload to remote R2. Add `"remote": true` to your BACKUP_BUCKET R2 binding in wrangler.jsonc to fix this.' : ""}`,
        code: ErrorCode.BACKUP_CREATE_FAILED,
        httpStatus: 500,
        context: {
          dir: dir3,
          backupId
        },
        timestamp: (/* @__PURE__ */ new Date()).toISOString()
      });
    }
  }
  /**
  * Download a backup archive via presigned GET URL.
  * The container curls the archive directly from R2, bypassing the DO.
  * ~93 MB/s throughput vs ~0.6 MB/s for base64 writeFile.
  */
  async downloadBackupPresigned(archivePath, r2Key, expectedSize, backupId, dir3, backupSession) {
    const presignedUrl = await this.generatePresignedGetUrl(r2Key);
    await this.execWithSession("mkdir -p /var/backups", backupSession, { origin: "internal" });
    const tmpPath = `${archivePath}.tmp`;
    const curlCmd = [
      "curl -sSf",
      "--connect-timeout 10",
      "--max-time 1800",
      "--retry 2",
      "--retry-max-time 60",
      `-o ${shellEscape(tmpPath)}`,
      shellEscape(presignedUrl)
    ].join(" ");
    const result = await this.execWithSession(curlCmd, backupSession, {
      timeout: 181e4,
      origin: "internal"
    });
    if (result.exitCode !== 0) {
      await this.execWithSession(`rm -f ${shellEscape(tmpPath)}`, backupSession, { origin: "internal" }).catch(() => {
      });
      throw new BackupRestoreError({
        message: `Presigned URL download failed (exit code ${result.exitCode}): ${result.stderr}`,
        code: ErrorCode.BACKUP_RESTORE_FAILED,
        httpStatus: 500,
        context: {
          dir: dir3,
          backupId
        },
        timestamp: (/* @__PURE__ */ new Date()).toISOString()
      });
    }
    const sizeCheck = await this.execWithSession(`stat -c %s ${shellEscape(tmpPath)}`, backupSession, { origin: "internal" });
    const actualSize = parseInt(sizeCheck.stdout.trim(), 10);
    if (actualSize !== expectedSize) {
      await this.execWithSession(`rm -f ${shellEscape(tmpPath)}`, backupSession, { origin: "internal" }).catch(() => {
      });
      throw new BackupRestoreError({
        message: `Downloaded archive size mismatch: expected ${expectedSize}, got ${actualSize}`,
        code: ErrorCode.BACKUP_RESTORE_FAILED,
        httpStatus: 500,
        context: {
          dir: dir3,
          backupId
        },
        timestamp: (/* @__PURE__ */ new Date()).toISOString()
      });
    }
    const mvResult = await this.execWithSession(`mv ${shellEscape(tmpPath)} ${shellEscape(archivePath)}`, backupSession, { origin: "internal" });
    if (mvResult.exitCode !== 0) {
      await this.execWithSession(`rm -f ${shellEscape(tmpPath)}`, backupSession, { origin: "internal" }).catch(() => {
      });
      throw new BackupRestoreError({
        message: `Failed to finalize downloaded archive: ${mvResult.stderr}`,
        code: ErrorCode.BACKUP_RESTORE_FAILED,
        httpStatus: 500,
        context: {
          dir: dir3,
          backupId
        },
        timestamp: (/* @__PURE__ */ new Date()).toISOString()
      });
    }
  }
  /**
  * Serialize backup operations on this sandbox instance.
  * Concurrent backup/restore calls are queued so the multi-step
  * create-archive → read → upload (or download → write → extract) flow
  * is not interleaved with another backup operation on the same directory.
  */
  enqueueBackupOp(fn) {
    const next = this.backupInProgress.then(fn, () => fn());
    this.backupInProgress = next.catch(() => {
    });
    return next;
  }
  /**
  * Create a backup of a directory and upload it to R2.
  *
  * Flow:
  *   1. Container creates squashfs archive from the directory
  *   2. Container uploads the archive directly to R2 via presigned URL
  *   3. DO writes metadata to R2
  *   4. Container cleans up the local archive
  *
  * The returned DirectoryBackup handle is serializable. Store it anywhere
  * (KV, D1, DO storage) and pass it to restoreBackup() later.
  *
  * Concurrent backup/restore calls on the same sandbox are serialized.
  *
  * Partially-written files in the target directory may not be captured
  * consistently. Completed writes are captured.
  *
  * NOTE: Expired backups are not automatically deleted from R2. Configure
  * R2 lifecycle rules on the BACKUP_BUCKET to garbage-collect objects
  * under the `backups/` prefix after the desired retention period.
  */
  async createBackup(options) {
    this.requireBackupBucket();
    return this.enqueueBackupOp(() => this.doCreateBackup(options));
  }
  async doCreateBackup(options) {
    const bucket = this.requireBackupBucket();
    this.requirePresignedUrlSupport();
    const DEFAULT_TTL_SECONDS = 259200;
    const MAX_NAME_LENGTH = 256;
    const { dir: dir3, name, ttl = DEFAULT_TTL_SECONDS, gitignore = false, excludes = [] } = options;
    const backupStartTime = Date.now();
    let backupId;
    let sizeBytes;
    let outcome = "error";
    let caughtError;
    let backupSession;
    try {
      Sandbox2.validateBackupDir(dir3, "BackupOptions.dir");
      if (name !== void 0) {
        if (typeof name !== "string" || name.length > MAX_NAME_LENGTH) throw new InvalidBackupConfigError({
          message: `BackupOptions.name must be a string of at most ${MAX_NAME_LENGTH} characters`,
          code: ErrorCode.INVALID_BACKUP_CONFIG,
          httpStatus: 400,
          context: { reason: `name must be a string of at most ${MAX_NAME_LENGTH} characters` },
          timestamp: (/* @__PURE__ */ new Date()).toISOString()
        });
        if (/[\u0000-\u001f\u007f]/.test(name)) throw new InvalidBackupConfigError({
          message: "BackupOptions.name must not contain control characters",
          code: ErrorCode.INVALID_BACKUP_CONFIG,
          httpStatus: 400,
          context: { reason: "name must not contain control characters" },
          timestamp: (/* @__PURE__ */ new Date()).toISOString()
        });
      }
      if (ttl <= 0) throw new InvalidBackupConfigError({
        message: "BackupOptions.ttl must be a positive number of seconds",
        code: ErrorCode.INVALID_BACKUP_CONFIG,
        httpStatus: 400,
        context: { reason: "ttl must be a positive number of seconds" },
        timestamp: (/* @__PURE__ */ new Date()).toISOString()
      });
      if (typeof gitignore !== "boolean") throw new InvalidBackupConfigError({
        message: "BackupOptions.gitignore must be a boolean",
        code: ErrorCode.INVALID_BACKUP_CONFIG,
        httpStatus: 400,
        context: { reason: "gitignore must be a boolean" },
        timestamp: (/* @__PURE__ */ new Date()).toISOString()
      });
      if (!Array.isArray(excludes) || !excludes.every((e) => typeof e === "string")) throw new InvalidBackupConfigError({
        message: "BackupOptions.excludes must be an array of strings",
        code: ErrorCode.INVALID_BACKUP_CONFIG,
        httpStatus: 400,
        context: { reason: "excludes must be an array of strings" },
        timestamp: (/* @__PURE__ */ new Date()).toISOString()
      });
      backupSession = await this.ensureBackupSession();
      backupId = crypto.randomUUID();
      const archivePath = `/var/backups/${backupId}.sqsh`;
      const createResult = await this.client.backup.createArchive(dir3, archivePath, backupSession, gitignore, excludes);
      if (!createResult.success) throw new BackupCreateError({
        message: "Container failed to create backup archive",
        code: ErrorCode.BACKUP_CREATE_FAILED,
        httpStatus: 500,
        context: {
          dir: dir3,
          backupId
        },
        timestamp: (/* @__PURE__ */ new Date()).toISOString()
      });
      sizeBytes = createResult.sizeBytes;
      const r2Key = `backups/${backupId}/data.sqsh`;
      const metaKey = `backups/${backupId}/meta.json`;
      await this.uploadBackupPresigned(archivePath, r2Key, createResult.sizeBytes, backupId, dir3, backupSession);
      const metadata = {
        id: backupId,
        dir: dir3,
        name: name || null,
        sizeBytes: createResult.sizeBytes,
        ttl,
        createdAt: (/* @__PURE__ */ new Date()).toISOString()
      };
      await bucket.put(metaKey, JSON.stringify(metadata));
      outcome = "success";
      await this.execWithSession(`rm -f ${shellEscape(archivePath)}`, backupSession, { origin: "internal" }).catch(() => {
      });
      return {
        id: backupId,
        dir: dir3
      };
    } catch (error3) {
      caughtError = error3 instanceof Error ? error3 : new Error(String(error3));
      if (backupId && backupSession) {
        const archivePath = `/var/backups/${backupId}.sqsh`;
        const r2Key = `backups/${backupId}/data.sqsh`;
        const metaKey = `backups/${backupId}/meta.json`;
        await this.execWithSession(`rm -f ${shellEscape(archivePath)}`, backupSession, { origin: "internal" }).catch(() => {
        });
        await bucket.delete(r2Key).catch(() => {
        });
        await bucket.delete(metaKey).catch(() => {
        });
      }
      throw error3;
    } finally {
      if (backupSession) await this.client.utils.deleteSession(backupSession).catch(() => {
      });
      logCanonicalEvent(this.logger, {
        event: "backup.create",
        outcome,
        durationMs: Date.now() - backupStartTime,
        backupId,
        dir: dir3,
        name,
        sizeBytes,
        error: caughtError
      });
    }
  }
  /**
  * Restore a backup from R2 into a directory.
  *
  * Flow:
  *   1. DO reads metadata from R2 and checks TTL
  *   2. Container downloads the archive directly from R2 via presigned URL
  *   3. Container mounts the squashfs archive with FUSE overlayfs
  *
  * The target directory becomes an overlay mount with the backup as a
  * read-only lower layer and a writable upper layer for copy-on-write.
  * Any processes writing to the directory should be stopped first.
  *
  * **Mount Lifecycle**: The FUSE overlay mount persists only while the
  * container is running. When the sandbox sleeps or the container restarts,
  * the mount is lost and the directory becomes empty. Re-restore from the
  * backup handle to recover. This is an ephemeral restore, not a persistent
  * extraction.
  *
  * The backup is restored into `backup.dir`. This may differ from the
  * directory that was originally backed up, allowing cross-directory restore.
  *
  * Overlapping backups are independent: restoring a parent directory
  * overwrites everything inside it, including subdirectories that were
  * backed up separately. When restoring both, restore the parent first.
  *
  * Concurrent backup/restore calls on the same sandbox are serialized.
  */
  async restoreBackup(backup) {
    this.requireBackupBucket();
    return this.enqueueBackupOp(() => this.doRestoreBackup(backup));
  }
  async doRestoreBackup(backup) {
    const restoreStartTime = Date.now();
    const bucket = this.requireBackupBucket();
    this.requirePresignedUrlSupport();
    const { id: backupId, dir: dir3 } = backup;
    let outcome = "error";
    let caughtError;
    let backupSession;
    try {
      if (!backupId || typeof backupId !== "string") throw new InvalidBackupConfigError({
        message: "Invalid backup: missing or invalid id",
        code: ErrorCode.INVALID_BACKUP_CONFIG,
        httpStatus: 400,
        context: { reason: "missing or invalid id" },
        timestamp: (/* @__PURE__ */ new Date()).toISOString()
      });
      if (!Sandbox2.UUID_REGEX.test(backupId)) throw new InvalidBackupConfigError({
        message: "Invalid backup: id must be a valid UUID (e.g. from createBackup)",
        code: ErrorCode.INVALID_BACKUP_CONFIG,
        httpStatus: 400,
        context: { reason: "id must be a valid UUID" },
        timestamp: (/* @__PURE__ */ new Date()).toISOString()
      });
      Sandbox2.validateBackupDir(dir3, "Invalid backup: dir");
      const metaKey = `backups/${backupId}/meta.json`;
      const metaObject = await bucket.get(metaKey);
      if (!metaObject) throw new BackupNotFoundError({
        message: `Backup not found: ${backupId}. Verify the backup ID is correct and the backup has not been deleted.`,
        code: ErrorCode.BACKUP_NOT_FOUND,
        httpStatus: 404,
        context: { backupId },
        timestamp: (/* @__PURE__ */ new Date()).toISOString()
      });
      const metadata = await metaObject.json();
      const TTL_BUFFER_MS = 60 * 1e3;
      const createdAt = new Date(metadata.createdAt).getTime();
      if (Number.isNaN(createdAt)) throw new BackupRestoreError({
        message: `Backup metadata has invalid createdAt timestamp: ${metadata.createdAt}`,
        code: ErrorCode.BACKUP_RESTORE_FAILED,
        httpStatus: 500,
        context: {
          dir: dir3,
          backupId
        },
        timestamp: (/* @__PURE__ */ new Date()).toISOString()
      });
      const expiresAt = createdAt + metadata.ttl * 1e3;
      if (Date.now() + TTL_BUFFER_MS > expiresAt) throw new BackupExpiredError({
        message: `Backup ${backupId} has expired (created: ${metadata.createdAt}, TTL: ${metadata.ttl}s). Create a new backup.`,
        code: ErrorCode.BACKUP_EXPIRED,
        httpStatus: 400,
        context: {
          backupId,
          expiredAt: new Date(expiresAt).toISOString()
        },
        timestamp: (/* @__PURE__ */ new Date()).toISOString()
      });
      const r2Key = `backups/${backupId}/data.sqsh`;
      const archiveHead = await bucket.head(r2Key);
      if (!archiveHead) throw new BackupNotFoundError({
        message: `Backup archive not found in R2: ${backupId}. The archive may have been deleted by R2 lifecycle rules.`,
        code: ErrorCode.BACKUP_NOT_FOUND,
        httpStatus: 404,
        context: { backupId },
        timestamp: (/* @__PURE__ */ new Date()).toISOString()
      });
      backupSession = await this.ensureBackupSession();
      const archivePath = `/var/backups/${backupId}.sqsh`;
      const mountGlob = `/var/backups/mounts/${backupId}`;
      await this.execWithSession(`/usr/bin/fusermount3 -uz ${shellEscape(dir3)} 2>/dev/null || true`, backupSession, { origin: "internal" }).catch(() => {
      });
      await this.execWithSession(`for d in ${shellEscape(mountGlob)}_*/lower ${shellEscape(mountGlob)}/lower; do [ -d "$d" ] && /usr/bin/fusermount3 -uz "$d" 2>/dev/null; done; true`, backupSession, { origin: "internal" }).catch(() => {
      });
      const sizeCheck = await this.execWithSession(`stat -c %s ${shellEscape(archivePath)} 2>/dev/null || echo 0`, backupSession, { origin: "internal" }).catch(() => ({ stdout: "0" }));
      if (Number.parseInt((sizeCheck.stdout ?? "0").trim(), 10) !== archiveHead.size) await this.downloadBackupPresigned(archivePath, r2Key, archiveHead.size, backupId, dir3, backupSession);
      if (!(await this.client.backup.restoreArchive(dir3, archivePath, backupSession)).success) throw new BackupRestoreError({
        message: "Container failed to restore backup archive",
        code: ErrorCode.BACKUP_RESTORE_FAILED,
        httpStatus: 500,
        context: {
          dir: dir3,
          backupId
        },
        timestamp: (/* @__PURE__ */ new Date()).toISOString()
      });
      outcome = "success";
      return {
        success: true,
        dir: dir3,
        id: backupId
      };
    } catch (error3) {
      caughtError = error3 instanceof Error ? error3 : new Error(String(error3));
      if (backupId && backupSession) {
        const archivePath = `/var/backups/${backupId}.sqsh`;
        await this.execWithSession(`rm -f ${shellEscape(archivePath)}`, backupSession, { origin: "internal" }).catch(() => {
        });
      }
      throw error3;
    } finally {
      if (backupSession) await this.client.utils.deleteSession(backupSession).catch(() => {
      });
      logCanonicalEvent(this.logger, {
        event: "backup.restore",
        outcome,
        durationMs: Date.now() - restoreStartTime,
        backupId,
        dir: dir3,
        error: caughtError
      });
    }
  }
};

// src/index.ts
var src_default = {
  async fetch(request, env2) {
    const proxyResponse = await proxyToSandbox(request, env2);
    if (proxyResponse) return proxyResponse;
    const url = new URL(request.url);
    const path2 = url.pathname;
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization"
    };
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }
    try {
      if (path2 === "/health") {
        return json({ status: "ok", timestamp: (/* @__PURE__ */ new Date()).toISOString() }, corsHeaders);
      }
      if (request.method !== "POST" || !path2.startsWith("/sandbox/")) {
        return json({ error: "Not found" }, corsHeaders, 404);
      }
      const body = await request.json();
      if (path2 === "/sandbox/create") {
        const sandboxId2 = body.id || `sandbox-${Date.now()}`;
        const sandbox2 = getSandbox(env2.SANDBOX, sandboxId2);
        const result = await sandbox2.exec('echo "ready"');
        return json(
          {
            sandboxId: sandboxId2,
            ready: result.success,
            stdout: result.stdout.trim()
          },
          corsHeaders
        );
      }
      const { sandboxId } = body;
      if (!sandboxId) {
        return json({ error: "sandboxId is required" }, corsHeaders, 400);
      }
      const sandbox = getSandbox(env2.SANDBOX, sandboxId);
      if (path2 === "/sandbox/exec") {
        const { command } = body;
        if (!command) return json({ error: "command is required" }, corsHeaders, 400);
        const result = await sandbox.exec(command);
        return json(
          {
            stdout: result.stdout,
            stderr: result.stderr,
            exitCode: result.exitCode,
            success: result.success
          },
          corsHeaders
        );
      }
      if (path2 === "/sandbox/file/read") {
        const { path: filePath } = body;
        if (!filePath) return json({ error: "path is required" }, corsHeaders, 400);
        const result = await sandbox.exec(`cat ${JSON.stringify(filePath)}`);
        if (!result.success) return json({ error: result.stderr }, corsHeaders, 500);
        return json({ content: result.stdout }, corsHeaders);
      }
      if (path2 === "/sandbox/file/write") {
        const { path: filePath, content } = body;
        if (!filePath) return json({ error: "path is required" }, corsHeaders, 400);
        const escaped = (content || "").replace(/'/g, "'\\''");
        const result = await sandbox.exec(`mkdir -p "$(dirname ${JSON.stringify(filePath)})" && printf '%s' '${escaped}' > ${JSON.stringify(filePath)}`);
        if (!result.success) return json({ error: result.stderr }, corsHeaders, 500);
        return json({ ok: true }, corsHeaders);
      }
      if (path2 === "/sandbox/file/list") {
        const { path: dirPath } = body;
        const target = dirPath || "/workspace";
        const result = await sandbox.exec(`ls -1F ${JSON.stringify(target)} 2>/dev/null || echo ""`);
        const entries = result.stdout.trim().split("\n").filter(Boolean).map((entry) => ({
          name: entry.replace(/[/@*]$/, ""),
          type: entry.endsWith("/") ? "directory" : "file"
        }));
        return json({ entries }, corsHeaders);
      }
      if (path2 === "/sandbox/file/mkdir") {
        const { path: dirPath } = body;
        if (!dirPath) return json({ error: "path is required" }, corsHeaders, 400);
        await sandbox.exec(`mkdir -p ${dirPath}`);
        return json({ ok: true }, corsHeaders);
      }
      if (path2 === "/sandbox/process/start") {
        const { command } = body;
        if (!command) return json({ error: "command is required" }, corsHeaders, 400);
        const process2 = await sandbox.startProcess(command);
        return json({ processId: process2.id, command }, corsHeaders);
      }
      if (path2 === "/sandbox/process/kill") {
        const { processId } = body;
        if (!processId) return json({ error: "processId is required" }, corsHeaders, 400);
        await sandbox.killProcess(processId);
        return json({ ok: true }, corsHeaders);
      }
      if (path2 === "/sandbox/preview-url") {
        const { port } = body;
        const previewUrl = sandbox.getPreviewUrl(Number(port) || 3e3);
        return json({ previewUrl }, corsHeaders);
      }
      return json({ error: `Unknown route: ${path2}` }, corsHeaders, 404);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`Error on ${path2}:`, message);
      return json({ error: message }, corsHeaders, 500);
    }
  }
};
function json(data, extraHeaders = {}, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...extraHeaders }
  });
}
__name(json, "json");

// ../../node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env2, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env2);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// ../../node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env2, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env2);
  } catch (e) {
    const error3 = reduceError(e);
    return Response.json(error3, {
      status: 500,
      headers: { "MF-Experimental-Error-Stack": "true" }
    });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-IDsifT/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = src_default;

// ../../node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env2, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env2, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env2, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env2, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-IDsifT/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env2, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env2, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env2, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env2, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env2, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env2, ctx) => {
      this.env = env2;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  Sandbox,
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
/*! Bundled license information:

aws4fetch/dist/aws4fetch.esm.mjs:
  (**
   * @license MIT <https://opensource.org/licenses/MIT>
   * @copyright Michael Hart 2024
   *)
*/
//# sourceMappingURL=index.js.map
