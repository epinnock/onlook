var createModalSurfaceManager =
  require('../host/modal-surface.js').createModalSurfaceManager;

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

function installModalSurfaceSupport(target, rootTag, log) {
  if (!target.fab || typeof target.fab.createChildSet !== 'function') {
    target._modalSurfaceManager = null;
    target._syncModalSurfaces = function() {
      return [];
    };
    target._getModalSurfaces = function() {
      return [];
    };
    target._clearModalSurfaces = function() {
      return [];
    };
    return null;
  }

  var manager = createModalSurfaceManager(target.fab, rootTag);
  target._modalSurfaceManager = manager;
  target._syncModalSurfaces = function(children) {
    var committedSurfaces = manager.sync(children);
    if (committedSurfaces.length > 0) {
      log('modal surfaces synced=' + committedSurfaces.length);
    }
    return committedSurfaces;
  };
  target._getModalSurfaces = function() {
    return manager.getSurfaces();
  };
  target._clearModalSurfaces = function() {
    var clearedSurfaces = manager.dispose();
    if (clearedSurfaces.length > 0) {
      log('modal surfaces cleared=' + clearedSurfaces.length);
    }
    return clearedSurfaces;
  };

  return manager;
}

function installAppRegistry(target, log) {
  target.currentRootTag = null;
  target.global = target;
  target._modalSurfaceManager = null;
  target._syncModalSurfaces = function() {
    return [];
  };
  target._getModalSurfaces = function() {
    return [];
  };
  target._clearModalSurfaces = function() {
    return [];
  };

  target.RN$AppRegistry = {
    runApplication: function(appKey, props) {
      log('runApplication rootTag=' + props.rootTag);
      target.currentRootTag = props.rootTag;

      if (typeof target._initReconciler === 'function') {
        target._initReconciler(target.fab, props.rootTag);
        log('React reconciler initialized');
      } else {
        log('ERROR: _initReconciler not found — runtime not loaded?');
      }

      installModalSurfaceSupport(target, props.rootTag, log);
      log('modal surface manager initialized');

      if (typeof target.renderApp === 'function' && typeof target.React !== 'undefined') {
        target.renderApp(createDefaultScreen(target));
        log('default screen rendered');
      }
    },
    syncModalSurfaces: function(children) {
      return target._syncModalSurfaces(children);
    },
    getModalSurfaces: function() {
      return target._getModalSurfaces();
    },
    unmountApplicationComponentAtRootTag: function(rootTag) {
      if (rootTag !== target.currentRootTag) {
        return [];
      }

      var clearedSurfaces = target._clearModalSurfaces();
      target.currentRootTag = null;
      return clearedSurfaces;
    },
  };
}

module.exports = {
  installModalSurfaceSupport: installModalSurfaceSupport,
  installAppRegistry: installAppRegistry,
};
