import * as utils from '../../src/utils.js';
import { hashFnv32a } from './utils.js';
import { getGlobal } from '../../src/prebidGlobal.js';
import { TransactionType, HBSource, HBDestination } from './consts.js';
import { send } from './destination/destination.js';

/**
 * @param {(Object[])} transactionObjects array of adUnit codes to refresh.
 */
export function requestBids(transactionObjects) {
  let validationResult = validateTransactionObjects(transactionObjects);
  let transactionResult = [];
  validationResult.invalid.forEach(inv => {
    utils.logError(`[PPI] provided invalid transaction object`, inv);
    transactionResult.push(inv);
  });

  let allTOs = validationResult.valid.filter(to => { return to.type !== TransactionType.AUTO_SLOTS });
  allTOs = allTOs.concat(transformAutoSlots(validationResult.valid.filter(to => { return to.type === TransactionType.AUTO_SLOTS })));

  let groupedTransactionObjects = groupTransactionObjects(allTOs);
  for (const source in groupedTransactionObjects) {
    for (const dest in groupedTransactionObjects[source]) {
      let destObjects = []; // TODO: rename
      let toAUPPair = getTOAUPPair(groupedTransactionObjects[source][dest], adUnitPatterns);
      toAUPPair.forEach(toAUP => {
        let aup = toAUP.adUnitPattern;
        let to = toAUP.transactionObject;
        let au;
        if (aup) {
          au = createAdUnit(aup, to.sizes);
          applyFirstPartyData(au, aup, to);
        }

        let tr = createTransactionResult(to, aup);
        destObjects.push({
          adUnit: au,
          transactionObject: tr,
        });
        transactionResult.push(tr);
      });

      switch (source) {
        case HBSource.CACHE:
          send(dest, destObjects);
          break;
        case HBSource.AUCTION:
          getGlobal().requestBids({
            adUnits: destObjects.filter(d => d.adUnit).map(destObj => destObj.adUnit),
            bidsBackHandler: (bids) => {
              utils.logInfo('[PPI] - bids from bids back handler: ', bids);
              send(dest, destObjects);
            }
          });
          break;
      }
    }
  }

  return transactionResult;
}

function getGPTSlotName(transactionObject, adUnitPattern) {
  switch (transactionObject.type) {
    case TransactionType.SLOT:
      return transactionObject.value;
    case TransactionType.DIV:
      // TODO: check if .*^$ are valid regex markers
      let isRegex = ['.', '*', '^', '$'].some(p => adUnitPattern.slotPattern.indexOf(p) !== -1);
      return isRegex ? '' : adUnitPattern.slotPattern;
    case TransactionType.SLOT_OBJECT:
      return transactionObject.value.getAdUnitPath();
  }

  return '';
}

export function addAdUnitPatterns(aups) {
  aups.forEach(aup => {
    try {
      aup = JSON.parse(JSON.stringify(aup));
      aup = validateAUP(aup);
      if (aup.error) {
        throw aup.error;
      }
      if (aup.divPattern) {
        aup.divPatternRegex = new RegExp(aup.divPattern, 'i');
      }
      if (aup.slotPattern) {
        aup.slotPatternRegex = new RegExp(aup.slotPattern, 'i');
      }
      adUnitPatterns.push(aup);
    } catch (e) {
      utils.logError('[PPI] Error creating Ad Unit Pattern ', e)
    }
  });
}

function validateAUP(aup) {
  if (!aup.divPattern && !aup.slotPattern) {
    aup.error = `can't create AUP without slot pattern or div pattern`;
    return aup;
  }
  let aupSizes = utils.deepAccess(aup, 'mediaTypes.banner.sizes');
  // validate sizes
  if (aupSizes) {
    if (!Array.isArray(aupSizes)) {
      aup.error = 'sizes should be an array';
      return aup;
    }

    // to cover the usual error where [[300, 250]] --> [300, 250]
    if (Array.isArray(aupSizes) && typeof (aupSizes[0]) === 'number') {
      aupSizes = [aupSizes];
    }

    aupSizes = aupSizes.filter(s => {
      if (!isSizeValid(s)) {
        utils.logError('[PPI] Invalid AUP size', s);
        return false;
      }

      return true;
    });

    utils.deepSetValue(aup, 'mediaTypes.banner.sizes', aupSizes);
  }

  return aup;
}

