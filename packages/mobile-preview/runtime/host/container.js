import { logHost } from './logging.js';
import { registerHostInstanceEventParent } from './events.js';

export function appendHostChild(fab, parentInstance, child) {
  fab.appendChild(parentInstance.node, child.node);
  parentInstance.children.push(child);
  registerHostInstanceEventParent(child?.tag, parentInstance?.tag);
}

export function appendContainerChild(container, child) {
  container.children.push(child);
  registerHostInstanceEventParent(child?.tag, null);
  logHost('HOST appendChildToContainer tag=' + (child && child.tag) + ' total=' + container.children.length);
}

export function removeContainerChild(container, child) {
  container.children = container.children.filter((candidate) => candidate !== child);
  registerHostInstanceEventParent(child?.tag, null);
  logHost('HOST removeChildFromContainer total=' + container.children.length);
}

export function removeHostChild(parentInstance, child) {
  parentInstance.children = parentInstance.children.filter((candidate) => candidate !== child);
  registerHostInstanceEventParent(child?.tag, null);
}

export function insertHostChildBefore(parentInstance, child, beforeChild) {
  const index = parentInstance.children.indexOf(beforeChild);
  if (index >= 0) {
    parentInstance.children.splice(index, 0, child);
    registerHostInstanceEventParent(child?.tag, parentInstance?.tag);
    return;
  }

  parentInstance.children.push(child);
  registerHostInstanceEventParent(child?.tag, parentInstance?.tag);
}

export function insertContainerChildBefore(container, child, beforeChild) {
  const index = container.children.indexOf(beforeChild);
  if (index >= 0) {
    container.children.splice(index, 0, child);
    registerHostInstanceEventParent(child?.tag, null);
    return;
  }

  container.children.push(child);
  registerHostInstanceEventParent(child?.tag, null);
}

export function clearHostContainer(container) {
  container.children = [];
}
