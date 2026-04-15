function setupFabric(target, log) {
  target.fab = target.nativeFabricUIManager;
  if (!target.fab) {
    throw new Error('B13: nativeFabricUIManager missing');
  }

  target.fab.registerEventHandler(function() {});
  log('B13 fabric.registerEventHandler OK');

  return target.fab;
}

module.exports = {
  setupFabric: setupFabric,
};
