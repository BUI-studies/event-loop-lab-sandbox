import type { HeapPromise } from './types';

const URL_DISPLAY_LIMIT = 22;
const URL_DISPLAY_KEEP = 20;

/** Keeps `fetch(...)` labels short enough to fit a queue item on one line. */
export const truncateUrl = (url: string): string =>
  url.length > URL_DISPLAY_LIMIT ? `${url.slice(0, URL_DISPLAY_KEEP)}…` : url;

/**
 * Structural check rather than `instanceof`: the promise class is built per
 * world, so there is no single constructor to compare against.
 */
export const isHeapPromise = (value: unknown): value is HeapPromise =>
  typeof value === 'object' && value !== null && (value as HeapPromise).kind === 'promise';

/** Renders a value the way the mock console and the heap panel show it. */
export const formatValue = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (isHeapPromise(value)) return `«${value.label}:${value.state}»`;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
};
