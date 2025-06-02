// test/domParser.matchesRule.test.ts

import { DOMParser as RitorDOMParser } from '../src/domParser.js'; // Renamed to avoid conflict with global DOMParser
import { Schema } from '../src/schema.js';
import { basicNodeSpecs, basicMarkSpecs } from '../src/basicSchema.js';
import { ParseRule } from '../src/schemaSpec.js';

// A schema instance is needed for the DOMParser constructor
const schema = new Schema({ nodes: basicNodeSpecs, marks: basicMarkSpecs });
const domParser = new RitorDOMParser(schema); // Instance of our parser

// Helper function to create mock HTMLElements
const mockElement = (
    tagName: string, 
    attrs: Record<string, string> = {}, 
    classList: string[] = [], 
    styles: Record<string, string> = {}
): HTMLElement => {
    const el = document.createElement(tagName);
    for (const key in attrs) {
        el.setAttribute(key, attrs[key]);
    }
    el.className = classList.join(' ');
    for (const styleKey in styles) {
        // Important: jsdom's `el.style` might not directly reflect all CSS properties
        // for getComputedStyle unless they are standard and jsdom supports them fully.
        // For direct `el.style.fontWeight` access, use camelCase.
        (el.style as any)[styleKey] = styles[styleKey];
    }
    return el;
};

