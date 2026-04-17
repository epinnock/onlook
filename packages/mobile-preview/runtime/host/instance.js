import { flattenHostProps } from './props.js';
import { allocTag } from './tags.js';
import { resolveHostComponent } from './components/index.js';
import { registerHostInstanceEventHandlers } from './events.js';

export function createHostInstance(fab, rootTag, type, props, internalHandle) {
  const resolvedComponent = resolveHostComponent(type, props);
  const tag = allocTag();
  const flatProps = flattenHostProps(resolvedComponent.props, { processStyleColors: true });
  const node = fab.createNode(tag, resolvedComponent.type, rootTag, flatProps, internalHandle);
  const handlers = registerHostInstanceEventHandlers(tag, resolvedComponent.props);

  return {
    node,
    tag,
    type: resolvedComponent.type,
    sourceType: type,
    componentId: resolvedComponent.componentId,
    children: [],
    handlers,
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
