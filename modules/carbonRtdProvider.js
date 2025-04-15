/**
* This module adds the carbon provider to the Real Time Data module (rtdModule)
* The {@link module:modules/realTimeData} module is required
* The module will add contextual and audience targeting data to bid requests
* @module modules/carbonRtdProvider
* @requires module:modules/realTimeData
*/
import { submodule } from '../src/hook.js';
import { ajax } from '../src/ajax.js';
import {getGlobal} from '../src/prebidGlobal.js';
import { logError, isGptPubadsDefined, generateUUID } from '../src/utils.js';
import { getStorageManager } from '../src/storageManager.js';
import { MODULE_TYPE_RTD } from '../src/activities/modules.js';

const CARBON_GVL_ID = 493;
const MODULE_NAME = 'carbon'
const MODULE_VERSION = 'v1.0'
const PROFILE_ID_KEY = 'carbon_ccuid'
const GPP_SECTIONS = {
  1: 'tcfeuv1',
  2: 'tcfeuv2',
  5: 'tcfcav1',
  6: 'uspv1',
  7: 'usnat',
  8: 'usca',
  9: 'usva',
  10: 'usco',
  11: 'usut',
  12: 'usct',
  13: 'usfl',
  14: 'usmt',
  15: 'usor',
  16: 'ustx',
  17: 'usde',
  18: 'usia',
  19: 'usne',
  20: 'usnh',
  21: 'usnj',
  22: 'ustn'
}

let rtdHost = '';
let parentId = '';
let targetingData = null;
let features = {};

export const storage = getStorageManager({moduleType: MODULE_TYPE_RTD, moduleName: MODULE_NAME, gvlid: CARBON_GVL_ID});

export function handleGppEUConsent(section) {
  if (section.vendor.consents[CARBON_GVL_ID] === true) {
    return true;
  } else if (section.vendor.consents[CARBON_GVL_ID] === false) {
    return false;
  }
}

export function handleGppUSPConsent(section) {
  if (section.uspString.length >= 3) {
    const notice = section.uspString[1].toLowerCase();
    const optOut = section.uspString[2].toLowerCase();
    if (notice === 'y' && optOut === 'n') {
      return true;
    } else if (optOut === 'y') {
      return false;
    }
  }
}

export function handleGppUSNatConsent(section) {
  if (section.SharingNotice == 1 && section.SharingOptOut == 1) {
    return true;
  } else {
    return false;
  }
}

export function handleGppSection(sectionName, section, handlers) {
  const handler = handlers[sectionName] || handlers.default;
  if (handler) {
    return handler(section);
  }
}

export function hasConsent(consentData) {
  if (consentData?.gdpr?.gdprApplies) {
    const vendorConsents = consentData?.gdpr?.vendorData?.vendor?.consents;
    if (vendorConsents && typeof vendorConsents === 'object') {
      return vendorConsents[CARBON_GVL_ID];
    }
    return false;
  }

  if (consentData?.usp && typeof consentData.usp === 'string' && consentData.usp.length >= 3) {
    const notice = consentData.usp[1].toLowerCase();
    const optOut = consentData.usp[2].toLowerCase();

    if (notice === 'y' && optOut === 'n') {
      return true;
    } else if (optOut === 'y') {
      return false;
    }
  }

  if (consentData?.gpp) {
    for (let i of consentData.gpp.applicableSections || []) {
      let sectionName = GPP_SECTIONS?.[i];
      let section = consentData.gpp.parsedSections[sectionName];

      if (!section) continue;
      if (Array.isArray(section)) section = section[0];

      handleGppSection(sectionName, section, {
        tcfeuv1: handleGppEUConsent,
        tcfeuv2: handleGppEUConsent,
        tcfcav1: handleGppEUConsent,
        uspv1: handleGppUSPConsent,
        usnat: handleGppUSNatConsent,
        usca: handleGppUSNatConsent,
        usva: handleGppUSNatConsent,
        usco: handleGppUSNatConsent,
        usut: handleGppUSNatConsent,
        usct: handleGppUSNatConsent,
        usfl: handleGppUSNatConsent,
        usmt: handleGppUSNatConsent,
        usor: handleGppUSNatConsent,
        ustx: handleGppUSNatConsent,
        usde: handleGppUSNatConsent,
        usia: handleGppUSNatConsent,
        usne: handleGppUSNatConsent,
        usnh: handleGppUSNatConsent,
        usnj: handleGppUSNatConsent,
        ustn: handleGppUSNatConsent,
        default: () => {}
      });
    }
  }

  return true;
}

export function updateProfileId(carbonData) {
  let identity = carbonData?.profile?.identity;
  if (identity?.update && identity?.id != '' && storage.localStorageIsEnabled()) {
    storage.setDataInLocalStorage(PROFILE_ID_KEY, identity.id);
  }
}

export function matchCustomTaxonomyRule(rule) {
  const contentText = window.top.document.body.innerText;
  if (rule.MatchType == 'any') {
    let words = Object.keys(rule.WordWeights).join('|');

    let regex = RegExp('\\b' + words + '\\b', 'i');
    let result = contentText.match(regex);

    if (result) {
      return true
    }
  } else if (rule.MatchType == 'minmatch') {
    let score = 0;
    let words = Object.keys(rule.WordWeights).join('|');

    let regex = RegExp('\\b' + words + '\\b', 'gi');
    let result = contentText.match(regex);

    if (result?.length) {
      for (let match of result) {
        let point = rule.WordWeights[match];
        if (!isNaN(point)) {
          score += point;
        }

        if (score >= rule.MatchValue) {
          return true;
        }
      }
    }
  }

  return false;
}