export function validateTransactionObjects(transactionObjects) {
  let valid = [];
  let invalid = [];

  const validTransactionTypes = new Set(Object.keys(TransactionType).map(t => TransactionType[t]));
  const validDestinationTypes = new Set(Object.keys(HBDestination).map(h => HBDestination[h].toLowerCase()));

  transactionObjects.forEach(to => {
    // check for type
    if (!validTransactionTypes.has(to.type)) {
      to.error = `provided type ${to.type} not found`;
      invalid.push(to);
      return;
    }
    if (to.type !== TransactionType.AUTO_SLOTS) {
      if (!to.value) {
        to.error = `for type ${to.type}, value must be provided, it can't be: ${to.value}`;
        invalid.push(to);
        return;
      }
    }
    if (to.hbSource !== HBSource.AUCTION && to.hbSource !== HBSource.CACHE) {
      to.error = `hbSource: ${to.hbSource} is not equal to ${HBSource.AUCTION} or ${HBSource.CACHE}`;
      invalid.push(to);
      return;
    }
    if (!to.hbDestination || !to.hbDestination.type) {
      to.error = 'hbDestionation.type not provided';
      invalid.push(to);
      return;
    }
    if (!validDestinationTypes.has(to.hbDestination.type.toLowerCase())) {
      to.error = `destination type ${to.hbDestination.type} not supported`
      invalid.push(to);
      return;
    }

    if (to.hbDestination.type === HBDestination.CACHE && to.hbSource === HBSource.CACHE) {
      to.error = `destination and source can't be cache at the same time`;
      invalid.push(to);
      return;
    }

    // validate sizes
    if (to.sizes) {
      if (!Array.isArray(to.sizes)) {
        to.error = 'sizes should be an array';
        invalid.push(to);
        return;
      }

      // to cover the usual error where [[300, 250]] --> [300, 250]
      if (Array.isArray(to.sizes) && typeof (to.sizes[0]) === 'number') {
        to.sizes = [to.sizes];
      }

      to.sizes = to.sizes.filter(s => {
        if (!isSizeValid(s)) {
          utils.logError('[PPI] Invalid size', s);
          return false;
        }

        return true;
      });
    }

    valid.push(to);
  });

  return {
    valid,
    invalid,
  }
}

export function transformAutoSlots(transactionObjects) {
  if (!transactionObjects || !transactionObjects.length) {
    return [];
  }
  let gptSlots = [];
  try {
    gptSlots = window.googletag.pubads().getSlots();
  } catch (e) {
    utils.logError('[PPI] - could not get all gpt slots: ', e, ' is gpt initialized?');
  }

  if (!gptSlots || !gptSlots.length) {
    return [];
  }

  let result = [];
  transactionObjects.forEach(to => {
    let slotObjectTOs = [];
    gptSlots.forEach(gptSlot => {
      let slotObjectTO = {
        type: TransactionType.SLOT_OBJECT,
        value: gptSlot,
        hbSource: to.hbSource,
        hbDestination: to.hbDestination,
        sizes: to.sizes,
        targeting: to.targeting,
      };

      slotObjectTOs.push(slotObjectTO);
    });

    utils.logInfo('[PPI] - from autoSlot: ', to, 'created slot objects: ', slotObjectTOs);
    result = result.concat(slotObjectTOs);
  });

  return result;
}

// sortSizes in place, descending, by area, width, height
function sortSizes(sizes) {
  return sizes.sort((a, b) => {
    return b[0] * b[1] - a[0] * a[1] || b[0] - b[0] || a[1] - a[1];
  });
}

/**
 * @param {Array.<Array>} currentSizes
 * @param {Array.<Array>} allowedSizes
 * @returns {Array.<Array>}
 */
function filterSizesByIntersection(currentSizes, allowedSizes) {
  return currentSizes.filter(function (size) {
    return hasValidSize(size, allowedSizes);
  });
}

