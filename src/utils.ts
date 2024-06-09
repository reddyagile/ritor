const INLINE_ELEMENTS = ['A', 'B', 'STRONG', 'I', 'EM', 'U', 'SPAN'];

export const domUtil = {
  hasClass(el: HTMLElement, className: string) {
    if (el.classList) {
      return el.classList.contains(className);
    } else {
      return !!el.className.match(new RegExp('(\\s|^)' + className + '(\\s|$)'));
    }
  },
  addClass(el: HTMLElement, className: string) {
    if (el.classList) {
      el.classList.add(className);
    } else if (!this.hasClass(el, className)) {
      el.className += ' ' + className;
    }
  },
  removeClass(el: HTMLElement, className: string) {
    if (el.classList) {
      el.classList.remove(className);
    } else if (this.hasClass(el, className)) {
      var reg = new RegExp('(\\s|^)' + className + '(\\s|$)');
      el.className = el.className.replace(reg, '');
    }
  },
  toggleClass(el: HTMLElement, className: string) {
    if (this.hasClass(el, className)) {
      this.removeClass(el, className);
    } else {
      this.addClass(el, className);
    }
  },

  isInlineElement(tagName: string) {
    return INLINE_ELEMENTS.indexOf(tagName) > -1;
  },
};

export function isObject(test: any) {
  return typeof test === 'object' && !Array.isArray(test) && test !== null;
}
