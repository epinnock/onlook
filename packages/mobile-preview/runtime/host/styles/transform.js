const IDENTITY_MATRIX = Object.freeze([
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
]);

function cloneIdentityMatrix() {
  return [...IDENTITY_MATRIX];
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function normalizeNumericValue(value) {
  if (isFiniteNumber(value)) {
    return value;
  }

  if (typeof value !== 'string') {
    return null;
  }

  const normalizedValue = value.trim();

  if (!normalizedValue) {
    return null;
  }

  const unitlessValue = normalizedValue.endsWith('px')
    ? normalizedValue.slice(0, -2).trim()
    : normalizedValue;
  const parsedValue = Number(unitlessValue);

  return Number.isFinite(parsedValue) ? parsedValue : null;
}

function normalizeAngleValue(value) {
  if (isFiniteNumber(value)) {
    return value;
  }

  if (typeof value !== 'string') {
    return null;
  }

  const normalizedValue = value.trim().toLowerCase();

  if (normalizedValue.endsWith('deg')) {
    const degrees = Number(normalizedValue.slice(0, -3).trim());
    return Number.isFinite(degrees) ? (degrees * Math.PI) / 180 : null;
  }

  if (normalizedValue.endsWith('rad')) {
    const radians = Number(normalizedValue.slice(0, -3).trim());
    return Number.isFinite(radians) ? radians : null;
  }

  const parsedValue = Number(normalizedValue);
  return Number.isFinite(parsedValue) ? parsedValue : null;
}

function multiplyMatrices(left, right) {
  const nextMatrix = new Array(16).fill(0);

  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      let value = 0;

      for (let index = 0; index < 4; index += 1) {
        value += left[index * 4 + row] * right[column * 4 + index];
      }

      nextMatrix[column * 4 + row] = value;
    }
  }

  return nextMatrix;
}

function createTranslationMatrix(x = 0, y = 0, z = 0) {
  const matrix = cloneIdentityMatrix();
  matrix[12] = x;
  matrix[13] = y;
  matrix[14] = z;
  return matrix;
}

function createScaleMatrix(x = 1, y = 1, z = 1) {
  const matrix = cloneIdentityMatrix();
  matrix[0] = x;
  matrix[5] = y;
  matrix[10] = z;
  return matrix;
}

function createRotateXMatrix(angle) {
  const matrix = cloneIdentityMatrix();
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  matrix[5] = cosine;
  matrix[6] = sine;
  matrix[9] = -sine;
  matrix[10] = cosine;
  return matrix;
}

function createRotateYMatrix(angle) {
  const matrix = cloneIdentityMatrix();
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  matrix[0] = cosine;
  matrix[2] = -sine;
  matrix[8] = sine;
  matrix[10] = cosine;
  return matrix;
}

function createRotateZMatrix(angle) {
  const matrix = cloneIdentityMatrix();
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  matrix[0] = cosine;
  matrix[1] = sine;
  matrix[4] = -sine;
  matrix[5] = cosine;
  return matrix;
}

function createSkewXMatrix(angle) {
  const matrix = cloneIdentityMatrix();
  matrix[4] = Math.tan(angle);
  return matrix;
}

function createSkewYMatrix(angle) {
  const matrix = cloneIdentityMatrix();
  matrix[1] = Math.tan(angle);
  return matrix;
}

function createPerspectiveMatrix(distance) {
  if (distance === 0) {
    return null;
  }

  const matrix = cloneIdentityMatrix();
  matrix[14] = -1 / distance;
  return matrix;
}

function convert2dMatrixTo4d(values) {
  return [
    values[0], values[1], 0, 0,
    values[2], values[3], 0, 0,
    0, 0, 1, 0,
    values[4], values[5], 0, 1,
  ];
}

