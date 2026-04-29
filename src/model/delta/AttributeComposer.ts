import { OpAttributes } from '../../Document';

class AttributeComposer {
  public static compose(a?: OpAttributes, b?: OpAttributes, keepNull: boolean = false): OpAttributes | undefined {
    if (typeof a !== 'object' && a !== undefined) a = {};
    if (typeof b !== 'object' && b !== undefined) b = {};

    const attrsA = a || {};
    const attrsB = b || {};

    const attributes: OpAttributes = { ...attrsA };
    for (const key in attrsB) {
      if (attrsB.hasOwnProperty(key)) {
        attributes[key] = attrsB[key];
      }
    }

    if (!keepNull) {
      for (const key in attributes) {
        if (attributes.hasOwnProperty(key) && attributes[key] === null) {
          delete attributes[key];
        }
      }
    }

    return Object.keys(attributes).length > 0 ? attributes : undefined;
  }
}

export default AttributeComposer;
