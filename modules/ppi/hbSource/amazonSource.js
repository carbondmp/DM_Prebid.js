import { deepAccess, isFn, logError, logInfo, logWarn } from '../../../src/utils.js';
import { config } from '../../../src/config.js';

export function fetchBids(matchObjects, callback) {
  if (!isFn(deepAccess(window, 'apstag.fetchBids'))) {
    logError(`apstag.js library is not loaded on the page. Please load and initialize the library before calling amazon to fetch bids. Continuing without amazon bids.`);
    callback();
    return;
  }

  let slots = createAmazonSlots(matchObjects);
  if (!slots.length) {
    logWarn(`Couldn't create amazon slots to fetch bids. Continuing without amazon bids.`)
    callback();
    return;
  }

  let callbackExecuted = false;

  let apstagTimeout = config.getConfig('bidderTimeout');

  let timeoutId = setTimeout(() => {
    logError(`Didn't receive response from apstag for ${apstagTimeout} ms. Continuing without amazon bids.`);
    callbackExecuted = true;
    callback();
  }, apstagTimeout);
  window.apstag.fetchBids({ slots }, (bids) => {
    if (callbackExecuted) {
      logWarn(`Callback was already executed, bids arrived too late. Continuing without amazon bids.`);
      return;
    }
    logInfo(`Received amazon bids: `, bids);
    callbackExecuted = true;
    clearTimeout(timeoutId);
    callback();
  });
}

function getDivIdSlotNameMapping() {
  let mappings = {};
  window.googletag.pubads().getSlots().forEach(slot => {
    mappings[slot.getSlotElementId()] = slot.getAdUnitPath();
  });

  return mappings;
}

export function createAmazonSlots(matchObjects) {
  let mappings = getDivIdSlotNameMapping();
  let amazonSlots = [];

  matchObjects.forEach(matchObject => {
    let slotID = deepAccess(matchObject.transactionObject, 'hbDestination.values.div') || matchObject.transactionObject.divId;
    let slotName = matchObject.transactionObject.slotName;
    if (!slotName) {
      slotName = mappings[slotID];
    }

    if (!slotID || !slotName) {
      logWarn(`Couldn't find div id (${slotID}) or slot name (${slotName}), will not request bids from amazon for this transaction object`);
      return;
    }

    amazonSlots.push({
      slotID,
      slotName,
      sizes: deepAccess(matchObject.adUnit, 'mediaTypes.banner.sizes'),
    });
  });

  return amazonSlots;
}

export function setTargeting() {
  window.apstag.setDisplayBids();
}
