const installReactNativeSvgCore = require('./react-native-svg-core.js');

const {
  MODULE_ID,
  RUNTIME_SHIM_REGISTRY_KEY,
  ensureRuntimeShimRegistry,
  mergeRuntimeModule,
} = installReactNativeSvgCore;

function resolveReact(target) {
  const candidate = target && target.React;

  if (candidate && typeof candidate === 'object' && candidate.default) {
    return candidate.default;
  }

  if (candidate) {
    return candidate;
  }

  return require('react');
}

function resolveViewType(target) {
  return target && target.View ? target.View : 'View';
}

function mergeStyle(style, nextStyle) {
  if (!nextStyle || Object.keys(nextStyle).length === 0) {
    return style;
  }

  if (!style) {
    return nextStyle;
  }

  if (Array.isArray(style)) {
    return [...style, nextStyle];
  }

  return [style, nextStyle];
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function resolveColor(value) {
  return typeof value === 'string' && value !== 'none' ? value : undefined;
}

function resolveBorderRadius(props) {
  if (isFiniteNumber(props?.rx)) {
    return props.rx;
  }

  if (isFiniteNumber(props?.ry)) {
    return props.ry;
  }

  return undefined;
}

function buildHostProps(props, nextStyle) {
  const {
    style,
    testID,
    nativeID,
    accessibilityLabel,
    accessibilityRole,
    pointerEvents,
  } = props || {};
  const nextProps = {};
  const mergedStyle = mergeStyle(style, nextStyle);

  if (mergedStyle) {
    nextProps.style = mergedStyle;
  }

  if (testID != null) {
    nextProps.testID = testID;
  }

  if (nativeID != null) {
    nextProps.nativeID = nativeID;
  }

  if (accessibilityLabel != null) {
    nextProps.accessibilityLabel = accessibilityLabel;
  }

  if (accessibilityRole != null) {
    nextProps.accessibilityRole = accessibilityRole;
  }

  if (pointerEvents != null) {
    nextProps.pointerEvents = pointerEvents;
  }

  return nextProps;
}

function createShapeComponent(displayName, target, resolveGeometryStyle) {
  function SvgShape(props) {
    const React = resolveReact(target);
    return React.createElement(
      resolveViewType(target),
      buildHostProps(props, resolveGeometryStyle(props)),
      props?.children,
    );
  }

  SvgShape.displayName = displayName;
  return SvgShape;
}

function createRectStyle(props) {
  const style = {};
  const fill = resolveColor(props?.fill);
  const stroke = resolveColor(props?.stroke);

  if (isFiniteNumber(props?.width)) {
    style.width = props.width;
  }

  if (isFiniteNumber(props?.height)) {
    style.height = props.height;
  }

  const borderRadius = resolveBorderRadius(props);
  if (borderRadius != null) {
    style.borderRadius = borderRadius;
  }

  if (fill) {
    style.backgroundColor = fill;
  }

  if (stroke) {
    style.borderColor = stroke;
    style.borderWidth = isFiniteNumber(props?.strokeWidth) ? props.strokeWidth : 1;
  }

  if (isFiniteNumber(props?.opacity)) {
    style.opacity = props.opacity;
  }

  return style;
}

function createCircleStyle(props) {
  const style = createRectStyle(props);

  if (isFiniteNumber(props?.r)) {
    style.width = props.r * 2;
    style.height = props.r * 2;
    style.borderRadius = props.r;
  }

  return style;
}

function createEllipseStyle(props) {
  const style = createRectStyle(props);

  if (isFiniteNumber(props?.rx)) {
    style.width = props.rx * 2;
  }

  if (isFiniteNumber(props?.ry)) {
    style.height = props.ry * 2;
  }

  if (isFiniteNumber(props?.rx) || isFiniteNumber(props?.ry)) {
    style.borderRadius = Math.max(props?.rx ?? 0, props?.ry ?? 0);
  }

  return style;
}

function createLineStyle(props) {
  const style = {};
  const stroke = resolveColor(props?.stroke) ?? resolveColor(props?.fill);
  const width = isFiniteNumber(props?.x1) && isFiniteNumber(props?.x2)
    ? Math.abs(props.x2 - props.x1)
    : 0;
  const height = isFiniteNumber(props?.y1) && isFiniteNumber(props?.y2)
    ? Math.abs(props.y2 - props.y1)
    : 0;
  const thickness = isFiniteNumber(props?.strokeWidth) ? props.strokeWidth : 1;

  style.width = width || thickness;
  style.height = height || thickness;

  if (stroke) {
    style.backgroundColor = stroke;
  }

  if (isFiniteNumber(props?.opacity)) {
    style.opacity = props.opacity;
  }

  return style;
}

function createPathStyle(props) {
  const style = {};
  const fill = resolveColor(props?.fill);
  const stroke = resolveColor(props?.stroke);
  const thickness = isFiniteNumber(props?.strokeWidth) ? props.strokeWidth : 1;

  style.width = isFiniteNumber(props?.width) ? props.width : thickness;
  style.height = isFiniteNumber(props?.height) ? props.height : thickness;

  if (fill) {
    style.backgroundColor = fill;
  } else if (stroke) {
    style.backgroundColor = stroke;
  }

  if (isFiniteNumber(props?.opacity)) {
    style.opacity = props.opacity;
  }

  return style;
}

function createReactNativeSvgShapesModule(target = globalThis) {
  return {
    Circle: createShapeComponent('Circle', target, createCircleStyle),
    Ellipse: createShapeComponent('Ellipse', target, createEllipseStyle),
    Line: createShapeComponent('Line', target, createLineStyle),
    Path: createShapeComponent('Path', target, createPathStyle),
    Polygon: createShapeComponent('Polygon', target, createPathStyle),
    Polyline: createShapeComponent('Polyline', target, createPathStyle),
    Rect: createShapeComponent('Rect', target, createRectStyle),
  };
}

function installReactNativeSvgShapes(target = globalThis) {
  const registry = ensureRuntimeShimRegistry(target);
  const existingModule = installReactNativeSvgCore(target);
  const shapeModule = createReactNativeSvgShapesModule(target);

  if (existingModule && typeof existingModule === 'object') {
    return mergeRuntimeModule(existingModule, shapeModule);
  }

  registry[MODULE_ID] = shapeModule;
  return shapeModule;
}

module.exports = installReactNativeSvgShapes;
module.exports.install = installReactNativeSvgShapes;
module.exports.applyRuntimeShim = installReactNativeSvgShapes;
module.exports.createReactNativeSvgShapesModule = createReactNativeSvgShapesModule;
module.exports.MODULE_ID = MODULE_ID;
module.exports.RUNTIME_SHIM_REGISTRY_KEY = RUNTIME_SHIM_REGISTRY_KEY;