function normalizeMatrixValues(values) {
  if (!Array.isArray(values)) {
    return null;
  }

  const normalizedValues = values.map(normalizeNumericValue);

  if (normalizedValues.some(value => value == null)) {
    return null;
  }

  if (normalizedValues.length === 16) {
    return normalizedValues;
  }

  if (normalizedValues.length === 6) {
    return convert2dMatrixTo4d(normalizedValues);
  }

  return null;
}

function createEntryMatrix(transform) {
  if (!transform || typeof transform !== 'object' || Array.isArray(transform)) {
    return null;
  }

  const entries = Object.entries(transform);

  if (entries.length !== 1) {
    return null;
  }

  const [key, rawValue] = entries[0];

  switch (key) {
    case 'matrix':
      return normalizeMatrixValues(rawValue);
    case 'perspective': {
      const value = normalizeNumericValue(rawValue);
      return value == null ? null : createPerspectiveMatrix(value);
    }
    case 'rotate':
    case 'rotateZ': {
      const angle = normalizeAngleValue(rawValue);
      return angle == null ? null : createRotateZMatrix(angle);
    }
    case 'rotateX': {
      const angle = normalizeAngleValue(rawValue);
      return angle == null ? null : createRotateXMatrix(angle);
    }
    case 'rotateY': {
      const angle = normalizeAngleValue(rawValue);
      return angle == null ? null : createRotateYMatrix(angle);
    }
    case 'scale': {
      const value = normalizeNumericValue(rawValue);
      return value == null ? null : createScaleMatrix(value, value, 1);
    }
    case 'scaleX': {
      const value = normalizeNumericValue(rawValue);
      return value == null ? null : createScaleMatrix(value, 1, 1);
    }
    case 'scaleY': {
      const value = normalizeNumericValue(rawValue);
      return value == null ? null : createScaleMatrix(1, value, 1);
    }
    case 'skewX': {
      const angle = normalizeAngleValue(rawValue);
      return angle == null ? null : createSkewXMatrix(angle);
    }
    case 'skewY': {
      const angle = normalizeAngleValue(rawValue);
      return angle == null ? null : createSkewYMatrix(angle);
    }
    case 'translateX': {
      const value = normalizeNumericValue(rawValue);
      return value == null ? null : createTranslationMatrix(value, 0, 0);
    }
    case 'translateY': {
      const value = normalizeNumericValue(rawValue);
      return value == null ? null : createTranslationMatrix(0, value, 0);
    }
    default:
      return null;
  }
}

function buildTransformMatrix(transforms) {
  if (!Array.isArray(transforms) || transforms.length === 0) {
    return null;
  }

  let matrix = cloneIdentityMatrix();

  for (const transform of transforms) {
    const entryMatrix = createEntryMatrix(transform);

    if (!entryMatrix) {
      return null;
    }

    matrix = multiplyMatrices(entryMatrix, matrix);
  }

  return matrix;
}

function parseMatrixTransformString(transform) {
  if (typeof transform !== 'string') {
    return null;
  }

  const match = transform.trim().match(/^matrix(3d)?\((.+)\)$/i);

  if (!match) {
    return null;
  }

  const values = match[2].split(',').map(value => value.trim());

  if (match[1]) {
    return values.length === 16 ? normalizeMatrixValues(values) : null;
  }

  return values.length === 6 ? normalizeMatrixValues(values) : null;
}

function resolveTransformStyle(style) {
  if (!style || typeof style !== 'object' || Array.isArray(style)) {
    return style;
  }

  const matrix =
    buildTransformMatrix(style.transform) ??
    parseMatrixTransformString(style.transform) ??
    normalizeMatrixValues(style.transformMatrix);

  if (!matrix) {
    return style;
  }

  const resolvedStyle = {
    ...style,
    transform: [{ matrix }],
  };

  delete resolvedStyle.transformMatrix;

  return resolvedStyle;
}

export default {
  id: 'transform',
  order: 100,
  resolve(style) {
    return resolveTransformStyle(style);
  },
};
