import '@testing-library/jest-dom/vitest';

if (typeof window !== 'undefined') {
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => undefined;
  }

  if (!Element.prototype.scrollTo) {
    Element.prototype.scrollTo = () => undefined;
  }

  if (!navigator.clipboard) {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async () => undefined },
    });
  }
}