function isSizeValid(size) {
  return Array.isArray(size) && size.length === 2 && typeof (size[0]) === 'number' && typeof (size[1]) === 'number';
}

/**
 * @param {Array.<Array>} size
 * @param {Array.<Array>} allowedSizes
 * @returns {boolean}
 */
function hasValidSize(size, allowedSizes) {
  return allowedSizes.some(function (allowedSize) {
    return (size[0] === allowedSize[0] && size[1] === allowedSize[1]);
  });
}

/**
 * Gets the given gpt slot's sizes in an array formatted [[w,h],...],
 *      excluding any "Fluid" sizes (which don't have a width or height
 * @param {googletag.Slot} gptSlot
 * @returns {Array} - gpt slot sizes array formatted [[w,h],...]
 */
function getGptSlotSizes(gptSlot) {
  let gptSlotSizes = gptSlot.getSizes();
  // if no sizes array, just return undefined (not sure if this is valid, but being defensive)
  if (!gptSlotSizes) {
    return [];
  }

  // map gpt sizes to [[w,h],...] array (filter out "fluid" size)
  return gptSlotSizes.filter((gptSlotSize) => {
    if (typeof gptSlotSize.getHeight !== 'function' || typeof gptSlotSize.getWidth !== 'function') {
      utils.logWarn('[PPI] - skipping "fluid" ad size for gpt slot:', gptSlot);
      return false;
    }
    return true;
  }).map((gptSlotSize) => {
    return [
      gptSlotSize.getWidth(),
      gptSlotSize.getHeight()
    ];
  });
}

/**
 * group transaction objects
 * @param {(Object[])} transactionObjects array of adUnit codes to refresh.
 * @return {Object.<string, string>} adUnitCode gpt slot mapping
 */
export function groupTransactionObjects(transactionObjects) {
  let grouped = {};
  transactionObjects.forEach((transactionObject) => {
    let srcTransObj = grouped[transactionObject.hbSource] || {};
    let destTransObj = srcTransObj[transactionObject.hbDestination.type] || [];
    destTransObj.push(transactionObject);
    srcTransObj[transactionObject.hbDestination.type] = destTransObj;
    grouped[transactionObject.hbSource] = srcTransObj;
  });

  return grouped;
}

function createTransactionResult(transactionObject, aup) {
  let transactionResult = utils.deepClone(transactionObject);
  transactionResult.match = {
    status: !!aup,
    aup: aup && utils.deepClone(aup),
  }

  return transactionResult;
}

export function getTOAUPPair(transactionObjects, adUnitPatterns) {
  let result = [];
  let lock = new Set();
  transactionObjects.forEach(to => {
    let aups = findMatchingAUPs(to, adUnitPatterns).filter(a => {
      let isLocked = lock.has(a)
      if (isLocked) {
        utils.logWarn('[PPI] aup was already matched for one of the previous transaction object, will skip it. AUP: ', a);
      }
      return !isLocked;
    });

    let aup;
    switch (aups.length) {
      case 0:
        utils.logWarn('[PPI] No AUP matched for transaction object', to);
        break;
      case 1:
        aup = aups[0];
        lock.add(aup);
        break;
      default:
        utils.logWarn('[PPI] More than one AUP matched, for transaction object. Will take the first one', to, aups);
        aup = aups[0];
        lock.add(aup);
        break;
    }
    result.push({
      transactionObject: to,
      adUnitPattern: aup,
    });
  });

  return result;
}

function findMatchingAUPs(transactionObject, adUnitPatterns) {
  return adUnitPatterns.filter(aup => {
    let match = false;
    switch (transactionObject.type) {
      case TransactionType.SLOT:
        if (aup.slotPattern) {
          match = aup.slotPatternRegex.test(transactionObject.value);
        }

        break;
      case TransactionType.DIV:
        if (aup.divPattern) {
          match = aup.divPatternRegex.test(transactionObject.value);
        }

        break;
      case TransactionType.SLOT_OBJECT:
        match = true;
        if (aup.slotPattern) {
          match = aup.slotPatternRegex.test(transactionObject.value.getAdUnitPath());
        }
        if (aup.divPattern) {
          match = match && aup.divPatternRegex.test(transactionObject.value.getSlotElementId());
        }
        // TODO: is this ok?
        if (!transactionObject.sizes) {
          transactionObject.sizes = getGptSlotSizes(transactionObject.value);
        }
        break;
      default:
        // this should never happen, if transaction object passed validation
        utils.logError('[PPI] Invalid transaction object type', transactionObject.type)
        return false;
    }

    if (!match) {
      return false;
    }

    let aupSizes = utils.deepAccess(aup, 'mediaTypes.banner.sizes');
    if (!transactionObject.sizes || !transactionObject.sizes.length || !aupSizes || !aupSizes.length) {
      return true;
    }

    let matchingSizes = filterSizesByIntersection(aupSizes, transactionObject.sizes);
    return matchingSizes.length;
  });
}