export function matchCustomTaxonomy(rules) {
  let matchedRules = rules.filter(matchCustomTaxonomyRule);
  return matchedRules.map(x => x.Id);
}

export function prepareGPTTargeting(carbonData) {
  if (isGptPubadsDefined()) {
    setGPTTargeting(carbonData)
  } else {
    window.googletag = window.googletag || {};
    window.googletag.cmd = window.googletag.cmd || [];
    window.googletag.cmd.push(() => setGPTTargeting(carbonData));
  }
}

export function setGPTTargeting(carbonData) {
  if (Array.isArray(carbonData?.profile?.audiences) && features?.audience?.pushGpt) {
    window.googletag.pubads().setTargeting('carbon_segment', carbonData.profile.audiences);
  }

  if (Array.isArray(carbonData?.context?.pageContext?.contextualclassifications) && features?.context?.pushGpt) {
    let contextSegments = carbonData.context.pageContext.contextualclassifications.map(x => {
      if (x.type && x.type == 'iab_intent' && x.id) {
        return x.id;
      }
    }).filter(x => x != undefined);
    window.googletag.pubads().setTargeting('cc-iab-class-id', contextSegments);
  }

  if (Array.isArray(carbonData?.context?.customTaxonomy) && features?.customTaxonomy?.pushGpt) {
    let customTaxonomyResults = matchCustomTaxonomy(carbonData.context.customTaxonomy);
    window.googletag.pubads().setTargeting('cc-custom-taxonomy', customTaxonomyResults);
  }
}

export function fetchRealTimeData() {
  let doc = window.top.document;
  let pageUrl = `${doc.location.protocol}//${doc.location.host}${doc.location.pathname}`;

  // generate an arbitrary ID if storage is blocked so that contextual data can still be retrieved
  let profileId = storage.getDataFromLocalStorage(PROFILE_ID_KEY) || generateUUID();

  let reqUrl = new URL(`${rtdHost}/${MODULE_VERSION}/realtime/${parentId}`);
  reqUrl.searchParams.append('profile_id', profileId);
  reqUrl.searchParams.append('url', encodeURIComponent(pageUrl));

  if (getGlobal().getUserIdsAsEids && typeof getGlobal().getUserIdsAsEids == 'function') {
    let eids = getGlobal().getUserIdsAsEids();

    if (eids && eids.length) {
      eids.forEach(eid => {
        if (eid?.uids?.length) {
          eid.uids.forEach(uid => {
            reqUrl.searchParams.append('eid', `${eid.source}:${uid.id}`)
          });
        }
      });
    }
  }

  reqUrl.searchParams.append('context', (typeof features?.context?.active === 'undefined') ? true : features.context.active);
  if (features?.context?.limit && features.context.limit > 0) {
    reqUrl.searchParams.append('contextLimit', features.context.limit);
  }

  reqUrl.searchParams.append('audience', (typeof features?.audience?.active === 'undefined') ? true : features.audience.active);
  if (features?.audience?.limit && features.audience.limit > 0) {
    reqUrl.searchParams.append('audienceLimit', features.audience.limit);
  }

  reqUrl.searchParams.append('deal_ids', (typeof features?.dealId?.active === 'undefined') ? true : features.dealId.active);
  if (features?.dealId?.limit && features.dealId.limit > 0) {
    reqUrl.searchParams.append('dealIdLimit', features.dealId.limit);
  }

  reqUrl.searchParams.append('custom_taxonomy', (typeof features?.customTaxonomy?.active === 'undefined') ? true : features.customTaxonomy.active);
  if (features?.customTaxonomy?.limit && features.customTaxonomy.limit > 0) {
    reqUrl.searchParams.append('customTaxonomyLimit', features.customTaxonomy.limit);
  }

  ajax(reqUrl, {
    success: function (response, req) {
      let carbonData = {};
      if (req.status === 200) {
        try {
          carbonData = JSON.parse(response);
        } catch (e) {
          logError('unable to parse API response');
        }

        targetingData = carbonData;
        prepareGPTTargeting(targetingData);
      }
    },
    error: function () {
      logError('failed to retrieve targeting information');
    }
  },
  null, {
    method: 'GET',
    withCredentials: true,
    crossOrigin: true
  });
}

export function bidRequestHandler(bidReqConfig, callback, config, userConsent) {
  try {
    if (hasConsent(userConsent)) {
      if (targetingData) {
        prepareGPTTargeting(targetingData);
      } else {
        fetchRealTimeData();
      }
    }

    callback();
  } catch (err) {
    logError(err);
  }
}

function init(moduleConfig) {
  if (moduleConfig?.params?.parentId) {
    parentId = moduleConfig.params.parentId;
  } else {
    logError('required config value "parentId" not provided');
    return false;
  }

  if (moduleConfig?.params?.endpoint) {
    rtdHost = moduleConfig.params.endpoint;
  } else {
    logError('required config value "endpoint" not provided');
    return false;
  }

  features = moduleConfig?.params?.features || features;

  return true;
}

/** @type {RtdSubmodule} */
export const carbonSubmodule = {
  name: MODULE_NAME,
  getBidRequestData: bidRequestHandler,
  init: init
};

submodule('realTimeData', carbonSubmodule);
