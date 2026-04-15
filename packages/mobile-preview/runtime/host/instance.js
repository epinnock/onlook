import { flattenHostProps } from './props.js';
import { allocTag } from './tags.js';
import { resolveHostComponent } from './components/index.js';

export function createHostInstance(fab, rootTag, type, props, internalHandle) {
  const resolvedComponent = resolveHostComponent(type, props);
  const tag = allocTag();
  const flatProps = flattenHostProps(resolvedComponent.props, { processStyleColors: true });
  const node = fab.createNode(tag, resolvedComponent.type, rootTag, flatProps, internalHandle);

  return {
    node,
    tag,
    type: resolvedComponent.type,
    sourceType: type,
    componentId: resolvedComponent.componentId,
    children: [],
  };
}

export function createTextHostInstance(fab, rootTag, text, internalHandle) {
  const tag = allocTag();
  const node = fab.createNode(
    tag,
    'RCTRawText',
    rootTag,
    { text: String(text) },
    internalHandle,
  );

  return { node, tag, type: 'RCTRawText', children: [], text };
}
