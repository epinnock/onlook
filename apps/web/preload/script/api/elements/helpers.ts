import { EditorAttributes } from '@onlook/constants';
import type { DomElement, ParentDomElement } from '@onlook/models';
import type { ActionLocation } from '@onlook/models/actions';
import { getInstanceId, getOid } from '../../helpers/ids';
import { getFrameId, getBranchId } from '../state';
import { getStyles } from './style';

export const getDeepElement = (x: number, y: number): Element | undefined => {
    const el = document.elementFromPoint(x, y);
    if (!el) {
        return;
    }
    const crawlShadows = (node: Element): Element => {
        if (node?.shadowRoot) {
            const potential = node.shadowRoot.elementFromPoint(x, y);
            if (potential == node) {
                return node;
            } else if (potential?.shadowRoot) {
                return crawlShadows(potential);
            } else {
                return potential || node;
            }
        } else {
            return node;
        }
    };

    const nested_shadow = crawlShadows(el);
    return nested_shadow || el;
};

export const findNearestOidElement = (el: HTMLElement | null): HTMLElement | null => {
    let current: HTMLElement | null = el;
    while (current) {
        if (
            current.getAttribute(EditorAttributes.DATA_ONLOOK_ID) ||
            current.getAttribute(EditorAttributes.DATA_ONLOOK_INSTANCE_ID)
        ) {
            return current;
        }
        current = current.parentElement;
    }
    return null;
};

export const getDomElement = (el: HTMLElement, getStyle: boolean): DomElement => {
    const target = findNearestOidElement(el) ?? el;
    const parent = target.parentElement;
    const parentDomElement: ParentDomElement | null = parent
        ? {
            domId: parent.getAttribute(EditorAttributes.DATA_ONLOOK_DOM_ID) as string,
            frameId: getFrameId(),
            branchId: getBranchId(),
            oid: getInstanceId(parent) || getOid(parent) || '',
            instanceId: parent.getAttribute(EditorAttributes.DATA_ONLOOK_INSTANCE_ID) as string,
            rect: parent.getBoundingClientRect(),
        }
        : null;

    const rect = target.getBoundingClientRect();
    const styles = getStyle ? getStyles(target) : null;
    const domElement: DomElement = {
        domId: target.getAttribute(EditorAttributes.DATA_ONLOOK_DOM_ID) as string,
        oid: getInstanceId(target) || getOid(target) || '',
        frameId: getFrameId(),
        branchId: getBranchId(),
        instanceId: target.getAttribute(EditorAttributes.DATA_ONLOOK_INSTANCE_ID) as string,
        rect,
        tagName: target.tagName,
        parent: parentDomElement,
        styles,
    };
    return domElement;
};

export function restoreElementStyle(el: HTMLElement) {
    try {
        const saved = el.getAttribute(EditorAttributes.DATA_ONLOOK_DRAG_SAVED_STYLE);
        if (saved) {
            const style = JSON.parse(saved);
            for (const key in style) {
                el.style[key as any] = style[key];
            }
        }
    } catch (e) {
        console.warn('Error restoring style', e);
    }
}

export function getElementLocation(targetEl: HTMLElement): ActionLocation | undefined {
    const parent = targetEl.parentElement;
    if (!parent) {
        return;
    }

    const location: ActionLocation = {
        type: 'index',
        targetDomId: parent.getAttribute(EditorAttributes.DATA_ONLOOK_DOM_ID) as string,
        targetOid: getInstanceId(parent) || getOid(parent) || null,
        index: Array.from(targetEl.parentElement?.children || []).indexOf(targetEl),
        originalIndex: Array.from(targetEl.parentElement?.children || []).indexOf(targetEl),
    };
    return location;
}

export const getImmediateTextContent = (el: HTMLElement): string | undefined => {
    const stringArr = Array.from(el.childNodes)
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.textContent);

    if (stringArr.length === 0) {
        return;
    }
    return stringArr.join('');
};
