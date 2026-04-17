import { logHost } from './logging.js';

export function commitContainerChildren(fab, rootTag, container) {
  logHost('HOST resetAfterCommit children=' + (container.children ? container.children.length : 'none'));

  const childSet = fab.createChildSet(rootTag);
  let count = 0;
  if (container.children) {
    for (const child of container.children) {
      logHost(
        'HOST appendToSet child tag=' +
          (child && child.tag) +
          ' type=' +
          (child && child.type) +
          ' node=' +
          typeof (child && child.node),
      );
      fab.appendChildToSet(childSet, child.node);
      count++;
    }
  }

  logHost('HOST completeRoot rootTag=' + rootTag + ' count=' + count);
  fab.completeRoot(rootTag, childSet);
  logHost('HOST completeRoot DONE');
}
