import { resolveControlledTextInputProps } from './text-input-control.js';

const COMPONENT_ID = 'text-input-singleline';
const NATIVE_TYPE = 'RCTSinglelineTextInputView';

function omitMultilineProp(props = {}) {
  if (!props || typeof props !== 'object' || !('multiline' in props)) {
    return props;
  }

  const nextProps = { ...props };
  delete nextProps.multiline;
  return nextProps;
}

function resolveHostTag(context = {}) {
  if (typeof context.tag === 'number') {
    return context.tag;
  }

  if (typeof context.hostTag === 'number') {
    return context.hostTag;
  }

  return null;
}

function mapProps(props = {}, context = {}) {
  const singlelineProps = omitMultilineProp(props);
  const hostTag = resolveHostTag(context);

  if (hostTag == null) {
    return singlelineProps;
  }

  return resolveControlledTextInputProps(hostTag, singlelineProps);
}

const textInputSinglelineHostComponent = {
  id: COMPONENT_ID,
  nativeType: NATIVE_TYPE,
  shouldHandle(type, props) {
    return type === 'TextInput' && !props?.multiline;
  },
  mapProps,
  resolve(type, props, context) {
    return {
      type: NATIVE_TYPE,
      props: mapProps(props, context),
    };
  },
};

export default textInputSinglelineHostComponent;
