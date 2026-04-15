function resolvePlatformOS(context = {}) {
  if (typeof context.platform === 'string' && context.platform) {
    return context.platform;
  }

  if (typeof context.target?.Platform?.OS === 'string' && context.target.Platform.OS) {
    return context.target.Platform.OS;
  }

  if (typeof globalThis.Platform?.OS === 'string' && globalThis.Platform.OS) {
    return globalThis.Platform.OS;
  }

  return 'ios';
}

const elevationStyleResolver = {
  id: 'elevation',
  order: 100,
  resolve(style, context) {
    if (!style || typeof style !== 'object' || Array.isArray(style) || !('elevation' in style)) {
      return style;
    }

    if (resolvePlatformOS(context) === 'android') {
      return style;
    }

    const { elevation, ...nextStyle } = style;
    return nextStyle;
  },
};

export default elevationStyleResolver;
