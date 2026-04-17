import { refreshHostInstanceEventHandlers } from './events.js';
import { flattenHostProps } from './props.js';

export function commitHostInstanceUpdate(
  fab,
  instance,
  updatePayload,
  nextProps = updatePayload,
) {
  const flatProps = flattenHostProps(updatePayload ?? {});
  instance.node = fab.cloneNodeWithNewProps(instance.node, flatProps);
  instance.handlers = refreshHostInstanceEventHandlers(instance.tag, nextProps);

  return instance;
}
