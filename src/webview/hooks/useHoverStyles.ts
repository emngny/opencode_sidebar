import { MouseEvent, useCallback } from 'react';

export const hover = (style: React.CSSProperties) => (e: MouseEvent<HTMLElement>) => {
  Object.assign(e.currentTarget.style, style);
};

export const unhover = () => (e: MouseEvent<HTMLElement>) => {
  e.currentTarget.style.cssText = '';
};

export const setColor = (color: string) => (e: MouseEvent<HTMLElement>) => {
  e.currentTarget.style.color = color;
};

export const clearStyle = (e: MouseEvent<HTMLElement>) => {
  e.currentTarget.style.cssText = '';
};