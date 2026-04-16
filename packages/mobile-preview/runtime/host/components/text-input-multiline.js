import { resolveControlledTextInputProps } from './text-input-control.js';

function hashStringToTag(value) {
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
  }

  return Math.abs(hash) + 1;
}

function getTextInputControlTag(props = {}, context = {}) {
  if (typeof context.targetTag === 'number') {
    return context.targetTag;
  }

  if (typeof props.__onlookTag === 'number') {
    return props.__onlookTag;
  }

  const stableId =
    typeof props.nativeID === 'string' && props.nativeID
      ? props.nativeID
      : typeof props.testID === 'string' && props.testID
        ? props.testID
        : null;

  if (!stableId) {
    return null;
  }

  return hashStringToTag(`text-input-multiline:${stableId}`);
}

function mapProps(props = {}, context = {}) {
  const controlTag = getTextInputControlTag(props, context);
  const nextProps =
    controlTag != null
      ? resolveControlledTextInputProps(controlTag, props)
      : { ...props };

  return {
    ...nextProps,
    multiline: true,
  };
}

export default {
  nativeType: 'RCTMultilineTextInputView',
  mapProps,
};

export function __getTextInputMultilineControlTagForTests(props = {}, context = {}) {
  return getTextInputControlTag(props, context);
}
