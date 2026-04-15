function createDefaultScreen(target) {
  var React = target.React;

  return React.createElement(
    'View',
    {
      style: {
        flex: 1,
        backgroundColor: 0xFF2d1b69 | 0,
        justifyContent: 'center',
        alignItems: 'center',
      },
    },
    React.createElement(
      'RCTText',
      {
        style: {
          fontSize: 24,
          fontWeight: '700',
          color: 0xFFFFFFFF | 0,
        },
      },
      React.createElement('RCTRawText', { text: 'Onlook Runtime Ready' }),
    ),
    React.createElement(
      'RCTText',
      {
        style: {
          fontSize: 14,
          color: 0xFFA78BFA | 0,
          marginTop: 12,
        },
      },
      React.createElement('RCTRawText', { text: 'Waiting for component code...' }),
    ),
  );
}

function installAppRegistry(target, log) {
  target.currentRootTag = null;
  target.global = target;

  target.RN$AppRegistry = {
    runApplication: function(appKey, props) {
      log('B13 runApplication rootTag=' + props.rootTag);
      target.currentRootTag = props.rootTag;

      if (typeof target._initReconciler === 'function') {
        target._initReconciler(target.fab, props.rootTag);
        log('B13 React reconciler initialized');
      } else {
        log('B13 ERROR: _initReconciler not found — runtime not loaded?');
      }

      if (typeof target.renderApp === 'function' && typeof target.React !== 'undefined') {
        target.renderApp(createDefaultScreen(target));
        log('B13 default screen rendered');
      }
    },
  };
}

module.exports = {
  installAppRegistry: installAppRegistry,
};