export function createAdUnit(adUnitPattern, limitSizes) {
  let adUnit;
  try {
    // copy pattern for conversion into adUnit
    adUnit = JSON.parse(JSON.stringify(adUnitPattern));

    if (limitSizes && limitSizes.length) {
      let sizes = utils.deepAccess(adUnit, 'mediaTypes.banner.sizes')
      if (sizes && sizes.length) {
        sizes = filterSizesByIntersection(sizes, limitSizes);
      } else {
        sizes = limitSizes;
      }

      utils.deepSetValue(adUnit, 'mediaTypes.banner.sizes', sortSizes(sizes));
    }

    // if aup code was not published, generate one
    if (!adUnit.code) {
      // it's important that correct (and sorted) sizes enter the hash function
      adUnit.code = hashFnv32a(JSON.stringify(adUnit)).toString(16);
    }

    // Remove pattern properties not included in adUnit
    delete adUnit.slotPattern;
    delete adUnit.divPattern;
    delete adUnit.slotPatternRegex;
    delete adUnit.divPatternRegex;

    // attach transactionId
    if (!adUnit.transactionId) {
      adUnit.transactionId = utils.generateUUID();
    }
  } catch (e) {
    utils.logError('[PPI] error parsing adUnit', e);
  }

  return adUnit;
}

export function applyFirstPartyData(adUnit, adUnitPattern, transactionObject) {
  let targeting = transactionObject.targeting || {};

  adUnit.bids.forEach(bid => {
    if (!bid.params) {
      return;
    }
    for (const paramName in bid.params) {
      replaceBidParameters(bid.params, paramName, targeting);
    }
  });

  let slotName = getGPTSlotName(transactionObject, adUnitPattern);
  if (!slotName) {
    return;
  }

  utils.deepSetValue(adUnit, 'fpd.context.pbAdSlot', slotName);
  utils.deepSetValue(adUnit, 'fpd.context.adServer', {
    name: 'gam',
    adSlot: slotName
  });
}

function replaceBidParameters(params, paramName, targeting) {
  let paramValue = params[paramName];
  if (utils.isPlainObject(paramValue)) {
    for (const nestedKey in paramValue) {
      replaceBidParameters(paramValue, nestedKey, targeting);
    }
  } else if (Array.isArray(paramValue)) {
    for (let i = 0; i < paramValue.length; i++) {
      replaceBidParameters(paramValue, i, targeting);
    }
    params[paramName] = paramValue.filter(p => p !== undefined);
  }
  if (utils.isStr(paramValue) && isPlaceHolder(paramValue)) {
    let placeholderKey = paramValue.slice(7, -2);
    if (targeting[placeholderKey]) {
      utils.logInfo(`[PPI] - found placeholder: '${paramValue}' with name '${placeholderKey}', replacing it with value from targeting: `, targeting[placeholderKey]);
      params[paramName] = targeting[placeholderKey];
    } else {
      utils.logInfo(`[PPI] - for placeholder '${paramValue}' with name '${placeholderKey}', didn't find targeting value, will remove '${paramName}' from bid params`);
      delete params[paramName];
    }
  }
}

function isPlaceHolder(value) {
  return value.indexOf('##data.') === 0 && value.slice(-2) == '##';
}

export const adUnitPatterns = [];

(getGlobal()).ppi = {
  requestBids,
  addAdUnitPatterns,
  adUnitPatterns,
};
