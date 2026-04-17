export function getHostGlobal() {
  return typeof globalThis !== 'undefined' ? globalThis : self;
}

export function logHost(message) {
  const globalRef = getHostGlobal();
  if (globalRef._log) {
    globalRef._log(message);
  }
}
