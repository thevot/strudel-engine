/**
 * Open AGPL Strudel Engine Message Driver (IPC / Worker Proxy)
 */

import * as AGPLBridge from './agpl-bridge.js';
import { ENGINE_ACTIONS } from './types.js';
import { createResponse } from './protocol.js';

class EngineMessageDispatcher extends EventTarget {
  async handleRequest(request) {
    const { id, action, payload } = request;
    try {
      let result = null;
      switch (action) {
        case ENGINE_ACTIONS.INIT:
          await AGPLBridge.init();
          result = { initialized: true };
          break;

        case ENGINE_ACTIONS.EVALUATE:
          result = await AGPLBridge.evaluate(payload.code);
          break;

        case ENGINE_ACTIONS.EVALUATE_ALL:
          result = await AGPLBridge.evaluateAll(
            payload.tracks,
            payload.bpm,
            payload.options
          );
          break;

        case ENGINE_ACTIONS.STOP:
          await AGPLBridge.stop();
          result = { stopped: true };
          break;

        case ENGINE_ACTIONS.PREVIEW_SOUND:
          result = await AGPLBridge.previewSound(payload.sampleName);
          break;

        case ENGINE_ACTIONS.STOP_PREVIEW:
          AGPLBridge.stopPreview();
          result = { stopped: true };
          break;

        case ENGINE_ACTIONS.PREVIEW_NOTE:
          AGPLBridge.previewNote(payload.midiNote, payload.durationSec);
          result = { previewed: true };
          break;

        case ENGINE_ACTIONS.PREVIEW_DRUM:
          await AGPLBridge.previewDrum(payload.sampleName);
          result = { previewed: true };
          break;

        case ENGINE_ACTIONS.SET_CPS:
          await AGPLBridge.setCps(payload.cps);
          result = { cps: payload.cps };
          break;

        case ENGINE_ACTIONS.SET_PLAY_STATE:
          AGPLBridge.setEnginePlayState(payload.playing);
          result = { playing: payload.playing };
          break;

        case ENGINE_ACTIONS.GET_STATUS:
          result = {
            initialized: AGPLBridge.isInitialized(),
            currentCps: AGPLBridge.getCurrentCps(),
            playbackStartTime: AGPLBridge.getPlaybackStartTime(),
          };
          break;

        default:
          throw new Error(`Unknown engine action: ${action}`);
      }

      return createResponse(id, action, result, null);
    } catch (err) {
      console.error(`[WorkerDriver] Error handling action ${action}:`, err);
      return createResponse(id, action, null, err);
    }
  }
}

export const engineDispatcher = new EngineMessageDispatcher();
