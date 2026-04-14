import { logHost } from './logging.js';

export function appendHostChild(fab, parentInstance, child) {
  fab.appendChild(parentInstance.node, child.node);
  parentInstance.children.push(child);
}

export function appendContainerChild(container, child) {
  container.children.push(child);
  logHost('HOST appendChildToContainer tag=' + (child && child.tag) + ' total=' + container.children.length);
}

export function removeContainerChild(container, child) {
  container.children = container.children.filter((candidate) => candidate !== child);
  logHost('HOST removeChildFromContainer total=' + container.children.length);
}

export function removeHostChild(parentInstance, child) {
  parentInstance.children = parentInstance.children.filter((candidate) => candidate !== child);
}

export function insertHostChildBefore(parentInstance, child, beforeChild) {
  const index = parentInstance.children.indexOf(beforeChild);
  if (index >= 0) {
    parentInstance.children.splice(index, 0, child);
    return;
  }

  parentInstance.children.push(child);
}

export function insertContainerChildBefore(container, child, beforeChild) {
  const index = container.children.indexOf(beforeChild);
  if (index >= 0) {
    container.children.splice(index, 0, child);
    return;
  }

  container.children.push(child);
}

export function clearHostContainer(container) {
  container.children = [];
}
