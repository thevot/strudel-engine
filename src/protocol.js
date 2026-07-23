/**
 * Open AGPL Strudel Engine Message Protocol Helpers
 */

import { ENGINE_ACTIONS, ENGINE_EVENTS } from './types.js';

let requestIdCounter = 0;

export function createRequest(action, payload = {}) {
  requestIdCounter += 1;
  return {
    id: `req_${Date.now()}_${requestIdCounter}`,
    action,
    payload,
    timestamp: Date.now(),
  };
}

export function createResponse(reqId, action, result = null, error = null) {
  return {
    id: reqId,
    action,
    result,
    error: error ? String(error?.message || error) : null,
    timestamp: Date.now(),
  };
}

export function createEvent(event, payload = {}) {
  return {
    event,
    payload,
    timestamp: Date.now(),
  };
}
