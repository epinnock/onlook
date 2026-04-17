function setupFabric(target, log) {
  target.fab = target.nativeFabricUIManager;
  if (!target.fab) {
    throw new Error('onlook-runtime: nativeFabricUIManager missing');
  }

  target.fab.registerEventHandler(function() {});
  log('fabric.registerEventHandler OK');

  return target.fab;
}

module.exports = {
  setupFabric: setupFabric,
};
