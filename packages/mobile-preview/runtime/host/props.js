const RESERVED_PROP_KEYS = new Set(['children', 'ref', 'key']);
const COLOR_STYLE_KEYS = new Set(['backgroundColor', 'color', 'borderColor']);

function processColor(color) {
  if (typeof color === 'number') {
    return color | 0;
  }

  return color;
}

function flattenStyle(style, flatProps, processStyleColors) {
  if (!style) {
    return;
  }

  const styles = Array.isArray(style) ? Object.assign({}, ...style) : style;
  for (const styleKey in styles) {
    let value = styles[styleKey];
    if (processStyleColors && COLOR_STYLE_KEYS.has(styleKey)) {
      value = processColor(value);
    }

    flatProps[styleKey] = value;
  }
}

export function flattenHostProps(props, { processStyleColors = false } = {}) {
  const flatProps = {};

  for (const key in props) {
    if (RESERVED_PROP_KEYS.has(key)) {
      continue;
    }

    if (key === 'style') {
      flattenStyle(props.style, flatProps, processStyleColors);
      continue;
    }

    flatProps[key] = props[key];
  }

  return flatProps;
}

export function diffHostProps(oldProps, newProps) {
  let updatePayload = null;

  for (const key in newProps) {
    if (RESERVED_PROP_KEYS.has(key)) {
      continue;
    }

    if (newProps[key] !== oldProps[key]) {
      if (!updatePayload) {
        updatePayload = {};
      }

      updatePayload[key] = newProps[key];
    }
  }

  return updatePayload;
}
