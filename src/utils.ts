import { INLINE_ELEMENTS } from "./constants";

export const domUtil = {
  hasClass(el: HTMLElement, className: string) {
    return el.classList.contains(className);
  },
  addClass(el: HTMLElement, className: string) {
    el.classList.add(className);
  },
  removeClass(el: HTMLElement, className: string) {
    el.classList.remove(className);
  },
  toggleClass(el: HTMLElement, className: string) {
    el.classList.toggle(className);
  },
  isInlineElement(tagName: string) {
    return INLINE_ELEMENTS.has(tagName.toLowerCase());
  },
};

export function isObject(test: any) {
  return typeof test === 'object' && !Array.isArray(test) && test !== null;
}