describe('DOMParser.matchesRule', () => {
    describe('Tag Matching', () => {
        it('should match simple tags', () => {
            const rule: ParseRule = { tag: "p" };
            expect(domParser.matchesRule(mockElement("p"), rule)).toBe(true);
            expect(domParser.matchesRule(mockElement("div"), rule)).toBe(false);
        });

        it('should match wildcard tag', () => {
            const rule: ParseRule = { tag: "*" };
            expect(domParser.matchesRule(mockElement("p"), rule)).toBe(true);
            expect(domParser.matchesRule(mockElement("div"), rule)).toBe(true);
            expect(domParser.matchesRule(mockElement("span"), rule)).toBe(true);
        });
    });

    describe('Attribute Selectors', () => {
        it('should match attribute presence', () => {
            const rule: ParseRule = { tag: "a[href]" };
            expect(domParser.matchesRule(mockElement("a", { href: "..." }), rule)).toBe(true);
            expect(domParser.matchesRule(mockElement("a"), rule)).toBe(false); // No href
            expect(domParser.matchesRule(mockElement("div", { href: "..." }), rule)).toBe(false); // Wrong tag
        });

        it('should match specific attribute value', () => {
            const rule: ParseRule = { tag: "input[type=text]" };
            expect(domParser.matchesRule(mockElement("input", { type: "text" }), rule)).toBe(true);
            expect(domParser.matchesRule(mockElement("input", { type: "password" }), rule)).toBe(false);
            expect(domParser.matchesRule(mockElement("input", { type: "text", name: "q" }), rule)).toBe(true);
        });

        it('should match specific attribute value with quotes in rule', () => {
            const rule: ParseRule = { tag: 'input[value="foo"]' };
            const rule2: ParseRule = { tag: "input[value='bar']" };
            expect(domParser.matchesRule(mockElement("input", { value: "foo" }), rule)).toBe(true);
            expect(domParser.matchesRule(mockElement("input", { value: "bar" }), rule2)).toBe(true);
            expect(domParser.matchesRule(mockElement("input", { value: "baz" }), rule)).toBe(false);
        });
        
        it('should match tag with attribute presence', () => {
            const rule: ParseRule = { tag: "div[data-type]" };
            expect(domParser.matchesRule(mockElement("div", { "data-type": "image" }), rule)).toBe(true);
            expect(domParser.matchesRule(mockElement("div"), rule)).toBe(false);
        });
    });

    describe('Class Selectors', () => {
        it('should match single class', () => {
            const rule: ParseRule = { tag: "div.foo" };
            expect(domParser.matchesRule(mockElement("div", {}, ["foo"]), rule)).toBe(true);
            expect(domParser.matchesRule(mockElement("div", {}, ["bar"]), rule)).toBe(false);
            expect(domParser.matchesRule(mockElement("div", {}, ["foo", "bar"]), rule)).toBe(true);
        });

        it('should match multiple classes', () => {
            const rule: ParseRule = { tag: "p.foo.bar" };
            expect(domParser.matchesRule(mockElement("p", {}, ["foo", "bar"]), rule)).toBe(true);
            expect(domParser.matchesRule(mockElement("p", {}, ["foo", "bar", "baz"]), rule)).toBe(true);
            expect(domParser.matchesRule(mockElement("p", {}, ["foo"]), rule)).toBe(false);
        });

        it('should match class only selector', () => {
            const rule: ParseRule = { tag: ".highlight" }; // Element name is effectively "*"
            expect(domParser.matchesRule(mockElement("span", {}, ["highlight"]), rule)).toBe(true);
            expect(domParser.matchesRule(mockElement("div", {}, ["highlight"]), rule)).toBe(true);
            expect(domParser.matchesRule(mockElement("span", {}, ["other"]), rule)).toBe(false);
        });
    });

    describe('Combined Selectors', () => {
        it('should match tag, class, and attribute presence', () => {
            const rule: ParseRule = { tag: "a.external[href]" };
            expect(domParser.matchesRule(mockElement("a", { href: "..." }, ["external"]), rule)).toBe(true);
            expect(domParser.matchesRule(mockElement("a", { href: "..." }, ["internal", "external"]), rule)).toBe(true);
            expect(domParser.matchesRule(mockElement("a", {}, ["external"]), rule)).toBe(false); // No href
            expect(domParser.matchesRule(mockElement("a", { href: "..." }), rule)).toBe(false); // No class
            expect(domParser.matchesRule(mockElement("div", { href: "..." }, ["external"]), rule)).toBe(false); // Wrong tag
        });

        it('should match tag, class, and attribute value', () => {
            const rule: ParseRule = { tag: "img.special[data-id=test-123]" };
            expect(domParser.matchesRule(mockElement("img", {"data-id": "test-123"}, ["special"]), rule)).toBe(true);
            expect(domParser.matchesRule(mockElement("img", {"data-id": "test-456"}, ["special"]), rule)).toBe(false); // Wrong attr value
        });
    });

    describe('Style Matching', () => {
        // Note: jsdom's `element.style` and `getComputedStyle` might behave differently than a browser.
        // These tests assume basic functionality.
        it('should match simple inline style (font-weight: bold)', () => {
            const rule: ParseRule = { style: "font-weight=bold" };
            expect(domParser.matchesRule(mockElement("strong", {}, [], { fontWeight: "bold" }), rule)).toBe(true);
            // jsdom might not set element.style.fontWeight for <b>, but getComputedStyle should work
            const bElement = mockElement("b");
            // Manually set style for jsdom limitation if needed, or rely on getComputedStyle if it's smart
            // For <b>, browser's getComputedStyle(bElement).fontWeight would be "bold" or "700"
            // This test relies on the getComputedStyle fallback in matchesRule
            expect(domParser.matchesRule(bElement, rule)).toBe(true); 
        });

        it('should match simple inline style (font-weight: 700 for bold)', () => {
            const rule: ParseRule = { style: "font-weight=bold" }; // Rule expects "bold"
            // matchesRule has specific logic to equate "700" from computedStyle with "bold"
            const el = mockElement("span", {}, [], { fontWeight: "700" });
            // If jsdom's element.style.fontWeight returns "700", this will pass via inline check.
            // If not, it relies on getComputedStyle.
            expect(domParser.matchesRule(el, rule)).toBe(true);
        });
        
        it('should match simple inline style (font-weight: normal)', () => {
            const rule: ParseRule = { style: "font-weight=normal" };
            expect(domParser.matchesRule(mockElement("span", {}, [], { fontWeight: "normal" }), rule)).toBe(true);
        });

        it('should match simple inline style (font-style: italic)', () => {
            const rule: ParseRule = { style: "font-style=italic" };
            expect(domParser.matchesRule(mockElement("em", {}, [], { fontStyle: "italic" }), rule)).toBe(true);
            const iElement = mockElement("i");
            // Similar to <b>, relies on getComputedStyle fallback in matchesRule for <i>
            expect(domParser.matchesRule(iElement, rule)).toBe(true);
        });
        
         it('should match simple inline style (font-style: oblique for italic)', () => {
            const rule: ParseRule = { style: "font-style=italic" };
            const el = mockElement("span", {}, [], { fontStyle: "oblique" });
            expect(domParser.matchesRule(el, rule)).toBe(true);
        });

        it('should not match incorrect style value', () => {
            const rule: ParseRule = { style: "font-weight=bold" };
            expect(domParser.matchesRule(mockElement("span", {}, [], { fontWeight: "normal" }), rule)).toBe(false);
        });

        it('should return false for malformed style rule', () => {
            const rule: ParseRule = { style: "font-weight" }; // Missing value
            expect(domParser.matchesRule(mockElement("span", {}, [], { fontWeight: "bold" }), rule)).toBe(false);
        });
    });

    describe('Rule Specificity and Order', () => {
        it('should prioritize tag match: if tag matches, style is not checked by that rule', () => {
            // Rule requires tag 'strong' and has a style. Element matches tag but not style.
            const rule: ParseRule = { tag: "strong", style: "color=red" };
            // Element is a strong, but its color is not red. matchesRule should return true based on tag.
            expect(domParser.matchesRule(mockElement("strong", {}, [], { color: "blue" }), rule)).toBe(true);
        });

        it('should check style if tag does not match', () => {
            // Rule requires tag 'em' but has a style. Element is not 'em' but matches style.
            const rule: ParseRule = { tag: "em", style: "font-style=italic" };
             // Element is a span, but has italic style. matchesRule should return false as tag mismatches.
            expect(domParser.matchesRule(mockElement("span", {}, [], { fontStyle: "italic" }), rule)).toBe(false);
        });
        
        it('should check style if tag is not present in rule', () => {
            const rule: ParseRule = { style: "font-style=italic" };
            expect(domParser.matchesRule(mockElement("span", {}, [], { fontStyle: "italic" }), rule)).toBe(true);
            expect(domParser.matchesRule(mockElement("div", {}, [], { fontStyle: "normal" }), rule)).toBe(false);
        });

        it('should return false if neither tag nor style rule is present', () => {
            const rule: ParseRule = {}; // Empty rule
            expect(domParser.matchesRule(mockElement("p"), rule)).toBe(false);
        });
    });
});
