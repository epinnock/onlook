import { commitContainerChildren } from './commit.js';
import {
  appendContainerChild,
  appendHostChild,
  clearHostContainer,
  insertContainerChildBefore,
  insertHostChildBefore,
  removeContainerChild,
  removeHostChild,
} from './container.js';
import { diffHostProps } from './props.js';
import { STATIC_HOST_CONFIG } from './static-config.js';
import { createHostInstance, createTextHostInstance } from './instance.js';

export function createHostConfig(fab, rootTag) {
  return {
    createInstance(type, props, rootContainerInstance, hostContext, internalHandle) {
      return createHostInstance(fab, rootTag, type, props, internalHandle);
    },

    createTextInstance(text, rootContainerInstance, hostContext, internalHandle) {
      return createTextHostInstance(fab, rootTag, text, internalHandle);
    },

    appendInitialChild(parentInstance, child) {
      appendHostChild(fab, parentInstance, child);
    },

    appendChild(parentInstance, child) {
      appendHostChild(fab, parentInstance, child);
    },

    appendChildToContainer(container, child) {
      appendContainerChild(container, child);
    },

    removeChildFromContainer(container, child) {
      removeContainerChild(container, child);
    },

    removeChild(parentInstance, child) {
      removeHostChild(parentInstance, child);
    },

    insertBefore(parentInstance, child, beforeChild) {
      insertHostChildBefore(parentInstance, child, beforeChild);
    },

    insertInContainerBefore(container, child, beforeChild) {
      insertContainerChildBefore(container, child, beforeChild);
    },

    resetAfterCommit(container) {
      commitContainerChildren(fab, rootTag, container);
    },

    prepareUpdate(instance, type, oldProps, newProps) {
      return diffHostProps(oldProps, newProps);
    },

    commitUpdate(instance, updatePayload, type, prevProps, nextProps, internalHandle) {
      const flatProps = flattenHostProps(updatePayload);
      instance.node = fab.cloneNodeWithNewProps(instance.node, flatProps);
    },

    commitTextUpdate(textInstance, oldText, newText) {
      textInstance.node = fab.cloneNodeWithNewProps(textInstance.node, { text: newText });
      textInstance.text = newText;
    },

    clearContainer(container) {
      clearHostContainer(container);
    },

    ...STATIC_HOST_CONFIG,
  };
}
