import { deepAccess, isFn, logError, logInfo, logWarn } from '../../../src/utils.js';
import { getDivIdGPTSlotMapping } from '../hbDestination/gptDestination.js';

const APSTAG_TIMEOUT = 5000;

export function fetchBids(matchObjects, callback) {
  if (!isFn(deepAccess(window, 'apstag.fetchBids'))) {
    logError(`apstag.js library is not loaded on the page. Please load and initialize the library before calling amazon to fetch bids. Continuing without amazon bids`);
    return callback();
  }

  let slots = createAmazonSlots(matchObjects);
  let callbackExecuted = false;

  let timeoutId = setTimeout(() => {
    if (!callbackExecuted) {
      logError(`Didn't receive response from apstag for ${APSTAG_TIMEOUT} ms. Continuing without amazon bids.`);
      callbackExecuted = true;
      callback();
    }
  }, APSTAG_TIMEOUT);
  window.apstag.fetchBids({ slots }, (bids) => {
    if (callbackExecuted) {
      logWarn(`Callback was already executed, bids arrived too late. Continuing without amazon bids`);
      return;
    }
    logInfo(`Received amazon bids: `, bids);
    callbackExecuted = true;
    clearTimeout(timeoutId);
    callback();
  });
}

export function createAmazonSlots(matchObjects) {
  let mappings = getDivIdGPTSlotMapping();
  return matchObjects.map(matchObject => {
    let slotID = matchObject.transactionObject.hbDestination.values.div || matchObject.transactionObject.divId;
    let slotName = matchObject.transactionObject.slotName;
    if (!slotName) {
      let slot = mappings[slotID];
      if (slot) {
        slotName = slot.getAdUnitPath();
      }
    }
    return {
      slotID,
      slotName,
      sizes: deepAccess(matchObject.adUnit, 'mediaTypes.banner.sizes'),
    }
  });
}

export function setTargeting() {
  window.apstag.setDisplayBids();
}
