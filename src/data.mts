import {
  timestamp as normalizeTimestamp,
  defaultTimestamp as defaultDate,
} from './domain/values.mjs';
import { validateQueue as normalizeQueue } from './domain/queue.mjs';
export { id } from './domain/values.mjs';
export { parseJSON } from './adapters/json.mjs';
export { readQueue, saveQueue, withQueueLock } from './adapters/queue-files.mjs';
export function timestamp(value: unknown, now = Date.now()) {
  return normalizeTimestamp(value, now);
}
export function defaultTimestamp(now = Date.now()) {
  return defaultDate(now);
}
export function validateQueue(value: unknown, now = Date.now()) {
  return normalizeQueue(value, now);
}
